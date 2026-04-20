import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
// @ts-expect-error — y-websocket ships JS with no bundled types for this path
import { setupWSConnection } from 'y-websocket/bin/utils';
import { connectMongo } from './mongo.js';
import { setupPersistence } from './persistence.js';

const PORT = Number(process.env.PORT ?? 4000);

async function main() {
  await connectMongo();
  setupPersistence();

  const app = express();
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const docName = url.pathname.replace(/^\/+/, '') || 'default';
    setupWSConnection(ws, req, { docName, gc: true });
    console.log(`ws: client joined room "${docName}"`);
  });

  server.listen(PORT, () => {
    console.log(`collab server listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('server failed to start:', err);
  process.exit(1);
});
