import { useParams } from 'react-router-dom';
import Editor from '@monaco-editor/react';

const seed = (id: string) => `// Welcome to room: ${id}
// Real-time collab wiring arrives in Phase 2 (Yjs).

function greet(name) {
  return 'Hello, ' + name + '!';
}

console.log(greet('world'));
`;

export default function Room() {
  const { id } = useParams();
  const roomId = id ?? 'unknown';
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
      </header>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <Editor
            key={roomId}
            height="100%"
            width="100%"
            defaultLanguage="javascript"
            defaultValue={seed(roomId)}
            theme="vs-dark"
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
