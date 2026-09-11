import { AppError, ValidationError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Uniform return shape for server actions, so forms can render errors with
 * `useActionState` instead of every action inventing its own contract.
 */
export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Run an action body, converting our error taxonomy into an ActionResult.
 *
 * IMPORTANT: never call `redirect()` inside `fn`. Next implements redirect by
 * throwing, and this catch block would swallow it. Redirect on the caller side
 * after inspecting the result.
 */
export async function runAction<T>(name: string, fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof ValidationError) {
      return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
    }
    if (error instanceof AppError) {
      // Expected, handled conditions (403/404/409) are info, not incidents.
      logger.info({ action: name, code: error.code, context: error.context }, 'action rejected');
      return { ok: false, error: error.message };
    }

    logger.error({ action: name, err: error }, 'action failed');
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}

/** Collect zod issues into the fieldErrors shape ActionResult uses. */
export function fieldErrorsFrom(issues: Array<{ path: PropertyKey[]; message: string }>) {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || '_form';
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}
