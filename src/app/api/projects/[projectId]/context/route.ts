import { handleCompileContext } from '@/server/context/compiler/handler';
import { route } from '@/server/http';
import { getCompilerDeps } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export const POST = route<{ projectId: string }>(async (request, params) =>
  handleCompileContext(await getCompilerDeps(), request, params),
);
