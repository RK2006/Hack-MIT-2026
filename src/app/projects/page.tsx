import Link from 'next/link';
import type { Project } from '@/server/context/types';
import { getStore } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  let projects: Project[] = [];
  let loadError: string | null = null;
  try {
    projects = await (await getStore()).listProjects();
  } catch {
    loadError = 'Could not load projects. Check DATABASE_URL and that PostgreSQL is running.';
  }
  return (
    <main className="home">
      <header className="home-brand">
        <Link href="/" className="home-wordmark" title="Back to the cover">
          Handoff
        </Link>
        <span className="home-brand-sep" aria-hidden="true">
          /
        </span>
        <h1>Projects</h1>
      </header>
      <p className="muted">
        Pick a project to inspect its graph, review proposals, and compile task context.
      </p>
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
