import 'dotenv/config';

export const env = {
  PORT: Number(process.env.PORT ?? 4000),
  MONGO_URL: process.env.MONGO_URL ?? 'mongodb://localhost:27017',
  MONGO_DB: process.env.MONGO_DB ?? 'codee',
  JWT_SECRET: process.env.JWT_SECRET ?? 'dev-only-not-for-prod',
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ?? '',
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET ?? '',
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  DEV_LOGIN: (process.env.DEV_LOGIN ?? 'true').toLowerCase() === 'true',
  EXECUTOR_URL: process.env.EXECUTOR_URL ?? 'http://localhost:4100',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
  INSTANCE_ID: process.env.INSTANCE_ID ?? '',
  RUN_RATE_LIMIT: Number(process.env.RUN_RATE_LIMIT ?? 10),
  RUN_RATE_WINDOW_MS: Number(process.env.RUN_RATE_WINDOW_MS ?? 60_000),
};

export const GITHUB_CALLBACK = `${env.WEB_ORIGIN}/auth/github/callback`;
export const GITHUB_ENABLED = Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);

if (!GITHUB_ENABLED) {
  console.warn('[auth] GITHUB_CLIENT_ID/SECRET not set — /auth/github disabled');
}
if (env.JWT_SECRET === 'dev-only-not-for-prod') {
  console.warn('[auth] JWT_SECRET is the default dev value — set one in .env before deploying');
}
