import Docker from 'dockerode';
import { PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';

const docker =
  process.platform === 'win32'
    ? new Docker({ socketPath: '//./pipe/docker_engine' })
    : new Docker();

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  oomKilled: boolean;
  durationMs: number;
}

interface LangConfig {
  image: string;
  makeCmd: (code: string) => string[];
  // If true, the runner reads source from stdin. If false, code travels through argv
  // and stdin is NOT attached (otherwise the runtime hangs waiting for EOF).
  viaStdin: boolean;
  // Extra env vars to inject. Used by languages that need the code as a file on disk
  // (e.g. Go) — we base64 the code and decode it inside the sandbox to avoid ARG_MAX
  // issues with very long argv strings and to keep binary-safe delivery.
  makeEnv?: (code: string) => string[];
  timeoutMs?: number;
  memoryMB?: number;
}

// argv is always passed as an array — there is no shell interpolation, so code strings
// going through argv are byte-safe. For languages that can't accept code on argv (Go
// needs a real .go file), we use `sh -c 'cat > file && run file'` and pipe the code
// through stdin.
const LANGS: Record<string, LangConfig> = {
  javascript: {
    image: 'node:20-alpine',
    makeCmd: (code) => ['node', '-e', code],
    viaStdin: false,
  },
  python: {
    image: 'python:3.12-alpine',
    makeCmd: (code) => ['python3', '-c', code],
    viaStdin: false,
  },
  // Go is still disabled. Reached two blockers this pass:
  //   1. `go run` on half a CPU compiles hello-world in ~40 s — timeout UX is bad.
  //   2. Docker Desktop on Windows (WSL2) mounts tmpfs with noexec by default, so
  //      even after compile, the linker output at /tmp/go-build*/b001/exe/main can't
  //      fork/exec. Fix needs either a non-tmpfs writable mount with exec, or a
  //      warm go-build cache container pool.
};

export function supportedLanguages(): string[] {
  return Object.keys(LANGS);
}

const MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 5000;

function capture(stream: NodeJS.ReadableStream, cap: number) {
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  stream.on('data', (chunk: Buffer) => {
    if (truncated) return;
    if (total + chunk.length > cap) {
      chunks.push(chunk.subarray(0, cap - total));
      total = cap;
      truncated = true;
    } else {
      chunks.push(chunk);
      total += chunk.length;
    }
  });
  return () => {
    const s = Buffer.concat(chunks).toString('utf8');
    return truncated ? s + '\n[output truncated at 64 KB]' : s;
  };
}

export async function run(language: string, code: string): Promise<RunResult> {
  const cfg = LANGS[language];
  if (!cfg) {
    return {
      stdout: '',
      stderr: `unsupported language: ${language}`,
      exitCode: null,
      timedOut: false,
      oomKilled: false,
      durationMs: 0,
    };
  }

  // Go compiler's build cache lives in /tmp; needs more space than a script runtime.
  const tmpfsSize = language === 'go' ? '128m' : '16m';

  const started = Date.now();
  const extraEnv = cfg.makeEnv?.(code) ?? [];
  const container = await docker.createContainer({
    name: `codee-run-${randomUUID().slice(0, 8)}`,
    Image: cfg.image,
    Cmd: cfg.makeCmd(code),
    User: 'nobody',
    WorkingDir: '/tmp',
    Env: [
      'HOME=/tmp',
      'NODE_OPTIONS=--no-warnings',
      'GOCACHE=/tmp/gocache',
      'GOPATH=/tmp/gopath',
      ...extraEnv,
    ],
    NetworkDisabled: true,
    AttachStdin: cfg.viaStdin,
    AttachStdout: true,
    AttachStderr: true,
    OpenStdin: cfg.viaStdin,
    StdinOnce: cfg.viaStdin,
    Tty: false,
    StopTimeout: 0,
    HostConfig: {
      Memory: (cfg.memoryMB ?? 128) * 1024 * 1024,
      MemorySwap: (cfg.memoryMB ?? 128) * 1024 * 1024,
      NanoCpus: 500_000_000,
      PidsLimit: 64,
      ReadonlyRootfs: true,
      CapDrop: ['ALL'],
      Tmpfs: { '/tmp': `rw,size=${tmpfsSize},nosuid,nodev,mode=1777` },
      NetworkMode: 'none',
      AutoRemove: false,
      SecurityOpt: ['no-new-privileges'],
    },
  });

  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  const killTimer = setTimeout(() => {
    timedOut = true;
    container.kill({ signal: 'SIGKILL' }).catch(() => {});
  }, timeoutMs);

  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();
  const getStdout = capture(stdoutStream, MAX_OUTPUT_BYTES);
  const getStderr = capture(stderrStream, MAX_OUTPUT_BYTES);

  try {
    const attachStream = (await container.attach({
      stream: true,
      stdin: cfg.viaStdin,
      stdout: true,
      stderr: true,
    })) as NodeJS.ReadWriteStream;

    docker.modem.demuxStream(attachStream, stdoutStream, stderrStream);
    await container.start();

    if (cfg.viaStdin) {
      attachStream.write(code);
      (attachStream as unknown as { end?: () => void }).end?.();
    }

    const waitResult = await container.wait();
    clearTimeout(killTimer);
    await new Promise((r) => setImmediate(r));
    try {
      (attachStream as unknown as { destroy?: () => void }).destroy?.();
    } catch {
      // docker-modem's HttpDuplex.destroy can throw after stream.end() nulls its request.
    }
    stdoutStream.end();
    stderrStream.end();

    let oomKilled = false;
    try {
      const info = await container.inspect();
      oomKilled = info.State?.OOMKilled === true;
    } catch {
      // container may already be removed
    }

    return {
      stdout: getStdout(),
      stderr: getStderr(),
      exitCode: waitResult.StatusCode,
      timedOut,
      oomKilled,
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(killTimer);
    await container.remove({ force: true }).catch(() => {});
  }
}
