import { z } from 'zod';

/**
 * Boundary validation for process env.
 *
 * Parsing is lazy and memoised rather than done at module scope: `next build`
 * imports server modules with no .env present (the Docker builder stage has no
 * secrets), and a top-level throw there would break the image build. Anything
 * that actually needs a value calls `env()` at request time, by which point the
 * container has its environment.
 */
const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    SHADOW_DATABASE_URL: z.string().optional(),
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be >= 32 chars (openssl rand -base64 32)'),
    AUTH_URL: z.url().default('http://localhost:3001'),
    AUTH_TRUST_HOST: z.stringbool().default(true),

    // Optional so the app boots before the Entra app registration exists.
    // `entraConfigured` below is the flag the auth config actually branches on.
    AZURE_AD_CLIENT_ID: z.string().optional(),
    AZURE_AD_CLIENT_SECRET: z.string().optional(),
    AZURE_AD_TENANT_ID: z.string().optional(),

    AUTH_DEV_LOGIN: z.stringbool().default(false),

    SUPER_ADMIN_EMAILS: z.string().default(''),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().default('Help Desk <helpdesk@example.com>'),

    IMAP_HOST: z.string().optional(),
    IMAP_PORT: z.coerce.number().int().positive().default(993),
    IMAP_USER: z.string().optional(),
    IMAP_PASSWORD: z.string().optional(),
    EMAIL_POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  })
  .transform((raw) => ({
    ...raw,
    entraConfigured: Boolean(
      raw.AZURE_AD_CLIENT_ID && raw.AZURE_AD_CLIENT_SECRET && raw.AZURE_AD_TENANT_ID,
    ),
    superAdminEmails: raw.SUPER_ADMIN_EMAILS.split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
    smtpConfigured: Boolean(raw.SMTP_HOST),
  }))
  .superRefine((value, ctx) => {
    // A dev bypass reachable in production is the single worst thing in this
    // file, so it fails loudly at boot rather than quietly granting access.
    if (value.NODE_ENV === 'production' && value.AUTH_DEV_LOGIN) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_DEV_LOGIN'],
        message: 'AUTH_DEV_LOGIN must be false when NODE_ENV=production',
      });
    }
    if (value.NODE_ENV === 'production' && !value.entraConfigured) {
      ctx.addIssue({
        code: 'custom',
        path: ['AZURE_AD_CLIENT_ID'],
        message: 'Entra ID credentials are required when NODE_ENV=production',
      });
    }
  });

export type Env = z.infer<typeof schema>;

/**
 * Pure parse of an arbitrary environment source. Kept separate from `env()` so
 * tests can assert on configuration rules without mutating `process.env`
 * (whose NODE_ENV is readonly under Next's types anyway).
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }
  return parsed.data;
}

let cached: Env | undefined;

export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Test-only: drop the memoised value after mutating process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
