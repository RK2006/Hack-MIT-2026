import { z } from 'zod';
import { graphError } from '../errors';
import { parseUuid } from '../validation';
import { REQUEST_LIMITS, type ContextRequest } from './types';

const schema = z
  .object({
    task: z
      .string()
      .refine((value) => !value.includes('\0'), 'task must not contain NUL')
      .transform((value) => value.trim())
      .refine(
        (value) =>
          Array.from(value).length >= 1 && Array.from(value).length <= REQUEST_LIMITS.taskMax,
        `task must be 1..${REQUEST_LIMITS.taskMax} characters`,
      ),
    tokenBudget: z.number().int().min(REQUEST_LIMITS.budgetMin).max(REQUEST_LIMITS.budgetMax),
    startNodeIds: z.array(z.string()).max(REQUEST_LIMITS.startMax).optional(),
    maxDepth: z.number().int().min(0).max(REQUEST_LIMITS.depthMax).optional(),
    allowDegraded: z.boolean().optional(),
  })
  .strict();

export type ParsedContextRequest = Required<Omit<ContextRequest, 'startNodeIds'>> & {
  startNodeIds: string[];
};

export function parseContextRequest(raw: unknown): ParsedContextRequest {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw graphError('VALIDATION_ERROR', 'Invalid context request', {
      path: issue?.path.join('.') ?? '',
      reason: issue?.message ?? 'invalid request',
    });
  }
  const startNodeIds = result.data.startNodeIds ?? [];
  startNodeIds.forEach((id) => parseUuid(id, 'startNodeIds'));
  if (new Set(startNodeIds).size !== startNodeIds.length)
    throw graphError('VALIDATION_ERROR', 'startNodeIds must be distinct', { path: 'startNodeIds' });
  return {
    task: result.data.task,
    tokenBudget: result.data.tokenBudget,
    startNodeIds,
    maxDepth: result.data.maxDepth ?? REQUEST_LIMITS.depthDefault,
    allowDegraded: result.data.allowDegraded ?? false,
  };
}
