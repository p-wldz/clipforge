export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly hint?: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function publicError(error: unknown) {
  if (error instanceof AppError)
    return { error: error.message, code: error.code, ...(error.hint ? { hint: error.hint } : {}) };
  return { error: error instanceof Error ? error.message : 'Unexpected server error', code: 'UNEXPECTED' };
}

export function errorStatus(error: unknown) {
  return error instanceof AppError ? error.status : 400;
}
