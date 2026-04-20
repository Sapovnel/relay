import { MongoClient, type Db, type Collection, type Binary } from 'mongodb';
import { env } from './env.js';

export interface SnapshotDoc {
  roomId: string;
  state: Buffer | Binary;
  updatedAt: Date;
}

export interface UserDoc {
  githubId: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: Date;
}

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectMongo(): Promise<void> {
  if (client) return;
  client = new MongoClient(env.MONGO_URL);
  await client.connect();
  db = client.db(env.MONGO_DB);
  await db.collection<SnapshotDoc>('snapshots').createIndex({ roomId: 1 }, { unique: true });
  await db.collection<UserDoc>('users').createIndex({ githubId: 1 }, { unique: true });
  console.log(`mongo connected: ${env.MONGO_DB}`);
}

function requireDb(): Db {
  if (!db) throw new Error('mongo not connected — call connectMongo() first');
  return db;
}

export function getDb(): Db {
  return requireDb();
}

export function snapshots(): Collection<SnapshotDoc> {
  return requireDb().collection<SnapshotDoc>('snapshots');
}

export function users(): Collection<UserDoc> {
  return requireDb().collection<UserDoc>('users');
}

export async function closeMongo(): Promise<void> {
  await client?.close();
  client = null;
  db = null;
}
