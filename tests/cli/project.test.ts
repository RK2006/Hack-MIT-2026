import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findProjectBinding,
  projectIdFrom,
  resolveProject,
  resolveProjectRef,
  writeProjectBinding,
} from '../../src/cli/project';
import { GraphError } from '../../src/server/context/errors';
import type { GraphReader, Project } from '../../src/server/context/types';

const demo: Project = {
  id: '7f63f0c8-9a4e-4e2a-8ebd-a8f2b3f8c101',
  name: 'Demo Payments Platform (synthetic)',
  createdAt: '2026-09-19T00:00:00.000Z',
};
const self: Project = {
  id: '0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f',
  name: 'Context Graph (this repository)',
  createdAt: '2026-09-19T00:00:00.000Z',
};
const reader = {
  listProjects: async () => [demo, self],
  getProject: async (id: string) => {
    const found = [demo, self].find((project) => project.id === id);
    if (!found) throw new GraphError('NOT_FOUND', 'Project not found');
    return found;
  },
} as unknown as GraphReader;

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hof-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('project binding', () => {
  it('writes .hof/project and finds it from nested directories', () => {
    writeProjectBinding(root, demo.id);
    expect(findProjectBinding(join(root, 'a', 'b'))).toBe(demo.id);
    expect(findProjectBinding(root)).toBe(demo.id);
  });

  it('returns null when nothing is bound', () => {
    expect(findProjectBinding(root)).toBeNull();
  });

  it('prefers --project, then HOF_PROJECT, then the binding file', () => {
    writeProjectBinding(root, demo.id);
    expect(projectIdFrom({ cwd: root, env: {} })).toBe(demo.id);
    expect(projectIdFrom({ cwd: root, env: { HOF_PROJECT: self.id } })).toBe(self.id);
    expect(projectIdFrom({ project: 'Demo', cwd: root, env: { HOF_PROJECT: self.id } })).toBe(
      'Demo',
    );
  });
});

describe('resolveProjectRef', () => {
  it('accepts a UUID or a unique case-insensitive name substring', async () => {
    expect(await resolveProjectRef(reader, demo.id)).toEqual(demo);
    expect(await resolveProjectRef(reader, 'demo payments')).toEqual(demo);
    expect(await resolveProjectRef(reader, 'this repository')).toEqual(self);
  });

  it('reports misses and ambiguity', async () => {
    await expect(resolveProjectRef(reader, 'nothing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(resolveProjectRef(reader, 'a')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});

describe('resolveProject', () => {
  it('explains how to bind when nothing is configured', async () => {
    await expect(resolveProject(reader, { cwd: root, env: {} })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { hint: expect.stringContaining('hof use') },
    });
  });

  it('resolves the bound project', async () => {
    writeProjectBinding(root, self.id);
    expect(await resolveProject(reader, { cwd: root, env: {} })).toEqual(self);
  });
});
