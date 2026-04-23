import type * as Monaco from 'monaco-editor';
import { getClient, getCompletionModel, hasApiKey } from './client';
import { COMPLETION_SYSTEM, completionUserMessage } from './prompts';

/**
 * Register a Monaco inline-completions provider that calls Claude for a
 * single continuation at the cursor. Per-keystroke fires are debounced by
 * Monaco itself; we additionally cap the context window we send and bail
 * out early if the user hasn't set an API key.
 *
 * Returns a disposer that removes the provider + aborts any in-flight call.
 */
const PREFIX_CHARS = 3000;
const SUFFIX_CHARS = 1000;
const MIN_TRIGGER_CHARS = 3;

interface RegisterOptions {
  getFileName: () => string | null;
  isEnabled: () => boolean;
}

export function registerGhostCompletions(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
  opts: RegisterOptions,
): { dispose: () => void } {
  let currentAbort: AbortController | null = null;

  const provider: Monaco.languages.InlineCompletionsProvider = {
    async provideInlineCompletions(model, position) {
      if (!opts.isEnabled()) return { items: [] };
      if (!hasApiKey()) return { items: [] };
      const fileName = opts.getFileName();
      if (!fileName) return { items: [] };

      const fullText = model.getValue();
      const offset = model.getOffsetAt(position);
      const prefix = fullText.slice(Math.max(0, offset - PREFIX_CHARS), offset);
      const suffix = fullText.slice(offset, offset + SUFFIX_CHARS);

      // Skip very small prefixes; nothing useful to predict from a blank file.
      if (prefix.trimEnd().length < MIN_TRIGGER_CHARS) return { items: [] };

      const client = getClient();
      if (!client) return { items: [] };

      // Cancel any in-flight request from the previous keystroke.
      currentAbort?.abort();
      const controller = new AbortController();
      currentAbort = controller;

      try {
        const res = await client.messages.create(
          {
            model: getCompletionModel(),
            max_tokens: 256,
            // Keep thinking disabled — ghost text needs sub-second response.
            // This is a deliberate latency call, not a quality call.
            thinking: { type: 'disabled' },
            system: COMPLETION_SYSTEM,
            messages: [
              {
                role: 'user',
                content: completionUserMessage(
                  fileName,
                  model.getLanguageId(),
                  prefix,
                  suffix,
                ),
              },
            ],
          },
          { signal: controller.signal },
        );

        const textBlock = res.content.find((b) => b.type === 'text');
        let completion =
          textBlock && textBlock.type === 'text' ? textBlock.text : '';

        // Strip accidental code fences. Sometimes the model wraps anyway.
        completion = completion.replace(/^```[a-zA-Z0-9_-]*\n/, '').replace(/\n```\s*$/, '');
        // Also strip leading whitespace the model duplicated from prefix.
        if (prefix.endsWith('\n') && completion.startsWith('\n')) {
          completion = completion.replace(/^\n+/, '');
        }

        if (!completion) return { items: [] };
        return {
          items: [
            {
              insertText: completion,
              range: new monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column,
              ),
            },
          ],
        };
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return { items: [] };
        // Swallow other errors — ghost text failures shouldn't spam the UI.
        return { items: [] };
      }
    },
    disposeInlineCompletions() {
      // No resources held per-completion; aborts are tracked at the provider level.
    },
  };

  // Register for all known Monaco languages. Using `**` pattern via model
  // languages means every open file is covered without re-registering.
  const languages = monaco.languages.getLanguages().map((l) => l.id);
  const disposers: Monaco.IDisposable[] = languages.map((id) =>
    monaco.languages.registerInlineCompletionsProvider(id, provider),
  );

  return {
    dispose() {
      currentAbort?.abort();
      disposers.forEach((d) => d.dispose());
    },
  };
}

export function isGhostEnabled(): boolean {
  try {
    return localStorage.getItem('relay-ghost-enabled') !== 'false';
  } catch {
    return true;
  }
}
