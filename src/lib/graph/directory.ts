import { graphFetch } from '@/lib/graph/client';
import { db } from '@/lib/db/client';
import { logger } from '@/lib/logger';

/**
 * Entra ID directory lookup.
 *
 * Searched on demand rather than synced: a mirrored copy of the directory is a
 * copy that goes stale, needs a sync job, and duplicates people who change
 * their name. We only persist a User row for someone once they are actually
 * given a role.
 */

export type DirectoryUser = {
  /** The `id` / `oid` — the durable identity. A UPN can be reassigned. */
  objectId: string;
  displayName: string;
  userPrincipalName: string;
  mail: string | null;
  jobTitle: string | null;
  department: string | null;
  accountEnabled: boolean;
};

type GraphUser = {
  id: string;
  displayName?: string | null;
  userPrincipalName?: string | null;
  mail?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  accountEnabled?: boolean | null;
};

const SELECT = 'id,displayName,userPrincipalName,mail,jobTitle,department,accountEnabled';

function toDirectoryUser(user: GraphUser): DirectoryUser {
  return {
    objectId: user.id,
    displayName: user.displayName ?? user.userPrincipalName ?? user.id,
    userPrincipalName: user.userPrincipalName ?? '',
    mail: user.mail ?? null,
    jobTitle: user.jobTitle ?? null,
    department: user.department ?? null,
    accountEnabled: user.accountEnabled ?? true,
  };
}

/**
 * Search the directory by name or address.
 *
 * `$search` needs ConsistencyLevel: eventual, so this uses `startswith`
 * filters instead — supported on every tenant without extra headers, and
 * predictable for a picker where people type the first few characters.
 */
export async function searchDirectory(query: string, limit = 15): Promise<DirectoryUser[]> {
  const term = query.trim();
  if (term.length < 2) return [];

  // Single-quote escaping for OData: a literal quote is doubled.
  const safe = term.replace(/'/g, "''");
  const filter = [
    `startswith(displayName,'${safe}')`,
    `startswith(userPrincipalName,'${safe}')`,
    `startswith(mail,'${safe}')`,
    `startswith(surname,'${safe}')`,
  ].join(' or ');

  const result = await graphFetch<{ value: GraphUser[] }>({
    path:
      `/users?$select=${SELECT}&$top=${limit}` +
      `&$filter=${encodeURIComponent(`accountEnabled eq true and (${filter})`)}`,
  });

  return result.value.map(toDirectoryUser);
}

export async function getDirectoryUser(objectId: string): Promise<DirectoryUser | null> {
  try {
    const user = await graphFetch<GraphUser>({ path: `/users/${objectId}?$select=${SELECT}` });
    return toDirectoryUser(user);
  } catch (error) {
    logger.warn({ objectId, err: error }, 'directory lookup failed');
    return null;
  }
}

/**
 * Create or refresh the local User row for a directory principal.
 *
 * Matches on `entraObjectId` first and falls back to email — the fallback is
 * what adopts a seeded or previously invited row instead of creating a
 * duplicate person.
 */
export async function upsertUserFromDirectory(directory: DirectoryUser) {
  const email = (directory.mail ?? directory.userPrincipalName).toLowerCase();
  const client = db();

  const existing =
    (await client.user.findUnique({ where: { entraObjectId: directory.objectId } })) ??
    (await client.user.findUnique({ where: { email } }));

  const data = {
    entraObjectId: directory.objectId,
    entraUpn: directory.userPrincipalName,
    entraSyncedAt: new Date(),
    email,
    name: directory.displayName,
    jobTitle: directory.jobTitle,
    department: directory.department,
    isActive: directory.accountEnabled,
  };

  if (!existing) {
    const created = await client.user.create({ data });
    logger.info(
      { userId: created.id, objectId: directory.objectId },
      'user created from directory',
    );
    return created;
  }

  return client.user.update({
    where: { id: existing.id },
    // platformRole is deliberately not touched: role assignment lives in this
    // app, not in the directory.
    data,
  });
}
