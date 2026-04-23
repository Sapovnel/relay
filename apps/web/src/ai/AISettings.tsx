import { useState } from 'react';
import {
  AVAILABLE_MODELS,
  DEFAULT_CHAT_MODEL,
  DEFAULT_COMPLETION_MODEL,
  getApiKey,
  getChatModel,
  getCompletionModel,
  setApiKey,
  setChatModel,
  setCompletionModel,
} from './client';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function AISettings({ open, onClose, onSaved }: Props) {
  const [key, setKey] = useState(() => getApiKey() ?? '');
  const [chatModel, setChatModelLocal] = useState(() => getChatModel());
  const [completionModel, setCompletionModelLocal] = useState(() => getCompletionModel());
  const [ghostEnabled, setGhostEnabled] = useState(
    () => localStorage.getItem('relay-ghost-enabled') !== 'false',
  );

  if (!open) return null;

  const save = () => {
    setApiKey(key || null);
    setChatModel(chatModel);
    setCompletionModel(completionModel);
    localStorage.setItem('relay-ghost-enabled', ghostEnabled ? 'true' : 'false');
    onSaved?.();
    onClose();
  };

  const reset = () => {
    setKey('');
    setChatModelLocal(DEFAULT_CHAT_MODEL);
    setCompletionModelLocal(DEFAULT_COMPLETION_MODEL);
    setGhostEnabled(true);
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
          maxWidth: 520,
          margin: '12vh auto 0',
          overflow: 'hidden',
          boxShadow: '0 24px 80px -20px rgba(0,0,0,0.6)',
        }}
      >
        <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
          <span className="text-sm font-semibold">AI settings</span>
          <button
            onClick={onClose}
            className="text-[color:var(--text-tertiary)] hover:text-white"
          >
            ×
          </button>
        </div>
        <div className="p-4 space-y-4 text-sm">
          <div>
            <label className="block mb-1 text-xs font-semibold uppercase tracking-wider text-[color:var(--text-secondary)]">
              Anthropic API key
            </label>
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-ant-api03-…"
              className="input-field w-full font-mono !text-xs"
            />
            <p className="mt-1.5 text-[11px] text-[color:var(--text-tertiary)]">
              Stored in your browser&apos;s localStorage only — never sent to Relay&apos;s
              server. Get one at console.anthropic.com.
            </p>
          </div>

          <div>
            <label className="block mb-1 text-xs font-semibold uppercase tracking-wider text-[color:var(--text-secondary)]">
              Chat model
            </label>
            <select
              value={chatModel}
              onChange={(e) => setChatModelLocal(e.target.value)}
              className="input-field w-full !text-xs"
            >
              {AVAILABLE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block mb-1 text-xs font-semibold uppercase tracking-wider text-[color:var(--text-secondary)]">
              Autocomplete model
            </label>
            <select
              value={completionModel}
              onChange={(e) => setCompletionModelLocal(e.target.value)}
              className="input-field w-full !text-xs"
            >
              {AVAILABLE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] text-[color:var(--text-tertiary)]">
              Haiku is recommended for ghost-text — every keystroke fires a request,
              so latency matters more than peak quality here.
            </p>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={ghostEnabled}
              onChange={(e) => setGhostEnabled(e.target.checked)}
            />
            <span className="text-xs">Enable ghost-text autocomplete</span>
          </label>
        </div>
        <div className="px-4 py-3 border-t border-white/[0.06] flex items-center gap-2">
          <button onClick={reset} className="btn-secondary !text-xs">
            reset
          </button>
          <div className="ml-auto flex gap-2">
            <button onClick={onClose} className="btn-secondary !text-xs">
              cancel
            </button>
            <button onClick={save} className="btn-primary !py-1.5 !px-3 !text-xs">
              save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
