import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

export default function Join() {
  const { id } = useParams();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`/rooms/${id}/join`, { method: 'POST', credentials: 'include' })
      .then((r) => {
        if (r.ok) {
          nav(`/room/${id}`, { replace: true });
        } else if (r.status === 404) {
          setError('Room not found.');
        } else {
          setError(`Could not join (${r.status}).`);
        }
      })
      .catch(() => setError('Network error.'));
  }, [id, nav]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-8">
      <h1 className="text-3xl font-bold mb-4 wordmark wordmark-accent">Relay</h1>
      {error ? (
        <div>
          <p className="text-red-400 mb-4">{error}</p>
          <a href="/" className="text-sm underline text-gray-300">
            back home
          </a>
        </div>
      ) : (
        <p className="text-gray-400">Joining room…</p>
      )}
    </div>
  );
}
