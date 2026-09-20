import { describe, expect, it } from 'vitest';
import { blobUrl, selectDocumentationFiles } from '../../src/server/ingestion/docs';

describe('documentation selection', () => {
  it('picks root docs first, then docs trees, and ignores everything else', () => {
    const tracked = [
      'src/app/page.tsx',
      'docs/specs/task-context-compiler.md',
      'README.md',
      'docs/PROJECT_SPEC.md',
      'CHANGELOG.md',
      'AGENTS.md',
      'notes/private.md',
      'README.es.md',
      'package.json',
      'adr/0001-storage.md',
      'CONTRIBUTING.md',
    ];
    expect(selectDocumentationFiles(tracked)).toEqual([
      'AGENTS.md',
      'CHANGELOG.md',
      'CONTRIBUTING.md',
      'README.es.md',
      'README.md',
      'adr/0001-storage.md',
      'docs/PROJECT_SPEC.md',
      'docs/specs/task-context-compiler.md',
    ]);
  });

  it('builds GitHub blob URLs pinned to the commit and escapes path segments', () => {
    expect(blobUrl('https://github.com/o/r', 'abc123', 'docs/a b.md')).toBe(
      'https://github.com/o/r/blob/abc123/docs/a%20b.md',
    );
    expect(blobUrl(null, 'abc123', 'README.md')).toBeNull();
    expect(blobUrl('https://github.com/o/r', null, 'README.md')).toBeNull();
  });
});
