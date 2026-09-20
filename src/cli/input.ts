import { readFile } from 'node:fs/promises';

/**
 * Content flags accept literal text, `@path` to read a file, or `-` for stdin, so long node
 * content never has to be shell-quoted. A literal that happens to start with `@` can be
 * written as `@@`.
 */
export async function readContentArg(
  value: string,
  readStdin: () => Promise<string>,
): Promise<string> {
  if (value === '-') return readStdin();
  if (value.startsWith('@@')) return value.slice(1);
  if (value.startsWith('@') && value.length > 1) return readFile(value.slice(1), 'utf8');
  return value;
}

/** Parses an optional numeric flag; returns undefined when absent, throws on garbage. */
export function optionalNumber(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a number`);
  return value;
}
