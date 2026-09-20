import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { GraphError } from '../src/server/context/errors';
import { createGraphStore } from '../src/server/context/store';
import { migrate } from '../src/server/db/migrate';
import { createPool } from '../src/server/db/pool';
import { importPreparedProject } from '../src/server/ingestion/import';
import { scanRepository } from '../src/server/ingestion/scan';

// Usage: npm run scan:repo -- <path> [--out file.json] [--import] [--name "Project"] [--depth 2] [--max-files 600] [--include src ...]
const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const includes: string[] = [];
for (let i = 0; i < args.length; i += 1)
  if (args[i] === '--include' && args[i + 1]) includes.push(args[i + 1]!);
const consumed = new Set<number>();
for (let i = 0; i < args.length; i += 1) {
  if (['--out', '--name', '--depth', '--max-files', '--include'].includes(args[i]!)) {
    consumed.add(i);
    consumed.add(i + 1);
  } else if (args[i] === '--import') consumed.add(i);
}
const path = args.find((_, i) => !consumed.has(i));
if (!path) {
  console.error(
    'Usage: npm run scan:repo -- <path> [--out file.json] [--import] [--name "Project"] [--depth 2] [--max-files 600] [--include prefix ...]',
  );
  process.exit(2);
}
const depth = flag('--depth');
const maxFiles = flag('--max-files');
try {
  const { manifest, stats } = await scanRepository(path, {
    name: flag('--name'),
    depth: depth === undefined ? undefined : Number(depth),
    maxFiles: maxFiles === undefined ? undefined : Number(maxFiles),
    include: includes,
  });
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  const out = flag('--out');
  if (out) await writeFile(out, bytes);
  console.error(
    JSON.stringify({
      ...stats,
      projectId: manifest.project.id,
      name: manifest.project.name,
      out: out ?? null,
    }),
  );
  if (args.includes('--import')) {
    const pool = createPool();
    await migrate(pool);
    const store = createGraphStore(pool);
    try {
      console.log(JSON.stringify(await importPreparedProject(bytes, store)));
    } finally {
      await store.close();
    }
  } else if (!out) {
    process.stdout.write(bytes);
  }
} catch (error) {
  if (error instanceof GraphError) {
    console.error(`${error.code}: ${error.message} ${JSON.stringify(error.details ?? {})}`);
    process.exitCode = error.code === 'CONFLICT' ? 1 : 2;
  } else throw error;
}
