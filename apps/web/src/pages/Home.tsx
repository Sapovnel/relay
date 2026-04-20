import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';

interface AuthConfig {
  github: boolean;
  devLogin: boolean;
}

export default function Home() {
  const { user, loading, logout } = useAuth();
  const [cfg, setCfg] = useState<AuthConfig>({ github: false, devLogin: false });

  useEffect(() => {
    fetch('/auth/config')
      .then((r) => r.json())
      .then(setCfg)
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-8">
      <header className="flex items-center justify-between mb-8">
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

      <p className="text-gray-400 mb-6">Real-time collaborative code editor.</p>

      {loading ? null : user ? (
        <Link
          to="/room/abc"
          className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded font-medium"
        >
          Open room &ldquo;abc&rdquo;
        </Link>
      ) : (
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
      )}
    </div>
  );
}
