import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { optionalNumber, readContentArg } from '../../src/cli/input';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hof-input-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const stdin = async () => 'from stdin\n';

describe('readContentArg', () => {
  it('returns literal text unchanged', async () => {
    expect(await readContentArg('plain text', stdin)).toBe('plain text');
  });
  it('reads a file for @path and stdin for -', async () => {
    const file = join(dir, 'notes.md');
    writeFileSync(file, '# notes\n');
    expect(await readContentArg(`@${file}`, stdin)).toBe('# notes\n');
    expect(await readContentArg('-', stdin)).toBe('from stdin\n');
  });
  it('lets @@ escape a literal leading @', async () => {
    expect(await readContentArg('@@handle', stdin)).toBe('@handle');
    expect(await readContentArg('@', stdin)).toBe('@');
  });
});

describe('optionalNumber', () => {
  it('passes through absence and parses numbers', () => {
    expect(optionalNumber(undefined, 'x')).toBeUndefined();
    expect(optionalNumber('0.5', 'x')).toBe(0.5);
    expect(() => optionalNumber('abc', 'importance')).toThrow('--importance must be a number');
  });
});
