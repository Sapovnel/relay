import { useParams } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import type { editor } from 'monaco-editor';

const WS_URL = ((): string => {
  const fromEnv = import.meta.env.VITE_WS_URL as string | undefined;
  if (fromEnv) return fromEnv;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
})();

interface RunView {
  status: 'running' | 'done' | 'error';
  runBy?: string;
  startedAt?: number;
  finishedAt?: number;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  oomKilled?: boolean;
  durationMs?: number;
  error?: string;
}

export default function Room() {
  const { id } = useParams();
  const roomId = id ?? 'unknown';
  const [ed, setEd] = useState<editor.IStandaloneCodeEditor | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [runOutput, setRunOutput] = useState<RunView | null>(null);
  const [triggering, setTriggering] = useState(false);

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

    const runMap = doc.getMap('run');
    const readRun = () => {
      const latest = runMap.get('latest') as RunView | undefined;
      setRunOutput(latest ?? null);
    };
    runMap.observe(readRun);
    readRun();

    return () => {
      runMap.unobserve(readRun);
      provider.off('status', onStatus);
      binding.destroy();
      provider.destroy();
      doc.destroy();
    };
  }, [ed, roomId]);

  const handleRun = async () => {
    if (triggering) return;
    setTriggering(true);
    try {
      await fetch(`/rooms/${roomId}/run`, { method: 'POST', credentials: 'include' });
    } finally {
      setTriggering(false);
    }
  };

  const statusColor =
    status === 'connected'
      ? 'bg-green-500'
      : status === 'connecting'
        ? 'bg-yellow-500'
        : 'bg-red-500';

  const canRun = status === 'connected' && !triggering && runOutput?.status !== 'running';

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
        <button
          onClick={handleRun}
          disabled={!canRun}
          className="ml-auto px-3 py-1 text-xs font-medium bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:cursor-not-allowed rounded text-white"
        >
          {runOutput?.status === 'running' ? 'Running…' : 'Run ▶'}
        </button>
        <span className="flex items-center gap-2 text-xs text-gray-400">
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
      {runOutput && (
        <div
          style={{ height: 220, flexShrink: 0, overflow: 'auto' }}
          className="border-t border-gray-800 p-3 font-mono text-xs bg-gray-950"
        >
          <div className="text-gray-500 mb-2 flex items-center gap-2">
            {runOutput.status === 'running' && (
              <>
                <span className="inline-block h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />
                running · {runOutput.runBy}…
              </>
            )}
            {runOutput.status === 'done' && (
              <>
                <span>
                  {runOutput.runBy} · exit {runOutput.exitCode ?? '—'} · {runOutput.durationMs}ms
                </span>
                {runOutput.timedOut && (
                  <span className="text-red-400">[timed out at 5s]</span>
                )}
                {runOutput.oomKilled && (
                  <span className="text-red-400">[oom killed]</span>
                )}
              </>
            )}
            {runOutput.status === 'error' && (
              <span className="text-red-400">error: {runOutput.error}</span>
            )}
          </div>
          {runOutput.stdout && (
            <pre className="text-gray-100 whitespace-pre-wrap">{runOutput.stdout}</pre>
          )}
          {runOutput.stderr && (
            <pre className="text-red-300 whitespace-pre-wrap">{runOutput.stderr}</pre>
          )}
          {runOutput.status === 'done' &&
            !runOutput.stdout &&
            !runOutput.stderr && (
              <div className="text-gray-600">(no output)</div>
            )}
        </div>
      )}
    </div>
  );
}
