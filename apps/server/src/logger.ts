import pino from 'pino';
import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';
import { INSTANCE_ID } from './redis.js';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'server', instance: INSTANCE_ID },
  // Pretty-print when running under tsx (dev). JSON lines in prod.
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : {
          target: 'pino/file',
          options: { destination: 1 },
        },
});

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const existing = req.headers['x-request-id'];
    const id =
      typeof existing === 'string' && existing ? existing : randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },
  serializers: {
    req(req) {
      return { method: req.method, url: req.url, id: req.id };
    },
    res(res) {
      return { status: res.statusCode };
    },
  },
  customLogLevel: (_req, res, err) => {
    if (err) return 'error';
    if (res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
});
