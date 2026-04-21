import { useEffect } from 'react';

interface Shortcut {
  keys: string;
  description: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: 'Ctrl+Enter', description: 'Run the current file' },
  { keys: 'Ctrl+Shift+P', description: 'Open the command palette' },
  { keys: '?', description: 'Show this help dialog' },
  { keys: 'Esc', description: 'Close dialog / exit follow mode' },
  { keys: 'Ctrl+F', description: 'Find in current file (Monaco)' },
  { keys: 'Ctrl+H', description: 'Find & replace (Monaco)' },
  { keys: 'Ctrl+/', description: 'Toggle line comment (Monaco)' },
  { keys: 'Alt+↑ / Alt+↓', description: 'Move line up / down (Monaco)' },
  { keys: 'Ctrl+D', description: 'Select next occurrence (Monaco)' },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsHelp({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
      role="dialog"
      aria-modal
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{
          maxWidth: 440,
          margin: '14vh auto 0',
          overflow: 'hidden',
          boxShadow: '0 24px 80px -20px rgba(0,0,0,0.6)',
        }}
      >
        <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
          <span className="text-sm font-semibold">Keyboard shortcuts</span>
          <button
            onClick={onClose}
            className="text-[color:var(--text-tertiary)] hover:text-white"
            title="Close"
          >
            ×
          </button>
        </div>
        <ul className="divide-y divide-white/[0.04]">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="px-4 py-2.5 flex items-center justify-between text-sm">
              <span className="text-[color:var(--text-secondary)]">{s.description}</span>
              <kbd className="font-mono text-xs px-2 py-1 rounded bg-white/[0.06] text-[color:var(--text-primary)] border border-white/10">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
