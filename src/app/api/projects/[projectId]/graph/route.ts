import { route } from '@/server/http';
import { getStore } from '@/server/runtime';
import { handleGetGraph, type ProjectParams } from '@/server/workbench/handlers';

export const dynamic = 'force-dynamic';

export const GET = route<ProjectParams>(async (_request, params) =>
  handleGetGraph(await getStore(), params),
);
