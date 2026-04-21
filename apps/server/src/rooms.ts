import express, { type Response, type Request } from 'express';
import { ObjectId, type WithId } from 'mongodb';
import { requireAuth, type SessionUser } from './auth.js';
import { rooms, snapshots, type RoomDoc } from './mongo.js';
import { env } from './env.js';
import { checkRateLimit } from './redis.js';
import { runsTotal, runDuration, rateLimitDenied } from './metrics.js';
// @ts-expect-error — y-websocket ships JS with no bundled types for this path
import { docs } from 'y-websocket/bin/utils';
import * as Y from 'yjs';

const router = express.Router();
router.use(requireAuth);

type AuthedReq = Request & { user: SessionUser };

const SUPPORTED_LANGUAGES = new Set([
  'javascript',
  'typescript',
  'python',
  'markdown',
  'plaintext',
]);

export const RUNNABLE_LANGUAGES = new Set(['javascript', 'python']);

function toDTO(r: WithId<RoomDoc>) {
  return {
    id: r._id.toHexString(),
    ownerId: r.ownerId,
    name: r.name,
    language: r.language,
    createdAt: r.createdAt,
    memberIds: r.memberIds,
  };
}

router.post('/', async (req, res: Response) => {
  const user = (req as unknown as AuthedReq).user;
  const { name, language } = req.body as { name?: unknown; language?: unknown };
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name required' });
    return;
  }
  const lang = typeof language === 'string' && SUPPORTED_LANGUAGES.has(language) ? language : 'javascript';
  const now = new Date();
  const result = await rooms().insertOne({
    ownerId: user.sub,
    name: name.trim().slice(0, 100),
    language: lang,
    createdAt: now,
    memberIds: [user.sub],
  });
  const doc = await rooms().findOne({ _id: result.insertedId });
  if (!doc) {
    res.status(500).json({ error: 'insert failed' });
    return;
  }
  res.json(toDTO(doc));
});

router.get('/', async (req, res: Response) => {
  const user = (req as unknown as AuthedReq).user;
  const list = await rooms()
    .find({ $or: [{ ownerId: user.sub }, { memberIds: user.sub }] })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();
  res.json({ rooms: list.map(toDTO) });
});

router.get('/:id', async (req, res: Response) => {
  const { id } = req.params;
  if (!id || !ObjectId.isValid(id)) {
    res.status(400).json({ error: 'bad id' });
    return;
  }
  const doc = await rooms().findOne({ _id: new ObjectId(id) });
  if (!doc) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json(toDTO(doc));
});

router.patch('/:id', async (req, res: Response) => {
  const user = (req as unknown as AuthedReq).user;
  const { id } = req.params;
  if (!id || !ObjectId.isValid(id)) {
    res.status(400).json({ error: 'bad id' });
    return;
  }
  const body = req.body as { language?: unknown; name?: unknown };
  const update: Partial<RoomDoc> = {};
  if (typeof body.language === 'string') {
    if (!SUPPORTED_LANGUAGES.has(body.language)) {
      res.status(400).json({ error: 'unsupported language' });
      return;
    }
    update.language = body.language;
  }
  if (typeof body.name === 'string' && body.name.trim()) {
    update.name = body.name.trim().slice(0, 100);
  }
  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: 'nothing to update' });
    return;
  }
  const result = await rooms().findOneAndUpdate(
    {
      _id: new ObjectId(id),
      $or: [{ ownerId: user.sub }, { memberIds: user.sub }],
    },
    { $set: update },
    { returnDocument: 'after' },
  );
  if (!result) {
    res.status(404).json({ error: 'not found or not a member' });
    return;
  }
  res.json(toDTO(result));
});

router.post('/:id/join', async (req, res: Response) => {
  const user = (req as unknown as AuthedReq).user;
  const { id } = req.params;
  if (!id || !ObjectId.isValid(id)) {
    res.status(400).json({ error: 'bad id' });
    return;
  }
  const result = await rooms().findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $addToSet: { memberIds: user.sub } },
    { returnDocument: 'after' },
  );
  if (!result) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json(toDTO(result));
});

router.delete('/:id', async (req, res: Response) => {
  const user = (req as unknown as AuthedReq).user;
  const { id } = req.params;
  if (!id || !ObjectId.isValid(id)) {
    res.status(400).json({ error: 'bad id' });
    return;
  }
  const result = await rooms().findOneAndDelete({
    _id: new ObjectId(id),
    ownerId: user.sub,
  });
  if (!result) {
    res.status(404).json({ error: 'not found or not owner' });
    return;
  }
  await snapshots()
    .deleteOne({ roomId: id })
    .catch(() => {});
  res.json({ ok: true });
});

