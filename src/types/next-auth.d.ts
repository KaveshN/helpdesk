import type { DefaultSession } from 'next-auth';

/**
 * Module augmentation so `session.user.id` and the revocation epoch are typed.
 * Note what is deliberately NOT here: roles and memberships. Those are resolved
 * from the database per request (src/lib/auth/session.ts) so that revoking a
 * role takes effect immediately instead of when the token happens to expire.
 */
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
    } & DefaultSession['user'];
    /** Auth epoch the token was minted with; compared against Redis. */
    epoch: number;
  }
}

// The JWT interface is declared in @auth/core/jwt; next-auth/jwt only
// re-exports it, so augmenting that path does not merge.
declare module '@auth/core/jwt' {
  interface JWT {
    userId?: string;
    epoch?: number;
  }
}
