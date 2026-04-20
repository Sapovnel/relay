import { MongoClient, type Collection, type Binary } from 'mongodb';

const MONGO_URL = process.env.MONGO_URL ?? 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGO_DB ?? 'codee';

export interface SnapshotDoc {
  roomId: string;
  state: Buffer | Binary;
  updatedAt: Date;
}

let client: MongoClient | null = null;
let snapshotsCol: Collection<SnapshotDoc> | null = null;

export async function connectMongo(): Promise<void> {
  if (client) return;
  client = new MongoClient(MONGO_URL);
  await client.connect();
  const db = client.db(DB_NAME);
  snapshotsCol = db.collection<SnapshotDoc>('snapshots');
  await snapshotsCol.createIndex({ roomId: 1 }, { unique: true });
  console.log(`mongo connected: ${DB_NAME}`);
}

export function snapshots(): Collection<SnapshotDoc> {
  if (!snapshotsCol) throw new Error('mongo not connected — call connectMongo() first');
  return snapshotsCol;
}

export async function closeMongo(): Promise<void> {
  await client?.close();
  client = null;
  snapshotsCol = null;
}
