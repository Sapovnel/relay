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
  const [peers, setPeers] = useState<
    { clientId: number; name: string; color: string; isMe: boolean }[]
  >([]);
  const [followingId, setFollowingId] = useState<number | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [outputCopied, setOutputCopied] = useState(false);
  const [stdinOpen, setStdinOpen] = useState(false);
  const [stdin, setStdin] = useState('');
  const stdinRef = useRef(stdin);
  useEffect(() => {
    stdinRef.current = stdin;
  }, [stdin]);
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

    const myClientId = provider.awareness.clientID;
    const onAwareness = () => {
      const entries = Array.from(provider.awareness.getStates().entries()) as [
        number,
        { user?: { name: string; color: string } },
      ][];
      setPeers(
        entries
          .filter(([, s]) => s.user)
          .map(([clientId, s]) => ({
            clientId,
            name: s.user!.name,
            color: s.user!.color,
            isMe: clientId === myClientId,
          })),
      );
    };
    provider.awareness.on('change', onAwareness);
    onAwareness();

    // Publish our own Monaco cursor position so others can follow us.
    const publishCursor = () => {
      const pos = ed.getPosition();
      if (!pos) return;
      provider.awareness.setLocalStateField('monacoCursor', {
        lineNumber: pos.lineNumber,
        column: pos.column,
      });
    };
    const cursorDisposer = ed.onDidChangeCursorPosition(publishCursor);
    publishCursor();

    // Follow another peer: whenever their cursor moves, center it in the editor.
    const onFollow = () => {
      if (followingIdRef.current == null) return;
      const state = provider.awareness.getStates().get(followingIdRef.current) as
        | { monacoCursor?: { lineNumber: number; column: number } }
        | undefined;
      if (!state?.monacoCursor) return;
      ed.revealPositionInCenterIfOutsideViewport({
        lineNumber: state.monacoCursor.lineNumber,
        column: state.monacoCursor.column,
      });
    };
    provider.awareness.on('change', onFollow);

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
      cursorDisposer.dispose();
      provider.awareness.off('change', onFollow);
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

  const followingIdRef = useRef<number | null>(null);
  useEffect(() => {
    followingIdRef.current = followingId;
  }, [followingId]);

  const runnable = RUNNABLE.has(language);

  const handleRun = async () => {
    if (triggering || !runnable) return;
    setTriggering(true);
    try {
      await fetch(`/rooms/${roomId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ stdin: stdinRef.current }),
      });
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
      className="text-[color:var(--text-primary)]"
    >
      <header
        style={{ flexShrink: 0 }}
        className="glass border-b border-white/[0.06] px-4 py-2.5 flex items-center gap-3"
      >
        <a
          href="/"
          className="text-sm text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] transition"
          title="Back to rooms"
        >
          ←
        </a>
        <span className="wordmark text-sm hidden sm:inline">
          code<span className="wordmark-accent">E</span>
        </span>
        <span className="h-4 w-px bg-white/10 hidden sm:inline-block" />
        <span className="text-sm font-medium truncate max-w-xs text-[color:var(--text-primary)]">
          {roomInfo?.name ?? roomId}
        </span>
        <select
          value={language}
          onChange={(e) => handleLanguageChange(e.target.value)}
          className="ml-1 input-field !py-1 !px-2 !text-xs"
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
          className="ml-auto btn-primary !py-1.5 !px-3 !text-xs"
        >
          {runOutput?.status === 'running' ? 'Running…' : 'Run ▶'}
        </button>
        <button
          onClick={() => setStdinOpen((v) => !v)}
          title="Program stdin"
          className="btn-secondary"
        >
          {stdinOpen ? 'Hide stdin' : `Stdin${stdin ? ' •' : ''}`}
        </button>
        <button
          onClick={handleDownload}
          title="Download as file"
          className="btn-secondary"
        >
          ↓ download
        </button>
        <button
          onClick={() => setChatOpen((v) => !v)}
          className="btn-secondary"
        >
          {chatOpen ? 'Hide chat' : `Chat${messages.length ? ` (${messages.length})` : ''}`}
        </button>
        <div className="flex items-center gap-1">
          {peers.slice(0, 5).map((p, i) => {
            const isFollowed = followingId === p.clientId;
            return (
              <button
                key={`${p.clientId}-${i}`}
                onClick={() => {
                  if (p.isMe) return;
                  setFollowingId((cur) => (cur === p.clientId ? null : p.clientId));
                }}
                title={
                  p.isMe
                    ? `${p.name} (you)`
                    : isFollowed
                      ? `Following ${p.name} — click to stop`
                      : `Click to follow ${p.name}`
                }
                disabled={p.isMe}
                className={`inline-flex h-6 w-6 rounded-full text-[10px] font-bold items-center justify-center text-white transition ${
                  p.isMe ? 'cursor-default' : 'cursor-pointer hover:scale-110'
                } ${isFollowed ? 'ring-2 ring-[color:var(--accent)] ring-offset-2 ring-offset-[color:var(--bg-base)]' : 'ring-2 ring-[color:var(--bg-base)]'}`}
                style={{ backgroundColor: p.color, marginLeft: i > 0 ? -8 : 0 }}
              >
                {p.name.slice(0, 1).toUpperCase()}
              </button>
            );
          })}
          {peers.length > 5 && (
            <span className="text-xs text-[color:var(--text-secondary)] ml-1">
              +{peers.length - 5}
            </span>
          )}
          {followingId !== null && (
            <button
              onClick={() => setFollowingId(null)}
              className="ml-2 text-[10px] uppercase tracking-wider text-[color:var(--accent)] hover:text-white transition"
              title="Stop following (Esc)"
            >
              ● following
            </button>
          )}
        </div>
        <span className="flex items-center gap-1.5 text-xs text-[color:var(--text-secondary)]">
          <span
            className={`inline-block h-2 w-2 rounded-full ${statusColor} ${status === 'connected' ? 'pulse-dot' : ''}`}
          />
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
              width: 300,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              borderLeft: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
            }}
          >
            <div className="px-3 py-2.5 border-b border-white/[0.06] text-xs font-medium text-[color:var(--text-secondary)] uppercase tracking-wide">
              Chat · {messages.length}
            </div>
            <div style={{ flex: 1, overflow: 'auto' }} className="p-3 space-y-3">
              {messages.length === 0 ? (
                <p className="text-xs text-[color:var(--text-tertiary)]">
                  No messages yet. Press Enter to send.
                </p>
              ) : (
                messages.map((m) => (
                  <div key={m.id}>
                    <div className="text-xs font-semibold mb-0.5" style={{ color: m.color }}>
                      {m.author}
                    </div>
                    <div className="text-sm wrap-break-word whitespace-pre-wrap text-[color:var(--text-primary)]">
                      {m.body}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="p-2 flex gap-1.5 border-t border-white/[0.06]">
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
                className="input-field flex-1 !py-1.5 !text-xs"
              />
              <button
                onClick={sendMsg}
                disabled={!draft.trim()}
                className="btn-primary !py-1.5 !px-3 !text-xs"
              >
                send
              </button>
            </div>
          </aside>
        )}
      </div>
      {stdinOpen && (
        <div
          style={{ flexShrink: 0, background: 'var(--bg-surface)' }}
          className="border-t border-white/[0.06] px-4 py-2"
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] uppercase tracking-wider text-[color:var(--text-secondary)] font-semibold">
              stdin
            </span>
            <span className="text-[10px] text-[color:var(--text-tertiary)]">
              piped to the program on Run
            </span>
          </div>
          <textarea
            value={stdin}
            onChange={(e) => setStdin(e.target.value)}
            placeholder="e.g. input for readline / input() …"
            spellCheck={false}
            rows={3}
            className="input-field w-full font-mono text-xs !py-2 resize-none"
          />
        </div>
      )}
      {runOutput && (
        <div
          style={{ height: 240, flexShrink: 0, overflow: 'auto', background: 'var(--bg-surface)' }}
          className="border-t border-white/[0.06] font-mono text-xs"
        >
          <div
            style={{ background: 'var(--bg-surface)', position: 'sticky', top: 0, zIndex: 1 }}
            className="px-4 py-2 border-b border-white/[0.06] text-[color:var(--text-secondary)] flex items-center gap-2"
          >
            {runOutput.status === 'running' && (
              <>
                <span className="inline-block h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
                <span className="text-[color:var(--text-primary)]">running</span>
                <span>·</span>
                <span>{runOutput.runBy}</span>
              </>
            )}
            {runOutput.status === 'done' && (
              <>
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    runOutput.exitCode === 0 && !runOutput.timedOut && !runOutput.oomKilled
                      ? 'bg-green-400'
                      : 'bg-red-400'
                  }`}
                />
                <span className="text-[color:var(--text-primary)]">{runOutput.runBy}</span>
                <span>·</span>
                <span>exit {runOutput.exitCode ?? '—'}</span>
                <span>·</span>
                <span>{runOutput.durationMs}ms</span>
                {runOutput.timedOut && <span className="text-red-400">· timed out</span>}
                {runOutput.oomKilled && <span className="text-red-400">· oom killed</span>}
              </>
            )}
            {runOutput.status === 'error' && (
              <span className="text-red-400">error: {runOutput.error}</span>
            )}
            {(runOutput.stdout || runOutput.stderr) && (
              <button onClick={copyOutput} className="ml-auto btn-secondary !py-0.5 !px-2">
                {outputCopied ? 'copied!' : 'copy'}
              </button>
            )}
          </div>
          <div className="px-4 py-3">
            {runOutput.stdout && (
              <pre className="text-[color:var(--text-primary)] whitespace-pre-wrap leading-relaxed">
                {runOutput.stdout}
              </pre>
            )}
            {runOutput.stderr && (
              <pre className="text-red-300 whitespace-pre-wrap leading-relaxed">
                {runOutput.stderr}
              </pre>
            )}
            {runOutput.status === 'done' && !runOutput.stdout && !runOutput.stderr && (
              <div className="text-[color:var(--text-tertiary)] italic">(no output)</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
