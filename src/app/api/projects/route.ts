import { route } from '@/server/http';
import { getStore } from '@/server/runtime';
import { handleListProjects } from '@/server/workbench/handlers';

export const dynamic = 'force-dynamic';

export const GET = route<Record<string, never>>(async () => handleListProjects(await getStore()));
