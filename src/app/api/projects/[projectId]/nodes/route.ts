import { route } from '@/server/http';
import { getStore } from '@/server/runtime';
import { handleCreateNode, handleListNodes, type ProjectParams } from '@/server/workbench/handlers';

export const dynamic = 'force-dynamic';

export const GET = route<ProjectParams>(async (request, params) =>
  handleListNodes(await getStore(), request, params),
);

export const POST = route<ProjectParams>(async (request, params) =>
  handleCreateNode(await getStore(), request, params),
);
