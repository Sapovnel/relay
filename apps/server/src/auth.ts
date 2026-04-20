import express, { type Request, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env, GITHUB_CALLBACK, GITHUB_ENABLED } from './env.js';
import { users } from './mongo.js';

const router = express.Router();

const COOKIE_NAME = 'codee_session';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const OAUTH_STATE_COOKIE = 'codee_oauth_state';

export interface SessionUser {
  sub: string;
  githubId: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

function signSession(payload: SessionUser): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '7d' });
}

export function verifySession(token: string): SessionUser | null {
  try {
    return jwt.verify(token, env.JWT_SECRET) as SessionUser;
  } catch {
    return null;
  }
}

export function getSessionFromCookie(cookieHeader: string | undefined): SessionUser | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match?.[1]) return null;
  return verifySession(match[1]);
}

function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  });
}

router.get('/config', (_req, res) => {
  res.json({ github: GITHUB_ENABLED, devLogin: env.DEV_LOGIN });
});

if (GITHUB_ENABLED) {
  router.get('/github', (_req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000,
    });
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
    url.searchParams.set('redirect_uri', GITHUB_CALLBACK);
    url.searchParams.set('scope', 'read:user');
    url.searchParams.set('state', state);
    res.redirect(url.toString());
  });

  router.get('/github/callback', async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : undefined;
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    const stateCookie = req.cookies?.[OAUTH_STATE_COOKIE];
    if (!code || !state || state !== stateCookie) {
      res.status(400).send('oauth: bad state');
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE);

    try {
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: GITHUB_CALLBACK,
        }),
      });
      const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
      if (!tokenJson.access_token) {
        res.status(400).send(`oauth: ${tokenJson.error ?? 'no access_token'}`);
        return;
      }

      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${tokenJson.access_token}`,
          Accept: 'application/vnd.github+json',
        },
      });
      if (!userRes.ok) {
        res.status(502).send('oauth: github user fetch failed');
        return;
      }
      const gh = (await userRes.json()) as {
        id: number;
        login: string;
        name: string | null;
        avatar_url: string | null;
      };

      const now = new Date();
      const result = await users().findOneAndUpdate(
        { githubId: gh.id },
        {
          $set: { login: gh.login, name: gh.name, avatarUrl: gh.avatar_url },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true, returnDocument: 'after' },
      );
      if (!result) {
        res.status(500).send('oauth: user upsert failed');
        return;
      }

      setSessionCookie(
        res,
        signSession({
          sub: String(result._id),
          githubId: result.githubId,
          login: result.login,
          name: result.name,
          avatarUrl: result.avatarUrl,
        }),
      );
      res.redirect(env.WEB_ORIGIN);
    } catch (err) {
      console.error('oauth callback failed:', err);
      res.status(500).send('oauth: server error');
    }
  });
}

if (env.DEV_LOGIN) {
  router.get('/dev-login', async (_req, res) => {
    const DEV_GITHUB_ID = -1;
    const now = new Date();
    const result = await users().findOneAndUpdate(
      { githubId: DEV_GITHUB_ID },
      {
        $set: {
          login: 'devuser',
          name: 'Dev User',
          avatarUrl: 'https://avatars.githubusercontent.com/u/0?v=4',
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true, returnDocument: 'after' },
    );
    if (!result) {
      res.status(500).send('dev-login: user upsert failed');
      return;
    }
    setSessionCookie(
      res,
      signSession({
        sub: String(result._id),
        githubId: result.githubId,
        login: result.login,
        name: result.name,
        avatarUrl: result.avatarUrl,
      }),
    );
    res.redirect(env.WEB_ORIGIN);
  });
}

router.get('/me', (req, res) => {
  const user = getSessionFromCookie(req.headers.cookie);
  if (!user) {
    res.status(401).json({ user: null });
    return;
  }
  res.json({ user });
});

router.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = getSessionFromCookie(req.headers.cookie);
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  (req as Request & { user: SessionUser }).user = user;
  next();
}

export { router as authRouter };
