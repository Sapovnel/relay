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
  cmd: (code: string) => string[];
}

const LANGS: Record<string, LangConfig> = {
  javascript: {
    image: 'node:20-alpine',
    cmd: (code) => ['node', '-e', code],
  },
  typescript: {
    image: 'node:20-alpine',
    cmd: (code) => ['node', '--input-type=module', '-e', code],
  },
  python: {
    image: 'python:3.12-alpine',
    cmd: (code) => ['python3', '-c', code],
  },
};

export function supportedLanguages(): string[] {
  return Object.keys(LANGS);
}

const MAX_OUTPUT_BYTES = 64 * 1024;
const TIMEOUT_MS = 5000;

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

  const started = Date.now();
  const container = await docker.createContainer({
    name: `codee-run-${randomUUID().slice(0, 8)}`,
    Image: cfg.image,
    Cmd: cfg.cmd(code),
    User: 'nobody',
    WorkingDir: '/tmp',
    Env: ['HOME=/tmp', 'NODE_OPTIONS=--no-warnings'],
    NetworkDisabled: true,
    AttachStdout: true,
    AttachStderr: true,
    AttachStdin: false,
    OpenStdin: false,
    Tty: false,
    StopTimeout: 0,
    HostConfig: {
      Memory: 128 * 1024 * 1024,
      MemorySwap: 128 * 1024 * 1024,
      NanoCpus: 500_000_000,
      PidsLimit: 64,
      ReadonlyRootfs: true,
      CapDrop: ['ALL'],
      Tmpfs: { '/tmp': 'rw,size=16m,nosuid,nodev' },
      NetworkMode: 'none',
      AutoRemove: false,
      SecurityOpt: ['no-new-privileges'],
    },
  });

  let timedOut = false;
  const killTimer = setTimeout(() => {
    timedOut = true;
    container.kill({ signal: 'SIGKILL' }).catch(() => {});
  }, TIMEOUT_MS);

  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();
  const getStdout = capture(stdoutStream, MAX_OUTPUT_BYTES);
  const getStderr = capture(stderrStream, MAX_OUTPUT_BYTES);

  try {
    const attachStream = await container.attach({
      stream: true,
      stdout: true,
      stderr: true,
    });
    docker.modem.demuxStream(attachStream, stdoutStream, stderrStream);
    await container.start();
    const waitResult = await container.wait();
    clearTimeout(killTimer);
    // Give demuxed streams a tick to flush
    await new Promise((r) => setImmediate(r));
    (attachStream as unknown as { destroy?: () => void }).destroy?.();
    stdoutStream.end();
    stderrStream.end();

    let oomKilled = false;
    try {
      const info = await container.inspect();
      oomKilled = info.State?.OOMKilled === true;
    } catch {
      // ignore
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
