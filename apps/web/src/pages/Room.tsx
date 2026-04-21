import { useParams } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import { useAuth } from '../auth/AuthProvider';
import { CommandPalette, type Command } from '../components/CommandPalette';
import { ShortcutsHelp } from '../components/ShortcutsHelp';

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
  markdown: 'md',
  plaintext: 'txt',
};

const EXT_TO_LANG: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  py: 'python',
  md: 'markdown',
  txt: 'plaintext',
};

function langFromFilename(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_LANG[ext] ?? 'plaintext';
}

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

interface FileMeta {
  language?: string;
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
  const [peers, setPeers] = useState<
    { clientId: number; name: string; color: string; isMe: boolean }[]
  >([]);
  const [followingId, setFollowingId] = useState<number | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [outputCopied, setOutputCopied] = useState(false);
  const [stdinOpen, setStdinOpen] = useState(false);
  const [stdin, setStdin] = useState('');
  const [expectedOpen, setExpectedOpen] = useState(false);
  const [expected, setExpected] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [lastReadCount, setLastReadCount] = useState<number>(() => {
    const stored = localStorage.getItem(`codee-lastread-${roomId}`);
    return stored ? parseInt(stored, 10) : 0;
  });
  const [files, setFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);

  const docRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);
  const chatArrRef = useRef<Y.Array<ChatMsg> | null>(null);
  const filesMapRef = useRef<Y.Map<Y.Text> | null>(null);
  const fileMetaRef = useRef<Y.Map<FileMeta> | null>(null);
  const handleRunRef = useRef<() => void>(() => {});
  const stdinRef = useRef(stdin);
  const followingIdRef = useRef<number | null>(null);

  useEffect(() => {
    stdinRef.current = stdin;
  }, [stdin]);
  useEffect(() => {
    followingIdRef.current = followingId;
  }, [followingId]);

  // Fetch room info once on mount.
  useEffect(() => {
    fetch(`/rooms/${roomId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((room: RoomInfo | null) => {
        if (room) setRoomInfo(room);
      })
      .catch(() => {});
  }, [roomId]);

  // Main room session: create Y.Doc, provider, hook up awareness/chat/run/files.
  // Note: does NOT create the MonacoBinding — that's in a separate effect below
  // keyed on activeFile so we can swap files.
  useEffect(() => {
    if (!ed) return;

    const doc = new Y.Doc();
    const provider = new WebsocketProvider(WS_URL, roomId, doc);
    docRef.current = doc;
    providerRef.current = provider;

    const filesMap = doc.getMap<Y.Text>('files');
    const fileMetaMap = doc.getMap<FileMeta>('fileMeta');
    filesMapRef.current = filesMap;
    fileMetaRef.current = fileMetaMap;

    if (user) {
      provider.awareness.setLocalStateField('user', {
        name: user.login,
        color: colorFromId(user.sub),
      });
    }

    const onStatus = (e: { status: 'connecting' | 'connected' | 'disconnected' }) => {
      setStatus(e.status);
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

    const publishCursor = () => {
      const pos = ed.getPosition();
      if (!pos) return;
      provider.awareness.setLocalStateField('monacoCursor', {
        lineNumber: pos.lineNumber,
        column: pos.column,
      });
    };
    const cursorDisposer = ed.onDidChangeCursorPosition(publishCursor);

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
      setRunOutput((runMap.get('latest') as RunView | undefined) ?? null);
    };
    runMap.observe(readRun);
    readRun();

    const chatArr = doc.getArray<ChatMsg>('chat');
    chatArrRef.current = chatArr;
    const readChat = () => setMessages(chatArr.toArray());
    chatArr.observe(readChat);
    readChat();

    // Once we have the initial state from the server, set up the file list.
    // If this is a brand-new room (no files) we bootstrap a default file.
    // If it's a legacy room that only has a top-level Y.Text, we migrate it.
    const readFiles = () => {
      setFiles(Array.from(filesMap.keys()).sort());
    };
    filesMap.observe(readFiles);

    const onSync = (isSynced: boolean) => {
      if (!isSynced) return;
      // Room is fully synced with server — safe to initialize / migrate.
      if (filesMap.size === 0) {
        const legacyText = doc.getText('monaco').toString();
        if (legacyText.length > 0) {
          // migrate legacy single-file room into a new files map entry
          const lang = roomInfo?.language ?? 'javascript';
          const ext = LANG_EXT[lang] ?? 'txt';
          const filename = `main.${ext}`;
          doc.transact(() => {
            const yt = new Y.Text();
            yt.insert(0, legacyText);
            filesMap.set(filename, yt);
            fileMetaMap.set(filename, { language: lang });
          });
        } else {
          const lang = roomInfo?.language ?? 'javascript';
          const ext = LANG_EXT[lang] ?? 'txt';
          const filename = `main.${ext}`;
          doc.transact(() => {
            filesMap.set(filename, new Y.Text());
            fileMetaMap.set(filename, { language: lang });
          });
        }
      }
      // Pick first file as active if none selected yet.
      setActiveFile((cur) => cur ?? Array.from(filesMap.keys()).sort()[0] ?? null);
      readFiles();
    };
    provider.on('sync', onSync);

    return () => {
      filesMap.unobserve(readFiles);
      provider.off('sync', onSync);
      cursorDisposer.dispose();
      provider.awareness.off('change', onFollow);
      chatArr.unobserve(readChat);
      chatArrRef.current = null;
      runMap.unobserve(readRun);
      provider.awareness.off('change', onAwareness);
      provider.off('status', onStatus);
      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }
      provider.destroy();
      doc.destroy();
      docRef.current = null;
      providerRef.current = null;
      filesMapRef.current = null;
      fileMetaRef.current = null;
    };
    // roomInfo is intentionally not a dep — it's only used at migration time,
    // after first sync. Re-running this effect would tear down the whole session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ed, roomId, user]);

  // Monaco binding: swap when active file changes.
  useEffect(() => {
    if (!ed || !monacoNs) return;
    const filesMap = filesMapRef.current;
    const provider = providerRef.current;
    if (!filesMap || !provider || !activeFile) return;
    const yText = filesMap.get(activeFile);
    if (!yText) return;

    // Out with the old binding.
    if (bindingRef.current) {
      bindingRef.current.destroy();
      bindingRef.current = null;
    }

    const model = ed.getModel();
    if (!model) return;

    // Reset model to Y.Text content, then bind. MonacoBinding will keep them
    // in sync from here on. Setting value before bind avoids a flash of stale text.
    const nextLang =
      fileMetaRef.current?.get(activeFile)?.language ?? langFromFilename(activeFile);
    monacoNs.editor.setModelLanguage(model, nextLang);
    model.setValue(yText.toString());

    const binding = new MonacoBinding(yText, model, new Set([ed]), provider.awareness);
    bindingRef.current = binding;

    return () => {
      if (bindingRef.current === binding) {
        binding.destroy();
        bindingRef.current = null;
      }
    };
  }, [ed, monacoNs, activeFile]);

  // Global keyboard shortcuts: Ctrl+Shift+P (palette), ? (help), Esc (exit follow).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      // `?` only when we're not typing into an input/textarea/Monaco.
      const target = e.target as HTMLElement | null;
      const isEditing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.closest('.monaco-editor'));
      if (e.key === '?' && !isEditing) {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (e.key === 'Escape') {
        setFollowingId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Mark chat as read when the panel is open.
  useEffect(() => {
    if (chatOpen) {
      setLastReadCount(messages.length);
      localStorage.setItem(`codee-lastread-${roomId}`, String(messages.length));
    }
  }, [chatOpen, messages.length, roomId]);

  const unreadChat = chatOpen ? 0 : Math.max(0, messages.length - lastReadCount);

  const activeLanguage =
    (activeFile && fileMetaRef.current?.get(activeFile)?.language) ??
    (activeFile && langFromFilename(activeFile)) ??
    'javascript';
  const runnable = RUNNABLE.has(activeLanguage);
  const canRun =
    status === 'connected' && !triggering && runOutput?.status !== 'running' && runnable;

  const handleRun = async () => {
    if (triggering || !runnable || !activeFile) return;
    setTriggering(true);
    try {
      await fetch(`/rooms/${roomId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ stdin: stdinRef.current, fileName: activeFile }),
      });
    } finally {
      setTriggering(false);
    }
  };

  useEffect(() => {
    handleRunRef.current = handleRun;
  });

  const handleLanguageChange = (newLang: string) => {
    if (!activeFile) return;
    const metaMap = fileMetaRef.current;
    if (!metaMap) return;
    metaMap.set(activeFile, { ...(metaMap.get(activeFile) ?? {}), language: newLang });
    if (ed && monacoNs) {
      const model = ed.getModel();
      if (model) monacoNs.editor.setModelLanguage(model, newLang);
    }
  };

  const createFile = () => {
    const filesMap = filesMapRef.current;
    const metaMap = fileMetaRef.current;
    const doc = docRef.current;
    if (!filesMap || !metaMap || !doc) return;
    const base = prompt('New file name:', 'util.js');
    if (!base) return;
    const name = base.trim();
    if (!name) return;
    if (filesMap.has(name)) {
      alert(`${name} already exists.`);
      return;
    }
    doc.transact(() => {
      filesMap.set(name, new Y.Text());
      metaMap.set(name, { language: langFromFilename(name) });
    });
    setActiveFile(name);
  };

  const deleteFile = (name: string) => {
    const filesMap = filesMapRef.current;
    const metaMap = fileMetaRef.current;
    const doc = docRef.current;
    if (!filesMap || !metaMap || !doc) return;
    if (filesMap.size <= 1) {
      alert("Can't delete the last file.");
      return;
    }
    if (!confirm(`Delete ${name}?`)) return;
    doc.transact(() => {
      filesMap.delete(name);
      metaMap.delete(name);
    });
    if (activeFile === name) {
      const next = Array.from(filesMap.keys()).sort()[0] ?? null;
      setActiveFile(next);
    }
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
    if (!ed || !activeFile) return;
    const content = ed.getModel()?.getValue() ?? '';
    const safe = activeFile.replace(/[^\w\-.]+/g, '_');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safe || 'file.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  interface TestResult {
    name: string;
    pass: boolean;
    detail?: string;
  }

  const testResults: TestResult[] = useMemo(() => {
    const stdout = runOutput?.stdout;
    if (!stdout) return [];
    return stdout
      .split('\n')
      .map((line) => {
        const p = line.match(/^PASS: (.+)$/);
        if (p) return { name: p[1]!, pass: true };
        const f = line.match(/^FAIL: (.+?)(?:\s+—\s+(.+))?$/);
        if (f) return { name: f[1]!, pass: false, detail: f[2] };
        return null;
      })
      .filter((x): x is TestResult => x !== null);
  }, [runOutput?.stdout]);

  const testSummary = useMemo(() => {
    if (testResults.length === 0) return null;
    const passed = testResults.filter((r) => r.pass).length;
    return { total: testResults.length, passed, failed: testResults.length - passed };
  }, [testResults]);

  const expectedMatch = useMemo(() => {
    if (!expected.trim() || runOutput?.status !== 'done') return null;
    const actual = (runOutput.stdout ?? '')
      .split('\n')
      .filter((l) => !/^(PASS|FAIL): /.test(l))
      .join('\n')
      .trim();
    return actual === expected.trim();
  }, [expected, runOutput]);

  const copyOutput = async () => {
    if (!runOutput) return;
    const text = [runOutput.stdout, runOutput.stderr].filter(Boolean).join('\n');
    await navigator.clipboard.writeText(text);
    setOutputCopied(true);
    setTimeout(() => setOutputCopied(false), 1500);
  };

  const commands: Command[] = useMemo(
    () => {
      const langCmds: Command[] = LANGUAGES.map((l) => ({
        id: `lang-${l}`,
        label: `Set file language: ${l}`,
        hint: RUNNABLE.has(l) ? 'runnable' : '',
        run: () => handleLanguageChange(l),
      }));
      const fileCmds: Command[] = files.map((name) => ({
        id: `file-${name}`,
        label: `Open file: ${name}`,
        run: () => setActiveFile(name),
      }));
      return [
        { id: 'run', label: 'Run code', hint: 'Ctrl+Enter', disabled: !canRun, run: handleRun },
        { id: 'new-file', label: 'New file…', run: createFile },
        {
          id: 'fork',
          label: 'Fork this room',
          run: async () => {
            const res = await fetch(`/rooms/${roomId}/fork`, {
              method: 'POST',
              credentials: 'include',
            });
            if (!res.ok) return;
            const room: { id: string } = await res.json();
            window.location.href = `/room/${room.id}`;
          },
        },
        { id: 'help', label: 'Keyboard shortcuts', hint: '?', run: () => setHelpOpen(true) },
        { id: 'chat', label: chatOpen ? 'Hide chat' : 'Open chat', run: () => setChatOpen((v) => !v) },
        {
          id: 'stdin',
          label: stdinOpen ? 'Hide stdin input' : 'Show stdin input',
          run: () => setStdinOpen((v) => !v),
        },
        { id: 'download', label: 'Download current file', run: handleDownload },
        {
          id: 'copy-link',
          label: 'Copy shareable link',
          run: () => {
            navigator.clipboard.writeText(`${window.location.origin}/join/${roomId}`);
          },
        },
        {
          id: 'home',
          label: 'Back to rooms',
          run: () => {
            window.location.href = '/';
          },
        },
        ...fileCmds,
        ...langCmds,
      ];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canRun, chatOpen, stdinOpen, activeLanguage, roomId, files, activeFile],
  );

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
        {activeFile && (
          <>
            <span className="text-[color:var(--text-tertiary)]">/</span>
            <span className="text-sm font-mono text-[color:var(--text-secondary)]">
              {activeFile}
            </span>
          </>
        )}
        <select
          value={activeLanguage}
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
          title={runnable ? 'Run (Ctrl+Enter)' : `${activeLanguage} is not runnable`}
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
          onClick={() => setExpectedOpen((v) => !v)}
          title="Expected output — compared to stdout on run"
          className="btn-secondary"
        >
          {expectedOpen ? 'Hide expected' : `Expected${expected ? ' •' : ''}`}
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
          className="btn-secondary relative"
        >
          {chatOpen ? 'Hide chat' : 'Chat'}
          {!chatOpen && unreadChat > 0 && (
            <span
              className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 px-1 items-center justify-center rounded-full text-[10px] font-bold text-white"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              {unreadChat > 9 ? '9+' : unreadChat}
            </span>
          )}
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
        <aside
          style={{
            width: 200,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
          }}
        >
          <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-[color:var(--text-secondary)] font-semibold">
              Files
            </span>
            <button onClick={createFile} title="New file" className="btn-secondary !px-1.5 !py-0.5 !text-xs">
              +
            </button>
          </div>
          <ul className="flex-1 overflow-auto py-1">
            {files.length === 0 ? (
              <li className="px-3 py-1.5 text-xs text-[color:var(--text-tertiary)]">
                No files yet
              </li>
            ) : (
              files.map((name) => (
                <li
                  key={name}
                  className={`group px-3 py-1.5 flex items-center gap-2 cursor-pointer text-xs font-mono ${
                    name === activeFile
                      ? 'bg-white/[0.05] text-[color:var(--text-primary)]'
                      : 'text-[color:var(--text-secondary)] hover:bg-white/[0.03]'
                  }`}
                  onClick={() => setActiveFile(name)}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                    style={{
                      background:
                        langFromFilename(name) === 'javascript'
                          ? '#f7df1e'
                          : langFromFilename(name) === 'typescript'
                            ? '#3178c6'
                            : langFromFilename(name) === 'python'
                              ? '#3572a5'
                              : '#9aa0a6',
                    }}
                  />
                  <span className="truncate flex-1">{name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteFile(name);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-[color:var(--text-tertiary)] hover:text-red-400"
                    title="Delete file"
                  >
                    ×
                  </button>
                </li>
              ))
            )}
          </ul>
        </aside>
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <Editor
              key={roomId}
              height="100%"
              width="100%"
              defaultLanguage="javascript"
              theme="vs-dark"
              onMount={(editor, monaco) => {
                setEd(editor);
                setMonacoNs(monaco);
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
                  handleRunRef.current();
                });
                editor.addCommand(
                  monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP,
                  () => setPaletteOpen(true),
                );
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
      {expectedOpen && (
        <div
          style={{ flexShrink: 0, background: 'var(--bg-surface)' }}
          className="border-t border-white/[0.06] px-4 py-2"
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] uppercase tracking-wider text-[color:var(--text-secondary)] font-semibold">
              expected output
            </span>
            <span className="text-[10px] text-[color:var(--text-tertiary)]">
              compared to stdout after Run (PASS/FAIL lines are excluded)
            </span>
            {expectedMatch === true && (
              <span className="text-[10px] text-green-400 ml-auto">✓ matches</span>
            )}
            {expectedMatch === false && (
              <span className="text-[10px] text-red-400 ml-auto">✗ differs</span>
            )}
          </div>
          <textarea
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
            placeholder={'e.g.\nHello, world!\n42\n'}
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
          {testSummary && (
            <div className="px-4 py-2 border-b border-white/[0.06]">
              <div className="flex items-center gap-2 mb-1.5 text-xs">
                <span className="text-[color:var(--text-secondary)] uppercase tracking-wider text-[10px] font-semibold">
                  tests
                </span>
                <span className="text-[color:var(--text-primary)]">
                  {testSummary.passed}/{testSummary.total} pass
                </span>
                {testSummary.failed > 0 && (
                  <span className="text-red-400">· {testSummary.failed} failed</span>
                )}
              </div>
              <ul className="space-y-0.5">
                {testResults.map((t, i) => (
                  <li key={i} className="flex items-baseline gap-2 text-xs">
                    {t.pass ? (
                      <span className="text-green-400 font-mono">✓</span>
                    ) : (
                      <span className="text-red-400 font-mono">✗</span>
                    )}
                    <span className={t.pass ? 'text-[color:var(--text-primary)]' : 'text-red-300'}>
                      {t.name}
                    </span>
                    {t.detail && !t.pass && (
                      <span className="text-[color:var(--text-tertiary)] font-mono">
                        — {t.detail}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {expectedMatch === false && runOutput.status === 'done' && (
            <div className="px-4 py-2 border-b border-white/[0.06] flex items-center gap-2 text-xs">
              <span className="text-red-400">✗</span>
              <span className="text-[color:var(--text-secondary)]">
                stdout doesn&apos;t match expected output
              </span>
            </div>
          )}
          {expectedMatch === true && runOutput.status === 'done' && (
            <div className="px-4 py-2 border-b border-white/[0.06] flex items-center gap-2 text-xs">
              <span className="text-green-400">✓</span>
              <span className="text-[color:var(--text-secondary)]">
                stdout matches expected output
              </span>
            </div>
          )}
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
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
        placeholder="Type a command, or a language…"
      />
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
