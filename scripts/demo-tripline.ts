import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { GraphError } from '../src/server/context/errors';
import { createGraphStore } from '../src/server/context/store';
import { migrate } from '../src/server/db/migrate';
import { createPool } from '../src/server/db/pool';
import { importPreparedProject } from '../src/server/ingestion/import';
import { parseManifestBytes } from '../src/server/ingestion/manifest';
import { mergeClaimsOverlay, parseClaimsOverlay } from '../src/server/ingestion/overlay';
import { scanRepository } from '../src/server/ingestion/scan';

// Usage: npm run demo:tripline -- <tripline-checkout> [--out merged.json] [--claims fixtures/tripline-claims.json] [--name Tripline]
// Scans the checkout (canonical structure), layers the curated claims fixture on top, and imports
// the result as a new project. With --out, writes the merged manifest instead of importing.
const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const consumed = new Set<number>();
for (let i = 0; i < args.length; i += 1)
  if (['--out', '--claims', '--name'].includes(args[i]!)) consumed.add(i).add(i + 1);
const checkout = args.find((_, i) => !consumed.has(i));
if (!checkout) {
  console.error(
    'Usage: npm run demo:tripline -- <tripline-checkout> [--out merged.json] [--claims fixtures/tripline-claims.json] [--name Tripline]',
  );
  process.exit(2);
}

try {
  const { manifest: scanned, stats } = await scanRepository(checkout, {
    name: flag('--name') ?? 'Tripline',
  });
  const overlay = parseClaimsOverlay(
    await readFile(flag('--claims') ?? 'fixtures/tripline-claims.json', 'utf8'),
  );
  const merged = mergeClaimsOverlay(scanned, overlay);
  const bytes = Buffer.from(`${JSON.stringify(merged, null, 2)}\n`);
  parseManifestBytes(bytes);
  const summary = `${stats.components} components, ${stats.files} files, ${merged.claims.length} claims, ${merged.edges.length} explicit edges (${stats.skipped} files skipped${stats.commit ? `, commit ${stats.commit.slice(0, 10)}` : ''})`;
  const out = flag('--out');
  if (out) {
    await writeFile(out, bytes);
    console.log(`Wrote ${out}: ${summary}. Import with \`hof init ${out}\`.`);
  } else {
    const pool = createPool();
    await migrate(pool);
    const store = createGraphStore(pool);
    try {
      const imported = await importPreparedProject(bytes, store);
      console.log(
        `Imported "${merged.project.name}" (${imported.projectId}): ${summary}; ${imported.nodes} nodes and ${imported.edges} edges in total. Bind with \`hof use ${merged.project.name}\`.`,
      );
    } finally {
      await store.close();
    }
  }
} catch (error) {
  if (error instanceof GraphError) {
    const detail =
      error.code === 'CONFLICT'
        ? 'The Tripline project is already imported into this database; point DATABASE_URL at a fresh database (or schema) rather than deleting data.'
        : JSON.stringify(error.details ?? {}, null, 2);
    console.error(`${error.code}: ${error.message}\n${detail}`);
    process.exitCode = error.code === 'CONFLICT' ? 1 : 2;
  } else throw error;
}
