export type GraphErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'AUTHORITY_VIOLATION'
  | 'LIMIT_EXCEEDED'
  | 'STORAGE_ERROR';

export class GraphError extends Error {
  constructor(
    public readonly code: GraphErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

export function graphError(
  code: GraphErrorCode,
  message: string,
  details?: Record<string, unknown>,
): GraphError {
  return new GraphError(code, message, details);
}
