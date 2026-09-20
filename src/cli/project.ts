import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { graphError } from '../server/context/errors';
import type { GraphReader, Project } from '../server/context/types';

export const BINDING_DIR = '.hof';
export const BINDING_FILE = 'project';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Nearest `.hof/project` walking up from `startDir`; returns the UUID it contains or null. */
export function findProjectBinding(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    const file = join(dir, BINDING_DIR, BINDING_FILE);
    if (existsSync(file)) {
      const value = readFileSync(file, 'utf8').trim();
      return value || null;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function writeProjectBinding(dir: string, projectId: string): string {
  const folder = join(dir, BINDING_DIR);
  mkdirSync(folder, { recursive: true });
  const file = join(folder, BINDING_FILE);
  writeFileSync(file, `${projectId}\n`);
  return file;
}

/** A project by UUID or by a case-insensitive name substring that matches exactly one project. */
export async function resolveProjectRef(store: GraphReader, ref: string): Promise<Project> {
  const trimmed = ref.trim();
  if (UUID.test(trimmed)) return store.getProject(trimmed);
  const projects = await store.listProjects();
  const needle = trimmed.toLowerCase();
  const matches = projects.filter((project) => project.name.toLowerCase().includes(needle));
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) {
    throw graphError('NOT_FOUND', `No project matches "${trimmed}"`, { ref: trimmed });
  }
  throw graphError('VALIDATION_ERROR', `"${trimmed}" matches ${matches.length} projects`, {
    ref: trimmed,
    candidates: matches.map(({ id, name }) => ({ id, name })),
  });
}

export type Env = Record<string, string | undefined>;

export type ProjectResolution = {
  project?: string | undefined;
  cwd: string;
  env: Env;
};

/** Precedence: `--project`, `HOF_PROJECT`, nearest `.hof/project`. */
export function projectIdFrom(options: ProjectResolution): string | null {
  return (
    options.project?.trim() || options.env.HOF_PROJECT?.trim() || findProjectBinding(options.cwd)
  );
}

export async function resolveProject(
  store: GraphReader,
  options: ProjectResolution,
): Promise<Project> {
  const ref = projectIdFrom(options);
  if (!ref) {
    throw graphError('VALIDATION_ERROR', 'No project bound to this directory', {
      hint: 'Run `hof use <project>` here, pass --project <id>, or set HOF_PROJECT',
    });
  }
  return resolveProjectRef(store, ref);
}
