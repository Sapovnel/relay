import { useParams } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { useEffect, useRef, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import { useAuth } from '../auth/AuthProvider';

const WS_URL = ((): string => {
  const fromEnv = import.meta.env.VITE_WS_URL as string | undefined;
  if (fromEnv) return fromEnv;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
})();

const LANGUAGES = ['javascript', 'typescript', 'python', 'markdown', 'plaintext'];
const RUNNABLE = new Set(['javascript', 'python']);
const LANG_EXT: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  go: 'go',
  markdown: 'md',
  plaintext: 'txt',
};
const COLOR_PALETTE = [
  '#f43f5e',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#eab308',
  '#06b6d4',
];

function colorFromId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return COLOR_PALETTE[Math.abs(h) % COLOR_PALETTE.length]!;
}

interface RoomInfo {
  id: string;
  name: string;
  language: string;
  ownerId: string;
  memberIds: string[];
}

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

interface ChatMsg {
  id: string;
  author: string;
  color: string;
  body: string;
  at: number;
}

export default function Room() {
  const { id } = useParams();
  const roomId = id ?? 'unknown';
  const { user } = useAuth();
  const [ed, setEd] = useState<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const [monacoNs, setMonacoNs] = useState<typeof Monaco | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [runOutput, setRunOutput] = useState<RunView | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [language, setLanguage] = useState('javascript');
  const [peerCount, setPeerCount] = useState(1);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [outputCopied, setOutputCopied] = useState(false);
  const chatArrRef = useRef<Y.Array<ChatMsg> | null>(null);
  const handleRunRef = useRef<() => void>(() => {});

  useEffect(() => {
    fetch(`/rooms/${roomId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((room: RoomInfo | null) => {
        if (!room) return;
        setRoomInfo(room);
        setLanguage(room.language);
      })
      .catch(() => {});
  }, [roomId]);

  useEffect(() => {
    if (!ed || !monacoNs) return;
    const model = ed.getModel();
    if (model) monacoNs.editor.setModelLanguage(model, language);
  }, [ed, monacoNs, language]);

  useEffect(() => {
    if (!ed) return;
    const model = ed.getModel();
    if (!model) return;

    const doc = new Y.Doc();
    const provider = new WebsocketProvider(WS_URL, roomId, doc);
    const yText = doc.getText('monaco');
    const binding = new MonacoBinding(yText, model, new Set([ed]), provider.awareness);

    if (user) {
      provider.awareness.setLocalStateField('user', {
        name: user.login,
        color: colorFromId(user.sub),
      });
    }

    const onStatus = (event: { status: 'connecting' | 'connected' | 'disconnected' }) => {
      setStatus(event.status);
    };
    provider.on('status', onStatus);

    const onAwareness = () => {
      setPeerCount(provider.awareness.getStates().size);
    };
    provider.awareness.on('change', onAwareness);
    onAwareness();

    const runMap = doc.getMap('run');
    const readRun = () => {
      const latest = runMap.get('latest') as RunView | undefined;
      setRunOutput(latest ?? null);
    };
    runMap.observe(readRun);
    readRun();

    const chatArr = doc.getArray<ChatMsg>('chat');
    chatArrRef.current = chatArr;
    const readChat = () => setMessages(chatArr.toArray());
    chatArr.observe(readChat);
    readChat();

    return () => {
      chatArr.unobserve(readChat);
      chatArrRef.current = null;
      runMap.unobserve(readRun);
      provider.awareness.off('change', onAwareness);
      provider.off('status', onStatus);
      binding.destroy();
      provider.destroy();
      doc.destroy();
    };
  }, [ed, roomId, user]);

  const runnable = RUNNABLE.has(language);

  const handleRun = async () => {
    if (triggering || !runnable) return;
    setTriggering(true);
    try {
      await fetch(`/rooms/${roomId}/run`, { method: 'POST', credentials: 'include' });
    } finally {
      setTriggering(false);
    }
  };

  useEffect(() => {
    handleRunRef.current = handleRun;
  });

  const handleLanguageChange = async (newLang: string) => {
    setLanguage(newLang);
    await fetch(`/rooms/${roomId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ language: newLang }),
    }).catch(() => {});
  };

  const sendMsg = () => {
    const arr = chatArrRef.current;
    if (!arr || !user || !draft.trim()) return;
    arr.push([
      {
        id: crypto.randomUUID(),
        author: user.login,
        color: colorFromId(user.sub),
        body: draft,
        at: Date.now(),
      },
    ]);
    setDraft('');
  };

  const handleDownload = () => {
    if (!ed) return;
    const content = ed.getModel()?.getValue() ?? '';
    const baseName = (roomInfo?.name ?? roomId).replace(/[^\w\-]+/g, '_') || 'sketch';
    const filename = `${baseName}.${LANG_EXT[language] ?? 'txt'}`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyOutput = async () => {
    if (!runOutput) return;
    const text = [runOutput.stdout, runOutput.stderr].filter(Boolean).join('\n');
    await navigator.clipboard.writeText(text);
    setOutputCopied(true);
    setTimeout(() => setOutputCopied(false), 1500);
  };

  const statusColor =
    status === 'connected'
      ? 'bg-green-500'
      : status === 'connecting'
        ? 'bg-yellow-500'
        : 'bg-red-500';
  const canRun = status === 'connected' && !triggering && runOutput?.status !== 'running' && runnable;

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
        <a href="/" className="text-sm text-gray-400 hover:text-gray-200">
          ←
        </a>
        <span className="font-mono text-xs uppercase tracking-wide text-gray-500">room</span>
        <span className="text-sm font-medium truncate max-w-xs">
          {roomInfo?.name ?? roomId}
        </span>
        <select
          value={language}
          onChange={(e) => handleLanguageChange(e.target.value)}
          className="ml-2 px-2 py-0.5 text-xs bg-gray-900 border border-gray-800 rounded"
        >
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <button
          onClick={handleRun}
          disabled={!canRun}
          title={runnable ? 'Run (Ctrl+Enter)' : `${language} is not runnable`}
          className="ml-auto px-3 py-1 text-xs font-medium bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:cursor-not-allowed rounded text-white"
        >
          {runOutput?.status === 'running' ? 'Running…' : 'Run ▶'}
        </button>
        <button
          onClick={handleDownload}
          title="Download as file"
          className="px-2 py-1 text-xs rounded border border-gray-800 hover:bg-gray-900 text-gray-300"
        >
          ↓ download
        </button>
        <button
          onClick={() => setChatOpen((v) => !v)}
          className="px-2 py-1 text-xs rounded border border-gray-800 hover:bg-gray-900 text-gray-300"
        >
          {chatOpen ? 'Hide chat' : `Chat${messages.length ? ` (${messages.length})` : ''}`}
        </button>
        <span className="text-xs text-gray-400 tabular-nums">
          {peerCount} {peerCount === 1 ? 'user' : 'users'}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-gray-400">
          <span className={`inline-block h-2 w-2 rounded-full ${statusColor}`} />
          {status}
        </span>
      </header>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <Editor
              key={roomId}
              height="100%"
              width="100%"
              defaultLanguage={language}
              theme="vs-dark"
              onMount={(editor, monaco) => {
                setEd(editor);
                setMonacoNs(monaco);
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
                  handleRunRef.current();
                });
              }}
              options={{
                fontSize: 14,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          </div>
        </div>
        {chatOpen && (
          <aside
            style={{
              width: 280,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              borderLeft: '1px solid rgb(31 41 55)',
            }}
          >
            <div style={{ flex: 1, overflow: 'auto' }} className="p-3 space-y-2">
              {messages.length === 0 ? (
                <p className="text-xs text-gray-600">No messages yet.</p>
              ) : (
                messages.map((m) => (
                  <div key={m.id}>
                    <div className="text-xs font-medium" style={{ color: m.color }}>
                      {m.author}
                    </div>
                    <div className="text-sm wrap-break-word whitespace-pre-wrap">{m.body}</div>
                  </div>
                ))
              )}
            </div>
            <div style={{ borderTop: '1px solid rgb(31 41 55)' }} className="p-2 flex gap-1">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMsg();
                  }
                }}
                placeholder="Message…"
                className="flex-1 px-2 py-1 text-xs bg-gray-900 border border-gray-800 rounded"
              />
              <button
                onClick={sendMsg}
                disabled={!draft.trim()}
                className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white"
              >
                send
              </button>
            </div>
          </aside>
        )}
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
                  <span className="text-red-400">[timed out]</span>
                )}
                {runOutput.oomKilled && <span className="text-red-400">[oom killed]</span>}
              </>
            )}
            {runOutput.status === 'error' && (
              <span className="text-red-400">error: {runOutput.error}</span>
            )}
            {(runOutput.stdout || runOutput.stderr) && (
              <button
                onClick={copyOutput}
                className="ml-auto text-xs px-2 py-0.5 rounded border border-gray-800 hover:bg-gray-900 text-gray-300"
              >
                {outputCopied ? 'copied!' : 'copy'}
              </button>
            )}
          </div>
          {runOutput.stdout && (
            <pre className="text-gray-100 whitespace-pre-wrap">{runOutput.stdout}</pre>
          )}
          {runOutput.stderr && (
            <pre className="text-red-300 whitespace-pre-wrap">{runOutput.stderr}</pre>
          )}
          {runOutput.status === 'done' && !runOutput.stdout && !runOutput.stderr && (
            <div className="text-gray-600">(no output)</div>
          )}
        </div>
      )}
    </div>
  );
}
