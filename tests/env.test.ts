import { describe, expect, it } from 'vitest';
import { parseEnv } from '@/lib/env';

/** The minimum a deployment must supply. */
const BASE = {
  DATABASE_URL: 'postgresql://helpdesk:helpdesk@localhost:5432/helpdesk',
  REDIS_URL: 'redis://localhost:6379',
  AUTH_SECRET: 'x'.repeat(32),
};

const ENTRA = {
  AZURE_AD_CLIENT_ID: 'client',
  AZURE_AD_CLIENT_SECRET: 'secret',
  AZURE_AD_TENANT_ID: 'tenant',
};

describe('parseEnv', () => {
  it('applies defaults for optional settings', () => {
    const config = parseEnv(BASE);
    expect(config.NODE_ENV).toBe('development');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.AUTH_DEV_LOGIN).toBe(false);
    expect(config.AUTH_URL).toBe('http://localhost:3001');
    expect(config.entraConfigured).toBe(false);
    expect(config.smtpConfigured).toBe(false);
  });

  it('fails loudly when a required value is missing', () => {
    const { DATABASE_URL: _omitted, ...withoutDatabase } = BASE;
    expect(() => parseEnv(withoutDatabase)).toThrow(/DATABASE_URL/);
  });

  it('rejects a short AUTH_SECRET', () => {
    expect(() => parseEnv({ ...BASE, AUTH_SECRET: 'too-short' })).toThrow(/AUTH_SECRET/);
  });

  it('reports Entra as configured only when all three values are present', () => {
    expect(
      parseEnv({ ...BASE, AZURE_AD_CLIENT_ID: 'client', AZURE_AD_CLIENT_SECRET: 'secret' })
        .entraConfigured,
    ).toBe(false);

    expect(parseEnv({ ...BASE, ...ENTRA }).entraConfigured).toBe(true);
  });

  it('REFUSES to start with the dev login enabled in production', () => {
    // The most important assertion in this file: a credentials provider
    // reachable in production is an authentication bypass.
    expect(() =>
      parseEnv({ ...BASE, ...ENTRA, NODE_ENV: 'production', AUTH_DEV_LOGIN: 'true' }),
    ).toThrow(/AUTH_DEV_LOGIN must be false when NODE_ENV=production/);
  });

  it('requires Entra credentials in production', () => {
    expect(() => parseEnv({ ...BASE, NODE_ENV: 'production' })).toThrow(
      /Entra ID credentials are required/,
    );
  });

  it('allows the dev login outside production', () => {
    expect(parseEnv({ ...BASE, AUTH_DEV_LOGIN: 'true' }).AUTH_DEV_LOGIN).toBe(true);
    expect(parseEnv({ ...BASE, NODE_ENV: 'test', AUTH_DEV_LOGIN: 'true' }).AUTH_DEV_LOGIN).toBe(
      true,
    );
  });

  it('parses the super admin bootstrap list into lowercase addresses', () => {
    expect(
      parseEnv({ ...BASE, SUPER_ADMIN_EMAILS: ' First@Example.com , second@example.com ,' })
        .superAdminEmails,
    ).toEqual(['first@example.com', 'second@example.com']);
  });

  it('treats an empty bootstrap list as nobody', () => {
    expect(parseEnv(BASE).superAdminEmails).toEqual([]);
  });

  it('coerces numeric settings from strings', () => {
    const config = parseEnv({ ...BASE, SMTP_PORT: '2525', EMAIL_POLL_INTERVAL_SECONDS: '15' });
    expect(config.SMTP_PORT).toBe(2525);
    expect(config.EMAIL_POLL_INTERVAL_SECONDS).toBe(15);
  });

  it('rejects an unknown log level rather than silently defaulting', () => {
    expect(() => parseEnv({ ...BASE, LOG_LEVEL: 'chatty' })).toThrow(/LOG_LEVEL/);
  });
});
