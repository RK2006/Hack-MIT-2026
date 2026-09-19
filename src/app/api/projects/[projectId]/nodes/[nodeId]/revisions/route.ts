import { route } from '@/server/http';
import { getStore } from '@/server/runtime';
import {
  handleListRevisions,
  handleReviseNode,
  type NodeParams,
} from '@/server/workbench/handlers';

export const dynamic = 'force-dynamic';

export const GET = route<NodeParams>(async (_request, params) =>
  handleListRevisions(await getStore(), params),
);

export const POST = route<NodeParams>(async (request, params) =>
  handleReviseNode(await getStore(), request, params),
);
