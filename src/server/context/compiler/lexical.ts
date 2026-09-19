export const LEXICAL_MIN_SEED_SIMILARITY = 0.08;

export function lexicalTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 3),
  );
}

/** Jaccard overlap of word tokens; the degraded stand-in for semantic similarity. */
export function lexicalSimilarity(task: string, text: string): number {
  const a = lexicalTokens(task);
  const b = lexicalTokens(text);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}
