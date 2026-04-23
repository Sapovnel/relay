import Anthropic from '@anthropic-ai/sdk';

/**
 * The user's Anthropic API key lives in their own browser's localStorage and
 * NEVER goes through Relay's server. We initialize the SDK with
 * `dangerouslyAllowBrowser: true` because the "danger" that flag guards
 * against is leaking a backend secret to untrusted clients — here the user
 * is the one bringing their own key for their own use, so same-origin
 * storage + direct browser call is appropriate.
 */
const API_KEY_STORAGE = 'relay-anthropic-api-key';
const CHAT_MODEL_STORAGE = 'relay-anthropic-chat-model';
const COMPLETION_MODEL_STORAGE = 'relay-anthropic-completion-model';

export const DEFAULT_CHAT_MODEL = 'claude-opus-4-7';
export const DEFAULT_COMPLETION_MODEL = 'claude-haiku-4-5';

export const AVAILABLE_MODELS = [
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7 (best quality)' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (balanced)' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (fastest)' },
];

export function getApiKey(): string | null {
  try {
    return localStorage.getItem(API_KEY_STORAGE);
  } catch {
    return null;
  }
}

export function setApiKey(key: string | null): void {
  try {
    if (key && key.trim()) {
      localStorage.setItem(API_KEY_STORAGE, key.trim());
    } else {
      localStorage.removeItem(API_KEY_STORAGE);
    }
  } catch {
    // localStorage disabled; ignore
  }
}

export function getChatModel(): string {
  try {
    return localStorage.getItem(CHAT_MODEL_STORAGE) || DEFAULT_CHAT_MODEL;
  } catch {
    return DEFAULT_CHAT_MODEL;
  }
}

export function setChatModel(model: string): void {
  try {
    localStorage.setItem(CHAT_MODEL_STORAGE, model);
  } catch {
    // ignore
  }
}

export function getCompletionModel(): string {
  try {
    return localStorage.getItem(COMPLETION_MODEL_STORAGE) || DEFAULT_COMPLETION_MODEL;
  } catch {
    return DEFAULT_COMPLETION_MODEL;
  }
}

export function setCompletionModel(model: string): void {
  try {
    localStorage.setItem(COMPLETION_MODEL_STORAGE, model);
  } catch {
    // ignore
  }
}

let cachedClient: Anthropic | null = null;
let cachedKey: string | null = null;

export function getClient(): Anthropic | null {
  const key = getApiKey();
  if (!key) {
    cachedClient = null;
    cachedKey = null;
    return null;
  }
  if (cachedClient && cachedKey === key) return cachedClient;
  cachedClient = new Anthropic({
    apiKey: key,
    dangerouslyAllowBrowser: true,
  });
  cachedKey = key;
  return cachedClient;
}

export function hasApiKey(): boolean {
  return Boolean(getApiKey());
}
