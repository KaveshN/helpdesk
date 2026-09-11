import { headers } from 'next/headers';
import type { AuditActor } from '@/lib/audit';
import type { Actor } from '@/lib/authz/actor';

/**
 * Request metadata for the audit trail. `x-forwarded-for` is only meaningful
 * behind a proxy that sets it, which is why AUTH_TRUST_HOST exists -- treat the
 * value as a hint, not as identity.
 */
export async function auditContext(actor: Actor): Promise<AuditActor> {
  const headerList = await headers();
  const forwarded = headerList.get('x-forwarded-for');

  return {
    userId: actor.userId,
    email: actor.email,
    ipAddress: forwarded?.split(',')[0]?.trim() ?? headerList.get('x-real-ip') ?? null,
    userAgent: headerList.get('user-agent'),
  };
}
