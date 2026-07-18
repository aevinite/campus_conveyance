export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    /** Underlying Postgres SQLSTATE (e.g. 'P0008') when the error came from an
     *  RPC RAISE, so callers can branch on a stable code instead of message text. */
    public pgCode?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class AuthError extends AppError {
  constructor(message = 'Unauthorized') {
    super('AUTH', message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', message, 403);
  }
}

export function toErrorResponse(err: unknown): {
  code: string;
  message: string;
  status: number;
  pgCode?: string;
} {
  if (err instanceof AppError) {
    return { code: err.code, message: err.message, status: err.status, pgCode: err.pgCode };
  }
  return { code: 'INTERNAL', message: 'Something went wrong', status: 500 };
}
