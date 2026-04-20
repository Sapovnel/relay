import express, { type Response, type Request } from 'express';
import { ObjectId, type WithId } from 'mongodb';
import { requireAuth, type SessionUser } from './auth.js';
import { rooms, type RoomDoc } from './mongo.js';

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
