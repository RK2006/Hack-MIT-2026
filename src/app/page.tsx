import Link from 'next/link';
import type { Project } from '@/server/context/types';
import { getStore } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let projects: Project[] = [];
  let loadError: string | null = null;
  try {
    projects = await (await getStore()).listProjects();
  } catch {
    loadError = 'Could not load projects. Check DATABASE_URL and that PostgreSQL is running.';
  }
  return (
    <main className="home">
      <h1>Context Graph Workbench</h1>
      <p className="muted">Inspect, review, and compile task-relevant project context.</p>
      {loadError ? <p className="error">{loadError}</p> : null}
      {!loadError && projects.length === 0 ? (
        <p className="empty">
          No projects yet. Run <code>npm run import:demo</code> to import the demo project, then
          reload this page.
        </p>
      ) : null}
      <ul className="project-list">
        {projects.map((project) => (
          <li key={project.id}>
            <Link href={`/projects/${project.id}`}>{project.name}</Link>
            <span className="muted mono"> {project.id}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
