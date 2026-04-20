import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
// @ts-expect-error — y-websocket ships JS with no bundled types for this path
import { setupWSConnection } from 'y-websocket/bin/utils';

const PORT = Number(process.env.PORT ?? 4000);

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
