import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import { z } from 'zod';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { currentAuthEpoch } from '@/lib/redis';
import { findUserForDevLogin, upsertUserFromEntra } from '@/lib/auth/provisioning';

export const ENTRA_PROVIDER_ID = 'microsoft-entra-id';
export const DEV_PROVIDER_ID = 'dev-login';

const devCredentialsSchema = z.object({
  email: z.string().min(3).max(320),
});

/**
 * Auth.js (next-auth v5) configuration.
 *
 * Built lazily inside a function because `env()` throws when configuration is
 * missing, and `next build` must not require a populated .env.
 */
function buildConfig(): NextAuthConfig {
  const config = env();
  const providers: NextAuthConfig['providers'] = [];

  if (config.entraConfigured) {
    providers.push(
      MicrosoftEntraID({
        clientId: config.AZURE_AD_CLIENT_ID!,
        clientSecret: config.AZURE_AD_CLIENT_SECRET!,
        issuer: `https://login.microsoftonline.com/${config.AZURE_AD_TENANT_ID}/v2.0`,
      }),
    );
  }

  // Dev-only escape hatch so the app is usable before the Entra app
  // registration exists. env.ts refuses to start with this enabled under
  // NODE_ENV=production; the second check here is belt and braces.
  if (config.AUTH_DEV_LOGIN && config.NODE_ENV !== 'production') {
    providers.push(
      Credentials({
        id: DEV_PROVIDER_ID,
        name: 'Developer login',
        credentials: {
          email: { label: 'Email', type: 'email', placeholder: 'agent@example.com' },
        },
        async authorize(raw) {
          const parsed = devCredentialsSchema.safeParse(raw);
          if (!parsed.success) return null;

          const user = await findUserForDevLogin(parsed.data.email);
          if (!user) {
            logger.warn(
              { email: parsed.data.email },
              'dev login rejected: unknown or inactive user',
            );
            return null;
          }

          logger.warn({ userId: user.id, email: user.email }, 'DEV LOGIN used');
          return { id: user.id, email: user.email, name: user.name };
        },
      }),
    );
  }

  if (providers.length === 0) {
    logger.error(
      'No authentication providers configured: set AZURE_AD_* credentials or AUTH_DEV_LOGIN=true',
    );
  }

  return {
    providers,
    secret: config.AUTH_SECRET,
    trustHost: config.AUTH_TRUST_HOST,
    session: {
      strategy: 'jwt',
      // A working day. Revocation does not wait for this -- see redis.ts.
      maxAge: 8 * 60 * 60,
      updateAge: 30 * 60,
    },
    pages: {
      signIn: '/login',
      error: '/login',
    },
    callbacks: {
      async jwt({ token, account, profile, user }) {
        // Only runs work on initial sign-in; later calls just pass the token on.
        if (account?.provider === ENTRA_PROVIDER_ID && profile) {
          const oid = typeof profile.oid === 'string' ? profile.oid : undefined;
          const email =
            (typeof profile.email === 'string' && profile.email) ||
            (typeof profile.preferred_username === 'string' && profile.preferred_username) ||
            undefined;

          if (!oid || !email) {
            logger.error(
              { hasOid: Boolean(oid), hasEmail: Boolean(email) },
              'Entra profile missing claims',
            );
            throw new Error('Entra ID token is missing the oid or email claim');
          }

          const dbUser = await upsertUserFromEntra({
            objectId: oid,
            email,
            name: typeof profile.name === 'string' ? profile.name : email,
            jobTitle: typeof profile.jobTitle === 'string' ? profile.jobTitle : null,
          });

          token.userId = dbUser.id;
          token.email = dbUser.email;
          token.name = dbUser.name;
          token.epoch = await currentAuthEpoch(dbUser.id);
        } else if (account?.provider === DEV_PROVIDER_ID && user?.id) {
          token.userId = user.id;
          token.epoch = await currentAuthEpoch(user.id);
        }

        return token;
      },

      async session({ session, token }) {
        // Narrowed rather than trusted: JWT is `Record<string, unknown>`, so a
        // malformed or legacy token must not produce a session with a
        // non-string user id.
        const userId = typeof token.userId === 'string' ? token.userId : undefined;
        if (userId) {
          session.user.id = userId;
        }
        session.epoch = typeof token.epoch === 'number' ? token.epoch : 0;
        return session;
      },
    },
    logger: {
      error: (error) => logger.error({ err: error }, 'auth error'),
      warn: (code) => logger.warn({ code }, 'auth warning'),
    },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth(buildConfig);

/** Which sign-in buttons the login page should render. */
export function availableAuthMethods(): { entra: boolean; devLogin: boolean } {
  const config = env();
  return {
    entra: config.entraConfigured,
    devLogin: config.AUTH_DEV_LOGIN && config.NODE_ENV !== 'production',
  };
}
