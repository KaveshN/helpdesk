/**
 * Next.js instrumentation hook: runs once when the server process starts.
 * Edge runtimes cannot open a Postgres connection, so the check is limited to
 * the Node runtime.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { assertRuntimeRole } = await import('@/lib/db/role-check');
  await assertRuntimeRole();
}
