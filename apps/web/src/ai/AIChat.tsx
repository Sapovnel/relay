import { useEffect, useRef, useState } from 'react';
import { getClient, getChatModel, hasApiKey } from './client';
import { CHAT_SYSTEM } from './prompts';

export interface AIChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  /** Message the host wants to seed into the chat (from an inline action). */
  pendingMessage: string | null;
  onPendingConsumed: () => void;
  onNeedApiKey: () => void;
}

export function AIChat({ pendingMessage, onPendingConsumed, onNeedApiKey }: Props) {
  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const send = async (text: string) => {
    if (!text.trim() || streaming) return;
    if (!hasApiKey()) {
      onNeedApiKey();
      return;
    }
    const client = getClient();
    if (!client) {
      onNeedApiKey();
      return;
    }
    setError(null);
    const userMsg: AIChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
    };
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: 'assistant', content: '' },
    ]);
    setStreaming(true);

    const priorTurns = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Streaming with adaptive thinking (per the SDK's default recommendation
      // for anything remotely complicated). We consume raw delta events so we
      // can render the reply as it arrives.
      const stream = client.messages.stream(
        {
          model: getChatModel(),
          max_tokens: 16000,
          thinking: { type: 'adaptive' },
          system: CHAT_SYSTEM,
          messages: priorTurns,
        },
        { signal: controller.signal },
      );

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          const delta = event.delta.text;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + delta } : m,
            ),
          );
        }
      }
      await stream.finalMessage();
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') {
        // user cancelled — leave the partial reply
      } else {
        const msg = e instanceof Error ? e.message : 'AI request failed';
        setError(msg);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  useEffect(() => {
    if (pendingMessage) {
      onPendingConsumed();
      void send(pendingMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMessage]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input;
    setInput('');
    void send(text);
  };

  const stop = () => abortRef.current?.abort();
  const clear = () => setMessages([]);

  return (
    <>
      <div ref={bodyRef} style={{ flex: 1, overflow: 'auto' }} className="p-3 space-y-3">
        {messages.length === 0 ? (
          <p className="text-xs text-[color:var(--text-tertiary)]">
            Ask Claude about the code in this room. Selections can be sent via the
            command palette or right-click menu.
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id}>
              <div
                className="text-[10px] font-semibold uppercase tracking-wider mb-0.5"
                style={{ color: m.role === 'user' ? 'var(--accent)' : '#c4b5fd' }}
              >
                {m.role === 'user' ? 'You' : 'Claude'}
              </div>
              <pre className="text-sm wrap-break-word whitespace-pre-wrap font-sans text-[color:var(--text-primary)]">
                {m.content || (m.role === 'assistant' && streaming ? '…' : '')}
              </pre>
            </div>
          ))
        )}
        {error && (
          <div className="text-xs text-red-400 font-mono">
            {error}
          </div>
        )}
      </div>
      <form
        onSubmit={submit}
        className="p-2 flex gap-1.5 border-t border-white/[0.06]"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={hasApiKey() ? 'Ask Claude…' : 'Set an API key to chat'}
          disabled={streaming}
          className="input-field flex-1 !py-1.5 !text-xs"
        />
        {streaming ? (
          <button
            type="button"
            onClick={stop}
            className="btn-secondary !text-xs"
          >
            stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="btn-primary !py-1.5 !px-3 !text-xs"
          >
            ask
          </button>
        )}
      </form>
      {messages.length > 0 && (
        <button
          onClick={clear}
          className="mx-2 mb-2 text-[10px] text-[color:var(--text-tertiary)] hover:text-white text-left"
        >
          clear chat
        </button>
      )}
    </>
  );
}
