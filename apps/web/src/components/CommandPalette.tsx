import { useEffect, useMemo, useRef, useState } from 'react';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  run: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  placeholder?: string;
}

export function CommandPalette({ open, onClose, commands, placeholder }: Props) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.filter((c) => !c.disabled);
    return commands
      .filter((c) => !c.disabled)
      .filter(
        (c) =>
          c.label.toLowerCase().includes(q) || c.hint?.toLowerCase().includes(q),
      );
  }, [query, commands]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  const exec = (cmd: Command) => {
    onClose();
    cmd.run();
  };

  const onKey: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[activeIndex];
      if (cmd) exec(cmd);
    }
  };

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
          maxWidth: 560,
          margin: '12vh auto 0',
          overflow: 'hidden',
          boxShadow: '0 24px 80px -20px rgba(0,0,0,0.6)',
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder={placeholder ?? 'Type a command…'}
          className="w-full px-4 py-3.5 bg-transparent text-sm outline-none border-b border-white/10"
        />
        <ul ref={listRef} className="max-h-80 overflow-auto py-1">
          {filtered.length === 0 ? (
            <li className="px-4 py-3 text-sm text-[color:var(--text-tertiary)]">
              No matching commands.
            </li>
          ) : (
            filtered.map((c, i) => (
              <li
                key={c.id}
                onClick={() => exec(c)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`px-4 py-2 flex items-center justify-between cursor-pointer text-sm ${
                  i === activeIndex ? 'bg-white/[0.06] text-white' : 'text-[color:var(--text-primary)]'
                }`}
              >
                <span>{c.label}</span>
                {c.hint && (
                  <span className="text-xs text-[color:var(--text-tertiary)] font-mono">
                    {c.hint}
                  </span>
                )}
              </li>
            ))
          )}
        </ul>
        <div className="px-4 py-2 border-t border-white/[0.06] text-[10px] text-[color:var(--text-tertiary)] flex items-center gap-3 font-mono">
          <span>↑↓ navigate</span>
          <span>⏎ run</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
