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

export async function run(
  language: string,
  code: string,
  stdin: string = '',
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
  const container = await docker.createContainer({
    name: `codee-run-${randomUUID().slice(0, 8)}`,
    Image: cfg.image,
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
    //   - For stdin delivery, attach with hijack: true so end() actually closes the
    //     TCP write side (the only way Docker fires StdinOnce and sends EOF).
    //   - For stdout/stderr capture, DON'T read from that hijacked socket — it was
    //     flaky. Instead, after container.wait(), pull the full output via
    //     container.logs() and demux the 8-byte-framed buffer ourselves.
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

    await container.start();

    if (stdinStream) {
      stdinStream.write(cfg.viaStdin ? effectiveCode : stdin);
      (stdinStream as unknown as { end: () => void }).end();
    }

    const waitResult = await container.wait();
    clearTimeout(killTimer);

    const logsBuffer = (await container.logs({
      stdout: true,
      stderr: true,
      follow: false,
      tail: 10000,
    })) as unknown as Buffer;

    // Docker log stream framing when Tty: false — repeating frames of
    // [ fd:1 byte | 3 zero bytes | length:uint32BE ] + payload. fd 1 = stdout, 2 = stderr.
    let offset = 0;
    while (offset + 8 <= logsBuffer.length) {
      const fd = logsBuffer[offset];
      const size = logsBuffer.readUInt32BE(offset + 4);
      if (offset + 8 + size > logsBuffer.length) break;
      const payload = logsBuffer.subarray(offset + 8, offset + 8 + size);
      if (fd === 2) stderrStream.write(payload);
      else stdoutStream.write(payload);
      offset += 8 + size;
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
