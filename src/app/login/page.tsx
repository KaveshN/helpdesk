import { redirect } from 'next/navigation';
import { AlertCircle, LifeBuoy } from 'lucide-react';
import { AuthError } from 'next-auth';
import {
  DEV_PROVIDER_ID,
  ENTRA_PROVIDER_ID,
  availableAuthMethods,
  signIn,
} from '@/lib/auth/config';
import { getActor } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Sign in' };

const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: 'That address is not a known help desk user.',
  OAuthAccountNotLinked: 'That Microsoft account is already linked to a different user.',
  AccessDenied: 'Your account is not permitted to sign in.',
  Configuration: 'Sign-in is misconfigured. Check the Entra ID credentials in .env.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const actor = await getActor();
  if (actor) redirect('/dashboard');

  const { error } = await searchParams;
  const methods = availableAuthMethods();

  /**
   * Auth.js implements sign-in by throwing a redirect, so the AuthError branch
   * must come first and anything else must be rethrown -- catching everything
   * here would swallow the successful redirect.
   */
  async function signInWithEntra() {
    'use server';
    try {
      await signIn(ENTRA_PROVIDER_ID, { redirectTo: '/dashboard' });
    } catch (thrown) {
      if (thrown instanceof AuthError) redirect(`/login?error=${thrown.type}`);
      throw thrown;
    }
  }

  async function signInWithDevLogin(formData: FormData) {
    'use server';
    try {
      await signIn(DEV_PROVIDER_ID, {
        email: String(formData.get('email') ?? ''),
        redirectTo: '/dashboard',
      });
    } catch (thrown) {
      if (thrown instanceof AuthError) redirect(`/login?error=${thrown.type}`);
      throw thrown;
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel: hidden on small screens, where it would just push the
          form below the fold. */}
      <aside
        className="relative hidden flex-col justify-between p-10 lg:flex"
        style={{ background: 'var(--muted)' }}
      >
        <div className="flex items-center gap-2">
          <LifeBuoy className="size-5" style={{ color: 'var(--primary)' }} aria-hidden />
          <span className="font-semibold tracking-tight">Help Desk</span>
        </div>

        <div className="max-w-md">
          <h2 className="text-2xl font-semibold tracking-tight">
            One platform, many independent help desks.
          </h2>
          <p className="mt-3 text-muted-foreground">
            Each group runs its own queues, categories, SLAs, calendars, change advisory boards and
            reporting. Administration is central; configuration is not.
          </p>
          <dl className="mt-8 grid grid-cols-3 gap-4">
            {[
              ['Per group', 'SLAs & calendars'],
              ['Per group', 'CAB & risk levels'],
              ['Never merged', 'Reporting'],
            ].map(([label, value]) => (
              <div key={value}>
                <dt className="text-2xs tracking-wider text-faint uppercase">{label}</dt>
                <dd className="mt-1 text-sm font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="text-xs text-faint">Signed in with Microsoft Entra ID.</p>
      </aside>

      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <LifeBuoy className="size-5" style={{ color: 'var(--primary)' }} aria-hidden />
            <span className="font-semibold tracking-tight">Help Desk</span>
          </div>

          <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-muted-foreground">Your groups and roles are assigned by an administrator.</p>

          {error ? (
            <div
              role="alert"
              className="mt-6 flex items-start gap-2 rounded-lg border px-3 py-2.5"
              style={{
                background: 'var(--destructive-subtle)',
                color: 'var(--destructive)',
                borderColor: 'color-mix(in oklch, var(--destructive) 30%, transparent)',
              }}
            >
              <AlertCircle className="mt-px size-4 shrink-0" aria-hidden />
              {ERROR_MESSAGES[error] ?? 'Sign-in failed. Please try again.'}
            </div>
          ) : null}

          <div className="mt-6 space-y-5">
            {methods.entra ? (
              <form action={signInWithEntra}>
                <button type="submit" className="btn-primary w-full !py-2.5">
                  Continue with Microsoft
                </button>
              </form>
            ) : (
              <p
                className="rounded-lg px-3 py-2.5 text-xs"
                style={{ background: 'var(--warning-subtle)', color: 'var(--warning)' }}
              >
                Entra ID sign-in is not configured. Set <code>AZURE_AD_CLIENT_ID</code>,{' '}
                <code>AZURE_AD_CLIENT_SECRET</code> and <code>AZURE_AD_TENANT_ID</code> in{' '}
                <code>.env</code>.
              </p>
            )}

            {methods.entra && methods.devLogin ? (
              <div className="flex items-center gap-3 text-2xs tracking-wider text-faint uppercase">
                <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
                or
                <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
              </div>
            ) : null}

            {methods.devLogin ? (
              <form action={signInWithDevLogin} className="space-y-3">
                <div>
                  <label className="label" htmlFor="email">
                    Developer login
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="username"
                    placeholder="agent@example.com"
                    className="input"
                  />
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Seeded users only — this provider never creates accounts, and refuses to load
                    when <code>NODE_ENV=production</code>.
                  </p>
                </div>
                <button type="submit" className="btn-secondary w-full !py-2.5">
                  Continue without Microsoft
                </button>
              </form>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
