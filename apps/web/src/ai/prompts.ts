/**
 * Prompts for inline AI actions. Each prompt produces a focused request.
 * They're kept short and deterministic so the token cost per action is low.
 */

export interface CodeContext {
  language: string;
  fileName: string;
  fullFile: string;
  selection?: string;
  /** Character-offset range for the selection inside fullFile. */
  selectionRange?: { start: number; end: number };
}

function languageLabel(lang: string): string {
  switch (lang) {
    case 'javascript':
      return 'JavaScript';
    case 'typescript':
      return 'TypeScript';
    case 'python':
      return 'Python';
    case 'markdown':
      return 'Markdown';
    case 'plaintext':
      return 'plain text';
    default:
      return lang;
  }
}

function codeBlock(lang: string, source: string): string {
  return '```' + lang + '\n' + source + '\n```';
}

export function explainPrompt(ctx: CodeContext): string {
  const code = ctx.selection ?? ctx.fullFile;
  const scope = ctx.selection ? 'this selection' : `the file \`${ctx.fileName}\``;
  return [
    `Explain ${scope} (${languageLabel(ctx.language)}) line by line. Keep the explanation short and practical — what it does and why, not a language tutorial.`,
    '',
    codeBlock(ctx.language, code),
  ].join('\n');
}

export function fixPrompt(ctx: CodeContext): string {
  const code = ctx.selection ?? ctx.fullFile;
  const scope = ctx.selection ? 'the selection below' : `the file \`${ctx.fileName}\``;
  return [
    `Review ${scope} (${languageLabel(ctx.language)}) for bugs, edge cases, and correctness issues. List each issue and give the minimal fix. If the code is already correct, say so in one sentence.`,
    '',
    codeBlock(ctx.language, code),
  ].join('\n');
}

export function refactorPrompt(ctx: CodeContext): string {
  const code = ctx.selection ?? ctx.fullFile;
  const scope = ctx.selection ? 'the selection' : 'the file';
  return [
    `Refactor ${scope} below (${languageLabel(ctx.language)}) for clarity and idiomatic style. Preserve behavior exactly. Return the refactored code in a single code block, followed by a one-line summary of what changed.`,
    '',
    codeBlock(ctx.language, code),
  ].join('\n');
}

export function addTypesPrompt(ctx: CodeContext): string {
  const code = ctx.selection ?? ctx.fullFile;
  return [
    `Add precise type annotations to the ${languageLabel(ctx.language)} code below. If the language already has types (TypeScript, Python), tighten them (no \`any\` / \`object\`); if it's untyped (JavaScript), add JSDoc types. Return the fully-typed code in one code block.`,
    '',
    codeBlock(ctx.language, code),
  ].join('\n');
}

export function askPrompt(ctx: CodeContext, question: string): string {
  const label = ctx.selection ? 'Selected code' : `File \`${ctx.fileName}\``;
  return [
    question.trim(),
    '',
    `${label} (${languageLabel(ctx.language)}):`,
    codeBlock(ctx.language, ctx.selection ?? ctx.fullFile),
  ].join('\n');
}

export const CHAT_SYSTEM = [
  'You are Claude acting as a pair programmer inside Relay, a collaborative code editor.',
  "Be concise and direct. When you return code, put it in fenced code blocks with the correct language tag.",
  'If the user shows you code, point out the most important thing first.',
].join('\n');

/**
 * System prompt for ghost-text autocomplete. Has to be tiny and tightly
 * constrained so the model emits only the continuation, never chat-style prose.
 */
export const COMPLETION_SYSTEM = [
  'You autocomplete code. Return only the text that should appear AFTER the cursor — no explanations, no markdown, no code fences, no repetition of the code before the cursor.',
  'Stop after the logical completion (end of line, end of statement, end of block). Prefer short completions — 1–3 lines.',
  'If the cursor is inside a comment or string, complete the comment or string naturally.',
].join('\n');

export function completionUserMessage(
  fileName: string,
  language: string,
  prefix: string,
  suffix: string,
): string {
  return [
    `File: ${fileName}`,
    `Language: ${language}`,
    '',
    'Code before cursor:',
    '```',
    prefix,
    '```',
    '',
    'Code after cursor:',
    '```',
    suffix,
    '```',
    '',
    'Return ONLY the completion text that goes between these two snippets. No fences, no commentary.',
  ].join('\n');
}
