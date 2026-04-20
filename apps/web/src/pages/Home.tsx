import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-8">
      <h1 className="text-3xl font-bold mb-2">codeE</h1>
      <p className="text-gray-400 mb-6">Real-time collaborative code editor.</p>
      <Link
        to="/room/abc"
        className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded font-medium"
      >
        Open room &ldquo;abc&rdquo;
      </Link>
    </div>
  );
}
