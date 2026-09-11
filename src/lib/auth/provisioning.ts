import { PlatformRole } from '@/generated/prisma/enums';
import { db } from '@/lib/db/client';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { recordAudit } from '@/lib/audit';

/**
 * Just-in-time user provisioning from the Entra ID token (brief §6).
 *
 * Group memberships and roles are assigned inside this app, NOT read from Entra
 * security groups -- so this only ever creates or refreshes the User row. The
 * one exception is Super Administrator, which is bootstrapped from
 * SUPER_ADMIN_EMAILS so a brand-new deployment has someone who can log in and
 * configure it.
 */

export type EntraIdentity = {
  /** The `oid` claim: stable per user per tenant. The real primary identity. */
  objectId: string;
  email: string;
  name: string;
  jobTitle?: string | null;
};

export async function upsertUserFromEntra(identity: EntraIdentity) {
  const email = identity.email.toLowerCase();
  const shouldBeSuperAdmin = env().superAdminEmails.includes(email);
  const client = db();

  // Match on entraObjectId first, falling back to email. The fallback is what
  // links a seeded/invited row (email known, oid not yet) to its Entra identity
  // on first real login.
  const existing =
    (await client.user.findUnique({ where: { entraObjectId: identity.objectId } })) ??
    (await client.user.findUnique({ where: { email } }));

  if (!existing) {
    const created = await client.user.create({
      data: {
        entraObjectId: identity.objectId,
        email,
        name: identity.name,
        jobTitle: identity.jobTitle ?? null,
        platformRole: shouldBeSuperAdmin ? PlatformRole.SUPER_ADMIN : null,
        lastLoginAt: new Date(),
      },
    });

    await recordAudit({
      action: 'user.provision',
      entityType: 'User',
      entityId: created.id,
      after: { email: created.email, name: created.name, platformRole: created.platformRole },
      actor: { userId: created.id, email: created.email },
    });

    logger.info({ userId: created.id, email }, 'provisioned user from Entra ID');
    return created;
  }

  // Promotion is one-way here on purpose: demotion happens through the admin UI,
  // so removing an address from SUPER_ADMIN_EMAILS never silently strips a role
  // an administrator granted deliberately.
  const promote = shouldBeSuperAdmin && existing.platformRole !== PlatformRole.SUPER_ADMIN;

  const updated = await client.user.update({
    where: { id: existing.id },
    data: {
      entraObjectId: identity.objectId,
      name: identity.name,
      jobTitle: identity.jobTitle ?? existing.jobTitle,
      lastLoginAt: new Date(),
      ...(promote ? { platformRole: PlatformRole.SUPER_ADMIN } : {}),
    },
  });

  if (promote) {
    await recordAudit({
      action: 'user.promote_super_admin',
      entityType: 'User',
      entityId: updated.id,
      before: { platformRole: existing.platformRole },
      after: { platformRole: updated.platformRole },
      actor: { userId: updated.id, email: updated.email },
    });
  }

  return updated;
}

/**
 * Dev-login lookup. Deliberately does NOT create users: the dev provider is a
 * way to impersonate a seeded persona, not a way to mint accounts. An unknown
 * address fails to sign in.
 */
export async function findUserForDevLogin(rawEmail: string) {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return null;

  const user = await db().user.findUnique({ where: { email } });
  if (!user || !user.isActive) return null;

  await db().user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return user;
}
