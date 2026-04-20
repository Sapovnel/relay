import express from 'express';
import { run, supportedLanguages } from './run.js';

const PORT = Number(process.env.PORT ?? 4100);

const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, languages: supportedLanguages() });
});

app.post('/run', async (req, res) => {
  const { language, code } = req.body as { language?: unknown; code?: unknown };
  if (typeof language !== 'string' || typeof code !== 'string') {
    res.status(400).json({ error: 'language and code (strings) required' });
    return;
  }
  if (code.length > 64 * 1024) {
    res.status(413).json({ error: 'code exceeds 64 KB' });
    return;
  }
  try {
    const result = await run(language, code);
    res.json(result);
  } catch (err) {
    console.error('run error:', err);
    res.status(500).json({
      stdout: '',
      stderr: err instanceof Error ? err.message : 'executor error',
      exitCode: null,
      timedOut: false,
      oomKilled: false,
      durationMs: 0,
    });
  }
});

app.listen(PORT, () => {
  console.log(`executor listening on http://localhost:${PORT}`);
});
