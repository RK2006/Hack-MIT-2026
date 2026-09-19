import { GraphError, type GraphErrorCode } from './context/errors';

const STATUS: Record<GraphErrorCode | 'FORBIDDEN_ORIGIN', number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  AUTHORITY_VIOLATION: 403,
  LIMIT_EXCEEDED: 422,
  EMBEDDING_UNAVAILABLE: 503,
  STORAGE_ERROR: 500,
  FORBIDDEN_ORIGIN: 403,
};

export type ErrorEnvelope = {
  error: { code: keyof typeof STATUS; message: string; details?: Record<string, unknown> };
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof GraphError) {
    const body: ErrorEnvelope = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details && { details: error.details }),
      },
    };
    return json(body, STATUS[error.code]);
  }
  console.error({ operation: 'route', code: 'STORAGE_ERROR' });
  return json(
    {
      error: { code: 'STORAGE_ERROR', message: 'Unexpected server error' },
    } satisfies ErrorEnvelope,
    500,
  );
}

/** Same-origin guard for mutations: browsers send Origin/Sec-Fetch-Site; local tools may send neither. */
export function assertSameOrigin(request: Request): Response | null {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'same-origin' || fetchSite === 'none') return null;
  if (origin) {
    // Next may rewrite request.url's host (localhost vs 127.0.0.1); compare against the Host header.
    const host = request.headers.get('host') ?? new URL(request.url).host;
    try {
      if (new URL(origin).host === host) return null;
    } catch {
      /* malformed Origin falls through to rejection */
    }
  } else if (!fetchSite) {
    return null;
  }
  return json(
    {
      error: { code: 'FORBIDDEN_ORIGIN', message: 'Cross-origin mutations are not allowed' },
    } satisfies ErrorEnvelope,
    403,
  );
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new GraphError('VALIDATION_ERROR', 'Request body must be valid JSON');
  }
}

/** Route wrapper: awaits params, runs the handler, and maps typed errors to the JSON envelope. */
export function route<P>(
  handler: (request: Request, params: P) => Promise<Response>,
): (request: Request, context: { params: Promise<P> }) => Promise<Response> {
  return async (request, context) => {
    try {
      return await handler(request, await context.params);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