router.post('/:id/fork', async (req, res: Response) => {
  const user = (req as unknown as AuthedReq).user;
  const { id } = req.params;
  if (!id || !ObjectId.isValid(id)) {
    res.status(400).json({ error: 'bad id' });
    return;
  }
  const source = await rooms().findOne({ _id: new ObjectId(id) });
  if (!source) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const allowed = source.ownerId === user.sub || source.memberIds.includes(user.sub);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  // Prefer the live in-memory doc (freshest); fall back to last snapshot on disk.
  const liveDoc = (docs as Map<string, Y.Doc>).get(id);
  let stateBytes: Buffer;
  if (liveDoc) {
    stateBytes = Buffer.from(Y.encodeStateAsUpdate(liveDoc));
  } else {
    const snap = await snapshots().findOne({ roomId: id });
    if (!snap?.state) {
      res.status(400).json({ error: 'source room has no persisted state yet' });
      return;
    }
    const raw = snap.state as { buffer?: unknown } | Uint8Array;
    if (raw instanceof Uint8Array) {
      stateBytes = Buffer.from(raw);
    } else if (raw.buffer instanceof Uint8Array) {
      stateBytes = Buffer.from(raw.buffer);
    } else {
      res.status(500).json({ error: 'cannot read source state' });
      return;
    }
  }

  const now = new Date();
  const inserted = await rooms().insertOne({
    ownerId: user.sub,
    name: `${source.name} (fork)`.slice(0, 100),
    language: source.language,
    createdAt: now,
    memberIds: [user.sub],
  });
  await snapshots().insertOne({
    roomId: inserted.insertedId.toHexString(),
    state: stateBytes,
    updatedAt: now,
  });
  const newDoc = await rooms().findOne({ _id: inserted.insertedId });
  if (!newDoc) {
    res.status(500).json({ error: 'fork failed' });
    return;
  }
  res.json(toDTO(newDoc));
});

router.post('/:id/run', async (req, res: Response) => {
  const user = (req as unknown as AuthedReq).user;
  const { id } = req.params;
  if (!id || !ObjectId.isValid(id)) {
    res.status(400).json({ error: 'bad id' });
    return;
  }
  const room = await rooms().findOne({ _id: new ObjectId(id) });
  if (!room) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const allowed = room.ownerId === user.sub || room.memberIds.includes(user.sub);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  const ydoc = (docs as Map<string, Y.Doc>).get(id);
  if (!ydoc) {
    res.status(400).json({ error: 'no active session for this room (open the room in a browser first)' });
    return;
  }

  const body = (req.body as { stdin?: unknown; fileName?: unknown } | undefined) ?? {};
  const stdinStr = typeof body.stdin === 'string' ? body.stdin : '';
  const requestedFile = typeof body.fileName === 'string' ? body.fileName : null;

  // Determine which file to run + its effective language.
  const filesMap = ydoc.getMap('files') as Y.Map<Y.Text>;
  const fileMetaMap = ydoc.getMap('fileMeta') as Y.Map<{ language?: string }>;
  let code = '';
  let runLanguage = room.language;
  if (requestedFile && filesMap.has(requestedFile)) {
    code = (filesMap.get(requestedFile) as Y.Text).toString();
    const meta = fileMetaMap.get(requestedFile);
    if (meta?.language) runLanguage = meta.language;
  } else if (filesMap.size > 0) {
    // No explicit file requested — pick the first file.
    const firstName = Array.from(filesMap.keys())[0]!;
    code = (filesMap.get(firstName) as Y.Text).toString();
    const meta = fileMetaMap.get(firstName);
    if (meta?.language) runLanguage = meta.language;
  } else {
    // Legacy single-file rooms stored source under a top-level Y.Text.
    code = ydoc.getText('monaco').toString();
  }

  if (!RUNNABLE_LANGUAGES.has(runLanguage)) {
    res.status(400).json({ error: `language "${runLanguage}" is not runnable` });
    return;
  }

  // Per-user sliding-window rate limit for /run (default 10 per 60 s).
  const limit = await checkRateLimit(
    `ratelimit:run:${user.sub}`,
    env.RUN_RATE_LIMIT,
    env.RUN_RATE_WINDOW_MS,
  );
  if (!limit.allowed) {
    rateLimitDenied.inc({ bucket: 'run' });
    res.setHeader('Retry-After', String(limit.retryAfterSec));
    res.status(429).json({
      error: 'rate limit exceeded',
      retryAfterSec: limit.retryAfterSec,
    });
    return;
  }

  const runMap = ydoc.getMap('run');

  runMap.set('latest', {
    status: 'running',
    runBy: user.login,
    startedAt: Date.now(),
  });

  const runTimer = runDuration.startTimer({ language: runLanguage });
  try {
    const upstream = await fetch(`${env.EXECUTOR_URL}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: runLanguage, code, stdin: stdinStr }),
    });
    const result = (await upstream.json()) as Record<string, unknown> & {
      exitCode?: number | null;
      timedOut?: boolean;
      oomKilled?: boolean;
    };
    runTimer();
    const outcome =
      result.timedOut === true
        ? 'timeout'
        : result.oomKilled === true
          ? 'oom'
          : result.exitCode === 0
            ? 'success'
            : 'failure';
    runsTotal.inc({ language: runLanguage, outcome });
    runMap.set('latest', {
      status: 'done',
      runBy: user.login,
      finishedAt: Date.now(),
      ...result,
    });
    res.json(result);
  } catch (err) {
    runTimer();
    runsTotal.inc({ language: runLanguage, outcome: 'executor_error' });
    runMap.set('latest', {
      status: 'error',
      runBy: user.login,
      error: 'executor unreachable',
      finishedAt: Date.now(),
    });
    res.status(502).json({ error: 'executor unreachable' });
  }
});

export { router as roomsRouter };

export async function isMember(roomId: string, userId: string): Promise<boolean> {
  if (!ObjectId.isValid(roomId)) return false;
  const doc = await rooms().findOne(
    { _id: new ObjectId(roomId) },
    { projection: { ownerId: 1, memberIds: 1 } },
  );
  if (!doc) return false;
  return doc.ownerId === userId || doc.memberIds.includes(userId);
}
