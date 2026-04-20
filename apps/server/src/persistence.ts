import * as Y from 'yjs';
// @ts-expect-error — y-websocket ships JS with no bundled types for this path
import { setPersistence } from 'y-websocket/bin/utils';
import { snapshots } from './mongo.js';

const DEBOUNCE_MS = 5000;
const debounceTimers = new Map<string, NodeJS.Timeout>();

async function saveSnapshot(docName: string, ydoc: Y.Doc): Promise<void> {
  const state = Y.encodeStateAsUpdate(ydoc);
  await snapshots().updateOne(
    { roomId: docName },
    { $set: { state: Buffer.from(state), updatedAt: new Date() } },
    { upsert: true },
  );
}

function asBytes(state: unknown): Uint8Array {
  if (state instanceof Uint8Array) return state;
  const withBuffer = state as { buffer?: unknown } | null;
  if (withBuffer && withBuffer.buffer instanceof Uint8Array) return withBuffer.buffer;
  throw new Error('unexpected snapshot state shape');
}

export function setupPersistence(): void {
  setPersistence({
    bindState: async (docName: string, ydoc: Y.Doc) => {
      const existing = await snapshots().findOne({ roomId: docName });
      if (existing?.state) {
        Y.applyUpdate(ydoc, asBytes(existing.state));
        console.log(`mongo: loaded snapshot for "${docName}"`);
      }
      ydoc.on('update', () => {
        const prev = debounceTimers.get(docName);
        if (prev) clearTimeout(prev);
        const timer = setTimeout(() => {
          debounceTimers.delete(docName);
          saveSnapshot(docName, ydoc).catch((err) =>
            console.error(`mongo: snapshot write failed for "${docName}":`, err),
          );
        }, DEBOUNCE_MS);
        debounceTimers.set(docName, timer);
      });
    },
    writeState: async (docName: string, ydoc: Y.Doc) => {
      const timer = debounceTimers.get(docName);
      if (timer) clearTimeout(timer);
      debounceTimers.delete(docName);
      await saveSnapshot(docName, ydoc);
      console.log(`mongo: flushed snapshot on last-leave for "${docName}"`);
    },
  });
}
