import { getEncoding, type Tiktoken } from 'js-tiktoken';

export const TOKENIZER_ID = 'cl100k_base' as const;

let encoding: Tiktoken | undefined;

/** Counts tokens of the complete text under cl100k_base; counts are specific to that encoding. */
export function countTokens(text: string): number {
  encoding ??= getEncoding(TOKENIZER_ID);
  return encoding.encode(text, 'all').length;
}
