import express from 'express';
import { run, supportedLanguages } from './run.js';

const PORT = Number(process.env.PORT ?? 4100);

const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, languages: supportedLanguages() });
});

// Streaming NDJSON. Each line is one event:
//   {"type":"stdout","data":"..."}
//   {"type":"stderr","data":"..."}
//   {"type":"done","exitCode":0,"timedOut":false,"oomKilled":false,"durationMs":...,
//    "stdout":"<full>","stderr":"<full>"}
// The final 'done' event also carries the full concatenated output so callers
// that don't want to reassemble chunks themselves can just use it.
app.post('/run', async (req, res) => {
  const { language, code, stdin } = req.body as {
    language?: unknown;
    code?: unknown;
    stdin?: unknown;
  };
  if (typeof language !== 'string' || typeof code !== 'string') {
    res.status(400).json({ error: 'language and code (strings) required' });
    return;
  }
  if (code.length > 64 * 1024) {
    res.status(413).json({ error: 'code exceeds 64 KB' });
    return;
  }
  const stdinStr = typeof stdin === 'string' ? stdin : '';
  if (stdinStr.length > 64 * 1024) {
    res.status(413).json({ error: 'stdin exceeds 64 KB' });
    return;
  }

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if ever proxied
  const write = (event: unknown) => res.write(JSON.stringify(event) + '\n');

  try {
    const result = await run(language, code, stdinStr, (fd, chunk) => {
      write({
        type: fd === 1 ? 'stdout' : 'stderr',
        data: chunk.toString('utf8'),
      });
    });
    write({ type: 'done', ...result });
  } catch (err) {
    write({
      type: 'error',
      message: err instanceof Error ? err.message : 'executor error',
    });
  }
  res.end();
});

app.listen(PORT, () => {
  console.log(`executor listening on http://localhost:${PORT}`);
});
