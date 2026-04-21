import { Counter, Histogram, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const httpRequests = new Counter({
  name: 'codee_http_requests_total',
  help: 'Total HTTP requests handled by the collab server.',
  labelNames: ['method', 'path', 'status'],
  registers: [registry],
});

export const httpDuration = new Histogram({
  name: 'codee_http_request_duration_seconds',
  help: 'HTTP request duration in seconds.',
  labelNames: ['method', 'path', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const wsConnections = new Gauge({
  name: 'codee_ws_connections',
  help: 'Currently open WebSocket connections.',
  registers: [registry],
});

export const runsTotal = new Counter({
  name: 'codee_runs_total',
  help: 'Total /run requests forwarded to the executor.',
  labelNames: ['language', 'outcome'],
  registers: [registry],
});

export const runDuration = new Histogram({
  name: 'codee_run_duration_seconds',
  help: 'Executor run duration in seconds.',
  labelNames: ['language'],
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

export const rateLimitDenied = new Counter({
  name: 'codee_rate_limit_denied_total',
  help: 'Requests rejected by the rate limiter.',
  labelNames: ['bucket'],
  registers: [registry],
});
