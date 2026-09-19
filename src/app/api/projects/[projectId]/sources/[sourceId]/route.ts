import { route } from '@/server/http';
import { getStore } from '@/server/runtime';
import { handleGetSource, type SourceParams } from '@/server/workbench/handlers';

export const dynamic = 'force-dynamic';

export const GET = route<SourceParams>(async (_request, params) =>
  handleGetSource(await getStore(), params),
);
