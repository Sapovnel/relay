import * as Y from 'yjs';
// @ts-expect-error — y-websocket ships JS with no bundled types for this path
import { docs } from 'y-websocket/bin/utils';
import { pub, sub, INSTANCE_ID } from './redis.js';

/**
 * Fan-out of Yjs updates across multiple collab-server instances via Redis
 * pub/sub. Each room maps to a channel; when one instance applies an update to
 * a live Y.Doc, it publishes the binary update so other instances can replay it
 * on their own copies and broadcast onward to their connected clients.
 *
 * Origin tagging: updates replayed from Redis carry the symbol REMOTE so our
 * own observer knows not to re-publish them (would infinite-loop otherwise).
 */
const REMOTE = Symbol('redis-remote');

const hookedDocs = new WeakSet<Y.Doc>();
const subscribedRooms = new Set<string>();

export function channelFor(roomId: string): string {
  return `relay:sync:${roomId}`;
}

/**
 * Wire a single Y.Doc to the Redis bus. Subscribes to the room's channel on
 * first call per roomId across the whole process.
 */
export async function attachRedisSync(roomId: string, ydoc: Y.Doc): Promise<void> {
  if (hookedDocs.has(ydoc)) return;
  hookedDocs.add(ydoc);

  ydoc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) return;
    const payload = Buffer.concat([
      Buffer.from(INSTANCE_ID.padEnd(36, ' ').slice(0, 36), 'utf8'),
      Buffer.from(update),
    ]);
    pub.publish(channelFor(roomId), payload as unknown as string).catch(() => {});
  });

  if (!subscribedRooms.has(roomId)) {
    subscribedRooms.add(roomId);
    await sub.subscribe(channelFor(roomId));
  }
}

/**
 * Process-wide handler. Parses (senderInstanceId, update) out of each published
 * message and applies it to the local Y.Doc if we hold one and it wasn't us.
 */
let handlerInstalled = false;
export function installSyncHandler(): void {
  if (handlerInstalled) return;
  handlerInstalled = true;

  // ioredis emits messageBuffer for buffer-safe payloads.
  sub.on('messageBuffer', (channelBuf: Buffer, message: Buffer) => {
    const channel = channelBuf.toString('utf8');
    if (!channel.startsWith('relay:sync:')) return;
    const roomId = channel.slice('relay:sync:'.length);

    const senderId = message.subarray(0, 36).toString('utf8').trim();
    if (senderId === INSTANCE_ID) return;

    const update = new Uint8Array(message.subarray(36));
    const ydoc = (docs as Map<string, Y.Doc>).get(roomId);
    if (!ydoc) return;

    Y.applyUpdate(ydoc, update, REMOTE);
  });
}
