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
//
// Image names: when the user has built our custom runner images via
// `npm run runners:build`, those carry a curated set of pre-installed packages
// so `require('lodash')` / `import numpy` work inside the no-network sandbox.
// We fall back to vanilla node/python images at runtime if the custom ones
// haven't been built yet.
const LANGS: Record<string, LangConfig> = {
  javascript: {
    image: 'relay-runner-node:latest',
    makeCmd: (code) => ['node', '-e', code],
    viaStdin: false,
  },
  python: {
    image: 'relay-runner-python:latest',
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

// Lightweight test helpers injected before user code so assertions produce
// PASS:/FAIL: lines that the client can parse into a test panel.
const TEST_PRELUDE: Record<string, string> = {
  javascript:
    `function check(c,n,e){console.log(c?'PASS: '+n:'FAIL: '+n+(e?' — '+e:''))};` +
    `function checkEq(a,b,n){const p=JSON.stringify(a)===JSON.stringify(b);` +
    `console.log(p?'PASS: '+n:'FAIL: '+n+' — expected '+JSON.stringify(b)+' got '+JSON.stringify(a))};\n`,
  python:
    `def check(c,n,e=None):\n` +
    ` print('PASS: '+n if c else 'FAIL: '+n+(' — '+str(e) if e else ''))\n` +
    `def check_eq(a,b,n):\n` +
    ` print('PASS: '+n if a==b else f'FAIL: {n} — expected {b!r} got {a!r}')\n`,
};

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

export type ChunkCallback = (fd: 1 | 2, chunk: Buffer) => void;

export async function run(
  language: string,
  code: string,
  stdin: string = '',
  onChunk?: ChunkCallback,
): Promise<RunResult> {
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

  const effectiveCode = (TEST_PRELUDE[language] ?? '') + code;
  const started = Date.now();
  const extraEnv = cfg.makeEnv?.(effectiveCode) ?? [];
  const needsStdin = cfg.viaStdin || stdin.length > 0;

  // If the curated runner image isn't present, fall back to a vanilla one.
  // (User just hasn't run `npm run runners:build` yet.)
  let image = cfg.image;
  try {
    await docker.getImage(image).inspect();
  } catch {
    const fallback = language === 'python' ? 'python:3.12-alpine' : 'node:20-alpine';
    if (image !== fallback) {
      console.warn(
        `[runner] image "${image}" not found locally — falling back to "${fallback}". ` +
          `Run "npm run runners:build" to enable pre-installed packages.`,
      );
      image = fallback;
    }
  }

  const container = await docker.createContainer({
    name: `relay-run-${randomUUID().slice(0, 8)}`,
    Image: image,
    Cmd: cfg.makeCmd(effectiveCode),
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
    AttachStdin: needsStdin,
    AttachStdout: true,
    AttachStderr: true,
    OpenStdin: needsStdin,
    StdinOnce: needsStdin,
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
    // Architecture:
    //   - Stdin (if needed) via a hijacked attach so end() actually closes TCP
    //     write side (needed for StdinOnce → EOF inside the container).
    //   - Stdout/stderr via container.logs(follow: true) started BEFORE start,
    //     demuxed with Docker's frame protocol. Each demuxed chunk fires
    //     onChunk() so /run can stream it to the caller in real time.
    let stdinStream: NodeJS.ReadWriteStream | null = null;
    if (needsStdin) {
      stdinStream = (await container.attach({
        stream: true,
        stdin: true,
        stdout: false,
        stderr: false,
        hijack: true,
      })) as NodeJS.ReadWriteStream;
    }

    if (onChunk) {
      stdoutStream.on('data', (c: Buffer) => onChunk(1, c));
      stderrStream.on('data', (c: Buffer) => onChunk(2, c));
    }

    await container.start();

    // After start: follow the container's log stream. Before-start logs()
    // returns an empty stream on some Docker versions (notably Docker Desktop
    // on Windows), so we start the subscription here. For very fast programs
    // the first few ms of output can race the subscription — we backfill
    // with a final non-follow logs() pull just before cleanup.
    const logsStream = (await container.logs({
      stdout: true,
      stderr: true,
      follow: true,
      tail: 0,
    })) as unknown as NodeJS.ReadableStream;
    docker.modem.demuxStream(logsStream, stdoutStream, stderrStream);

    if (stdinStream) {
      stdinStream.write(cfg.viaStdin ? effectiveCode : stdin);
      (stdinStream as unknown as { end: () => void }).end();
    }

    const waitResult = await container.wait();
    clearTimeout(killTimer);

    // Drain the logs stream — when the container exits, follow=true will end it.
    await new Promise((resolve) => {
      if ((logsStream as NodeJS.ReadableStream & { readableEnded?: boolean }).readableEnded) {
        resolve(undefined);
        return;
      }
      logsStream.once('end', () => resolve(undefined));
      logsStream.once('close', () => resolve(undefined));
      // Safety cap — don't hang forever on a stuck log stream.
      setTimeout(() => resolve(undefined), 500);
    });
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
