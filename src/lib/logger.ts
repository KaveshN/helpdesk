import pino from 'pino';

/**
 * Structured logging. Never use console.* in application code -- ESLint
 * enforces this (see eslint.config.mjs).
 *
 * `redact` is the safety net for the "never log secrets, tokens or PII" rule.
 * It covers the paths our own log calls plausibly touch; it is not a substitute
 * for not passing secrets in the first place.
 */
const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'helpdesk' },
  redact: {
    paths: [
      'password',
      'token',
      'accessToken',
      'refreshToken',
      'idToken',
      'secret',
      'authorization',
      'cookie',
      '*.password',
      '*.token',
      '*.secret',
      'req.headers.authorization',
      'req.headers.cookie',
      'env.AUTH_SECRET',
      'env.AZURE_AD_CLIENT_SECRET',
      'env.DATABASE_URL',
      'env.SMTP_PASSWORD',
      'env.IMAP_PASSWORD',
    ],
    censor: '[redacted]',
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss' },
        },
      }),
});

/** Child logger tagged with the tenant, so group-scoped work is greppable. */
export function groupLogger(helpDeskGroupId: string | null) {
  return logger.child({ helpDeskGroupId: helpDeskGroupId ?? 'platform' });
}
