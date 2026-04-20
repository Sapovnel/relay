import { useParams } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import type { editor } from 'monaco-editor';

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? 'ws://localhost:4000';

export default function Room() {
  const { id } = useParams();
  const roomId = id ?? 'unknown';
  const [ed, setEd] = useState<editor.IStandaloneCodeEditor | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

  useEffect(() => {
    if (!ed) return;
    const model = ed.getModel();
    if (!model) return;

    const doc = new Y.Doc();
    const provider = new WebsocketProvider(WS_URL, roomId, doc);
    const yText = doc.getText('monaco');
    const binding = new MonacoBinding(yText, model, new Set([ed]), provider.awareness);

    const onStatus = (event: { status: 'connecting' | 'connected' | 'disconnected' }) => {
      setStatus(event.status);
    };
    provider.on('status', onStatus);

    return () => {
      provider.off('status', onStatus);
      binding.destroy();
      provider.destroy();
      doc.destroy();
    };
  }, [ed, roomId]);

  const statusColor =
    status === 'connected'
      ? 'bg-green-500'
      : status === 'connecting'
        ? 'bg-yellow-500'
        : 'bg-red-500';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
      className="bg-gray-950 text-gray-100"
    >
      <header
        style={{ flexShrink: 0 }}
        className="px-4 py-2 border-b border-gray-800 flex items-center gap-3"
      >
        <span className="font-mono text-xs uppercase tracking-wide text-gray-500">room</span>
        <span className="font-mono text-sm">{roomId}</span>
        <span className="ml-auto flex items-center gap-2 text-xs text-gray-400">
          <span className={`inline-block h-2 w-2 rounded-full ${statusColor}`} />
          {status}
        </span>
      </header>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <Editor
            key={roomId}
            height="100%"
            width="100%"
            defaultLanguage="javascript"
            theme="vs-dark"
            onMount={(editor) => setEd(editor)}
            options={{
              fontSize: 14,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        </div>
      </div>
    </div>
  );
}
