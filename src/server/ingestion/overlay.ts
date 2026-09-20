import { graphError } from '../context/errors';
import { manifestSchema, type PreparedProjectManifest } from './manifest';
import * as duplicateAwareJson from 'json-dup-key-validator';

/**
 * A claims overlay is a partial manifest — sources, claims, and explicit edges only — that is
 * layered onto a structural scan so a curated knowledge layer can reference the scanner's
 * deterministic component/file keys. It carries no components or files of its own.
 */
export const claimsOverlaySchema = manifestSchema.pick({
  schemaVersion: true,
  sources: true,
  claims: true,
  edges: true,
});
export type ClaimsOverlay = ReturnType<typeof claimsOverlaySchema.parse>;

export function parseClaimsOverlay(raw: string): ClaimsOverlay {
  let parsed: unknown;
  try {
    parsed = duplicateAwareJson.parse(raw, false);
  } catch {
    throw graphError(
      'VALIDATION_ERROR',
      'Claims overlay must be valid JSON without duplicate object keys',
      { path: '$' },
    );
  }
  const result = claimsOverlaySchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw graphError('VALIDATION_ERROR', 'Claims overlay validation failed', {
      path: issue ? `$.${issue.path.join('.')}` : '$',
      reason: issue?.message ?? 'invalid overlay',
    });
  }
  return result.data;
}

/**
 * Append the overlay to a manifest. Fails before import with every unresolved or colliding key
 * listed, so a renamed file in the scanned repository is reported in one pass rather than one
 * dangling reference at a time.
 */
export function mergeClaimsOverlay(
  base: PreparedProjectManifest,
  overlay: ClaimsOverlay,
): PreparedProjectManifest {
  const nodeKeys = new Set([
    ...base.components.map((n) => n.key),
    ...base.files.map((n) => n.key),
    ...base.claims.map((n) => n.key),
  ]);
  const sourceKeys = new Set(base.sources.map((s) => s.key));
  const duplicates: string[] = [];
  for (const source of overlay.sources) {
    if (sourceKeys.has(source.key)) duplicates.push(source.key);
    sourceKeys.add(source.key);
  }
  for (const claim of overlay.claims) {
    if (nodeKeys.has(claim.key)) duplicates.push(claim.key);
    nodeKeys.add(claim.key);
  }
  if (duplicates.length > 0)
    throw graphError('VALIDATION_ERROR', 'Claims overlay repeats keys already in the manifest', {
      duplicates,
    });

  const missing = new Set<string>();
  for (const claim of overlay.claims)
    if (!sourceKeys.has(claim.sourceKey)) missing.add(claim.sourceKey);
  for (const edge of overlay.edges) {
    if (!nodeKeys.has(edge.fromKey)) missing.add(edge.fromKey);
    if (!nodeKeys.has(edge.toKey)) missing.add(edge.toKey);
    if (!sourceKeys.has(edge.sourceKey)) missing.add(edge.sourceKey);
  }
  if (missing.size > 0)
    throw graphError(
      'VALIDATION_ERROR',
      'Claims overlay references keys the scan did not produce',
      {
        missing: [...missing].sort(),
        hint: 'Compare against the scanned manifest (hof scan <path> --out scan.json); file keys are file.<slug-of-path>.',
      },
    );

  return {
    ...base,
    sources: [...base.sources, ...overlay.sources],
    claims: [...base.claims, ...overlay.claims],
    edges: [...base.edges, ...overlay.edges],
  };
}
