import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { GraphError } from '../src/server/context/errors';
import { createGraphStore } from '../src/server/context/store';
import { migrate } from '../src/server/db/migrate';
import { createPool } from '../src/server/db/pool';
import { importPreparedProject } from '../src/server/ingestion/import';
import { ingestDocumentation } from '../src/server/ingestion/docs';
import { scanRepository } from '../src/server/ingestion/scan';
import { proposalModelFromEnv } from '../src/server/proposals/model';

// Usage: npm run scan:repo -- <path> [--out file.json] [--import] [--docs] [--name "Project"] [--depth 2] [--max-files 600] [--include src ...]
// --docs (with --import) also reads README/AGENTS/CONTRIBUTING/CHANGELOG/docs/**.md into inferred proposals.
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
  } else if (args[i] === '--import' || args[i] === '--docs') consumed.add(i);
}
const path = args.find((_, i) => !consumed.has(i));
if (!path) {
  console.error(
    'Usage: npm run scan:repo -- <path> [--out file.json] [--import] [--docs] [--name "Project"] [--depth 2] [--max-files 600] [--include prefix ...]',
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
      const imported = await importPreparedProject(bytes, store);
      let docs: unknown = null;
      if (args.includes('--docs')) {
        const model = proposalModelFromEnv();
        if (!model) {
          console.error(
            '--docs skipped: no proposal model key (ANTHROPIC/OPENAI/GEMINI_API_KEY) in .env',
          );
        } else {
          const result = await ingestDocumentation({ store, model }, imported.projectId, path);
          docs = {
            commit: result.commit,
            created: result.created,
            documents: result.documents.map((d) => ({
              path: d.path,
              status: d.status,
              ...(d.reason && { reason: d.reason }),
              ...(d.proposal && {
                nodes: d.proposal.created.nodes.length,
                edges: d.proposal.created.edges.length,
              }),
            })),
          };
        }
      }
      console.log(JSON.stringify({ ...imported, docs }, null, 2));
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
