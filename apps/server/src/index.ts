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
import { roomsRouter, isMember } from './rooms.js';
import { installSyncHandler } from './sync.js';
import { logger, httpLogger } from './logger.js';
import { registry, httpRequests, httpDuration, wsConnections } from './metrics.js';
import { INSTANCE_ID } from './redis.js';

async function main() {
  await connectMongo();
  installSyncHandler();
  setupPersistence();

  const app = express();
  app.use(httpLogger);
  app.use(cookieParser());
  app.use(express.json());

  // Prometheus-friendly HTTP metrics middleware.
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durSec = Number(process.hrtime.bigint() - start) / 1e9;
      const path = (req.route?.path ?? req.path).replace(/[0-9a-f]{24}/gi, ':id');
      const labels = {
        method: req.method,
        path,
        status: String(res.statusCode),
      };
      httpRequests.inc(labels);
      httpDuration.observe(labels, durSec);
    });
    next();
  });

  app.use('/auth', authRouter);
  app.use('/rooms', roomsRouter);
  app.get('/health', (_req, res) => {
    res.json({ ok: true, instance: INSTANCE_ID });
  });
  app.get('/metrics', async (_req, res) => {
    res.setHeader('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  });

  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    const user = getSessionFromCookie(req.headers.cookie);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const docName = url.pathname.replace(/^\/+/, '');
    const allowed = await isMember(docName, user.sub);
    if (!allowed) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
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
    const docName = url.pathname.replace(/^\/+/, '');
    setupWSConnection(ws, req, { docName, gc: true });
    const user = (ws as typeof ws & { user: SessionUser }).user;
    wsConnections.inc();
    ws.on('close', () => wsConnections.dec());
    logger.info({ login: user.login, room: docName }, 'ws joined');
  });

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT, instance: INSTANCE_ID }, 'collab server ready');
  });
}

main().catch((err) => {
  logger.error({ err }, 'server failed to start');
  process.exit(1);
});
