import type { NodeRevision } from '@/server/context/types';

export type FieldComparison = { field: string; before: unknown; after: unknown; changed: boolean };

export const COMPARED_FIELDS = [
  'title',
  'content',
  'summary',
  'authority',
  'importance',
  'confidence',
  'archived',
  'sourceId',
  'actor',
  'changeReason',
  'createdAt',
  'version',
] as const satisfies ReadonlyArray<keyof NodeRevision>;

const same = (a: unknown, b: unknown): boolean =>
  typeof a === 'object' && a !== null && typeof b === 'object' && b !== null
    ? JSON.stringify(a) === JSON.stringify(b)
    : a === b;

/** Pure field-by-field comparison of two revisions of the same node; never writes. */
export function compareRevisions(a: NodeRevision, b: NodeRevision): FieldComparison[] {
  return COMPARED_FIELDS.map((field) => {
    const before = a[field];
    const after = b[field];
    return { field, before, after, changed: !same(before, after) };
  });
}
