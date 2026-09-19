import { route } from '@/server/http';
import { getStore } from '@/server/runtime';
import { handleGetNode, type NodeParams } from '@/server/workbench/handlers';

export const dynamic = 'force-dynamic';

export const GET = route<NodeParams>(async (_request, params) =>
  handleGetNode(await getStore(), params),
);
