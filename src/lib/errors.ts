/**
 * Application error taxonomy. Everything thrown deliberately by our own code
 * extends AppError so route handlers and server actions can map to a status
 * code without string-matching messages.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly context: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      context?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.status = options.status ?? 500;
    this.code = options.code ?? 'internal_error';
    this.context = options.context ?? {};
  }
}

/** The caller is not signed in. */
export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, { status: 401, code: 'unauthenticated' });
  }
}

/** Signed in, but lacks the capability (or the group membership) required. */
export class ForbiddenError extends AppError {
  constructor(
    message = 'You do not have permission to do this',
    context?: Record<string, unknown>,
  ) {
    super(message, { status: 403, code: 'forbidden', context });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', context?: Record<string, unknown>) {
    super(message, { status: 404, code: 'not_found', context });
  }
}

export class ValidationError extends AppError {
  readonly fieldErrors: Record<string, string[]>;

  constructor(message = 'Invalid input', fieldErrors: Record<string, string[]> = {}) {
    super(message, { status: 422, code: 'validation_error' });
    this.fieldErrors = fieldErrors;
  }
}

/**
 * Raised when a query would have crossed a help desk group boundary. This is
 * always a bug (or an attack) -- never an expected control-flow path -- so it
 * carries enough context to identify the offending call site in logs.
 */
export class TenancyViolationError extends AppError {
  constructor(context: {
    model: string;
    operation: string;
    expected: string;
    actual?: string | null;
  }) {
    super(
      `Tenancy violation: ${context.operation} on ${context.model} targeted group ` +
        `${context.actual ?? 'platform-global'} while scoped to ${context.expected}`,
      { status: 403, code: 'tenancy_violation', context },
    );
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflicts with existing data', context?: Record<string, unknown>) {
    super(message, { status: 409, code: 'conflict', context });
  }
}
