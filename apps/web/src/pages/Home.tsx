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
      .catch((e) => console.error('fetch rooms failed:', e));
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
    <div className="min-h-screen bg-gray-950 text-gray-100 p-8">
      <header className="flex items-center justify-between mb-8 max-w-3xl">
        <h1 className="text-3xl font-bold">codeE</h1>
        {!loading && user && (
          <div className="flex items-center gap-3">
            {user.avatarUrl && (
              <img src={user.avatarUrl} className="h-8 w-8 rounded-full" alt="" />
            )}
            <span className="text-sm text-gray-300">{user.login}</span>
            <button
              onClick={logout}
              className="text-xs text-gray-400 hover:text-gray-200 underline"
            >
              sign out
            </button>
          </div>
        )}
      </header>

      {loading ? null : !user ? (
        <div className="max-w-3xl">
          <p className="text-gray-400 mb-6">Real-time collaborative code editor.</p>
          <div className="flex flex-col items-start gap-3">
            {cfg.github && (
              <a
                href="/auth/github"
                className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded font-medium"
              >
                Sign in with GitHub
              </a>
            )}
            {cfg.devLogin && (
              <a
                href="/auth/dev-login"
                className="inline-block px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded text-gray-300"
              >
                Dev login (skip GitHub)
              </a>
            )}
          </div>
        </div>
      ) : (
        <div className="max-w-3xl">
          <section className="mb-10">
            <h2 className="text-lg font-semibold mb-3">New room</h2>
            <div className="flex flex-wrap gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                }}
                placeholder="Room name"
                className="px-3 py-2 bg-gray-900 border border-gray-800 rounded text-sm flex-1 min-w-50"
                maxLength={100}
              />
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="px-3 py-2 bg-gray-900 border border-gray-800 rounded text-sm"
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
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed rounded text-sm font-medium"
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
            {error && (
              <p className="text-xs text-red-400 mt-2 font-mono">{error}</p>
            )}
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">Your rooms</h2>
            {rooms.length === 0 ? (
              <p className="text-sm text-gray-500">No rooms yet. Create one above.</p>
            ) : (
              <ul className="divide-y divide-gray-800 border border-gray-800 rounded">
                {rooms.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{r.name}</div>
                      <div className="text-xs text-gray-500 font-mono">
                        {r.language} · {r.memberIds.length}{' '}
                        {r.memberIds.length === 1 ? 'member' : 'members'}
                      </div>
                    </div>
                    <button
                      onClick={() => copyLink(r.id)}
                      className="text-xs px-2 py-1 rounded border border-gray-800 hover:bg-gray-900 text-gray-300"
                    >
                      {copied === r.id ? 'copied!' : 'copy link'}
                    </button>
                    {user && r.ownerId === user.sub && (
                      <button
                        onClick={() => handleDelete(r)}
                        disabled={deleting === r.id}
                        className="text-xs px-2 py-1 rounded border border-red-900 hover:bg-red-950 text-red-400 disabled:opacity-50"
                      >
                        {deleting === r.id ? '…' : 'delete'}
                      </button>
                    )}
                    <Link
                      to={`/room/${r.id}`}
                      className="text-xs px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium"
                    >
                      open
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
