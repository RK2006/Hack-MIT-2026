import { assertSameOrigin, json, readJson } from '../../http';
import { compileContext, type CompilerDeps } from './compile';

/** POST /api/projects/:projectId/context — returns a ContextBundle or the JSON error envelope. */
export async function handleCompileContext(
  deps: CompilerDeps,
  request: Request,
  params: { projectId: string },
): Promise<Response> {
  const forbidden = assertSameOrigin(request);
  if (forbidden) return forbidden;
  const body = await readJson(request);
  return json(await compileContext(deps, params.projectId, body));
}
