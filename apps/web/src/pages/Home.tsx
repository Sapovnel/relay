import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';

interface Room {
  id: string;
  name: string;
  language: string;
  ownerId: string;
  createdAt: string;
  memberIds: string[];
}

interface AuthConfig {
  github: boolean;
  devLogin: boolean;
}

const LANGUAGES = ['javascript', 'typescript', 'python', 'markdown', 'plaintext'];

function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`wordmark ${className}`}>
      code<span className="wordmark-accent">E</span>
    </span>
  );
}

export default function Home() {
  const { user, loading, logout } = useAuth();
  const [cfg, setCfg] = useState<AuthConfig>({ github: false, devLogin: false });
  const [rooms, setRooms] = useState<Room[]>([]);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('javascript');
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetch('/auth/config')
      .then((r) => r.json())
      .then(setCfg)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    fetch('/rooms', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { rooms: [] }))
      .then((d: { rooms: Room[] }) => setRooms(d.rooms))
      .catch(() => {});
  }, [user]);

  const handleCreate = async () => {
    if (!name.trim() || creating) return;
    setError(null);
    setCreating(true);
    try {
      const res = await fetch('/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, language }),
      });
      if (!res.ok) {
        const body = await res.text();
        setError(`server said ${res.status}: ${body.slice(0, 200)}`);
        return;
      }
      const newRoom: Room = await res.json();
      setRooms((prev) => [newRoom, ...prev]);
      setName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error');
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async (id: string) => {
    const url = `${window.location.origin}/join/${id}`;
    await navigator.clipboard.writeText(url);
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
  };

  const handleRename = async (room: Room) => {
    const next = prompt('Rename room', room.name);
    if (!next || next.trim() === room.name) return;
    const res = await fetch(`/rooms/${room.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name: next.trim() }),
    });
    if (res.ok) {
      const updated: Room = await res.json();
      setRooms((prev) => prev.map((r) => (r.id === room.id ? updated : r)));
    } else {
      setError(`rename failed: ${res.status}`);
    }
  };

  const handleDelete = async (room: Room) => {
    if (!confirm(`Delete room "${room.name}"? This cannot be undone.`)) return;
    setDeleting(room.id);
    try {
      const res = await fetch(`/rooms/${room.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setRooms((prev) => prev.filter((r) => r.id !== room.id));
      } else {
        setError(`delete failed: ${res.status}`);
      }
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="min-h-screen relative">
      <header className="sticky top-0 z-10 glass border-b border-white/[0.06]">
        <div className="max-w-5xl mx-auto px-8 py-4 flex items-center justify-between">
          <Wordmark className="text-xl" />
          {!loading && user && (
            <div className="flex items-center gap-3">
              {user.avatarUrl && (
                <img
                  src={user.avatarUrl}
                  className="h-7 w-7 rounded-full ring-1 ring-white/10"
                  alt=""
                />
              )}
              <span className="text-sm text-[color:var(--text-secondary)]">{user.login}</span>
              <button onClick={logout} className="btn-secondary !px-2 !py-1 !text-xs">
                sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-12">
        {loading ? null : !user ? (
          <div className="min-h-[70vh] flex items-center">
            <div className="max-w-xl">
              <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-5 leading-[1.05]">
                Write code <span className="gradient-text">together</span>.
                <br />
                Run it <span className="gradient-text-2">instantly</span>.
              </h1>
              <p className="text-lg text-[color:var(--text-secondary)] mb-8 leading-relaxed">
                A collaborative editor with a sandboxed executor. Share a link, edit in
                real-time, hit Run — all in the browser.
              </p>
              <div className="flex flex-col items-start gap-3">
                {cfg.github && (
                  <a href="/auth/github" className="btn-primary inline-flex items-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
                    </svg>
                    Sign in with GitHub
                  </a>
                )}
                {cfg.devLogin && (
                  <a
                    href="/auth/dev-login"
                    className="btn-secondary inline-flex items-center gap-1.5"
                  >
                    Dev login <span className="text-[color:var(--text-tertiary)]">(skip GitHub)</span>
                  </a>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div>
            <section className="mb-12">
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="text-2xl font-semibold tracking-tight">New room</h2>
                <span className="text-xs text-[color:var(--text-tertiary)]">
                  Real-time collaborative editor
                </span>
              </div>
              <div className="card p-5">
                <div className="flex flex-wrap gap-3">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreate();
                    }}
                    placeholder="Untitled project…"
                    className="input-field flex-1 min-w-50"
                    maxLength={100}
                  />
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="input-field"
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={!name.trim() || creating}
                    className="btn-primary"
                  >
                    {creating ? 'Creating…' : 'Create room'}
                  </button>
                </div>
                {error && (
                  <p className="text-xs text-red-400 mt-3 font-mono">{error}</p>
                )}
              </div>
            </section>

            <section>
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="text-2xl font-semibold tracking-tight">Your rooms</h2>
                <span className="text-xs text-[color:var(--text-tertiary)]">
                  {rooms.length} {rooms.length === 1 ? 'room' : 'rooms'}
                </span>
              </div>
              {rooms.length === 0 ? (
                <div className="card p-12 text-center">
                  <p className="text-sm text-[color:var(--text-secondary)]">
                    No rooms yet. Create one above to get started.
                  </p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {rooms.map((r) => (
                    <div
                      key={r.id}
                      className="card p-4 flex items-center gap-4 group"
                    >
                      <div
                        className={`lang-chip lang-${r.language} h-10 w-10 rounded-lg flex items-center justify-center font-mono text-[10px] uppercase font-semibold`}
                      >
                        {r.language.slice(0, 2)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{r.name}</div>
                        <div className="text-xs text-[color:var(--text-tertiary)] font-mono mt-0.5">
                          <span className={`lang-${r.language}`} style={{ color: 'var(--lang)' }}>
                            {r.language}
                          </span>
                          <span className="mx-1.5 text-[color:var(--text-tertiary)]">·</span>
                          {r.memberIds.length}{' '}
                          {r.memberIds.length === 1 ? 'member' : 'members'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 opacity-60 group-hover:opacity-100 transition">
                        <button
                          onClick={() => copyLink(r.id)}
                          className="btn-secondary"
                          title="Copy shareable link"
                        >
                          {copied === r.id ? 'copied!' : 'copy link'}
                        </button>
                        {user && r.ownerId === user.sub && (
                          <>
                            <button
                              onClick={() => handleRename(r)}
                              className="btn-secondary"
                              title="Rename room"
                            >
                              rename
                            </button>
                            <button
                              onClick={() => handleDelete(r)}
                              disabled={deleting === r.id}
                              className="btn-danger"
                              title="Delete room"
                            >
                              {deleting === r.id ? '…' : 'delete'}
                            </button>
                          </>
                        )}
                      </div>
                      <Link to={`/room/${r.id}`} className="btn-primary !py-1.5 !px-3 !text-sm">
                        Open →
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
