import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
// @ts-expect-error — y-websocket ships JS with no bundled types for this path
import { setupWSConnection } from 'y-websocket/bin/utils';
import { env } from './env.js';
import { connectMongo } from './mongo.js';
import { setupPersistence } from './persistence.js';
import { authRouter, getSessionFromCookie, type SessionUser } from './auth.js';

async function main() {
  await connectMongo();
  setupPersistence();

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/auth', authRouter);
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const user = getSessionFromCookie(req.headers.cookie);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      (ws as typeof ws & { user: SessionUser }).user = user;
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const docName = url.pathname.replace(/^\/+/, '') || 'default';
    setupWSConnection(ws, req, { docName, gc: true });
    const user = (ws as typeof ws & { user: SessionUser }).user;
    console.log(`ws: "${user.login}" joined "${docName}"`);
  });

  server.listen(env.PORT, () => {
    console.log(`collab server listening on http://localhost:${env.PORT}`);
  });
}

main().catch((err) => {
  console.error('server failed to start:', err);
  process.exit(1);
});
