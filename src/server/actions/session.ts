'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ACTIVE_GROUP_COOKIE, getAccessibleGroups, requireActor } from '@/lib/auth/session';
import { ForbiddenError } from '@/lib/errors';
import { runAction, type ActionResult } from '@/server/actions/result';
import { logger } from '@/lib/logger';

const schema = z.object({ helpDeskGroupId: z.uuid() });

/**
 * Switch the active help desk group (the header switcher).
 *
 * The cookie is only ever written after re-checking that the actor can access
 * the group, and every read re-checks too -- see resolveGroupContext. The cookie
 * is therefore a preference, not a capability.
 */
export async function switchGroupAction(formData: FormData): Promise<ActionResult> {
  return runAction('switchGroup', async () => {
    const actor = await requireActor();
    const parsed = schema.safeParse({ helpDeskGroupId: formData.get('helpDeskGroupId') });
    if (!parsed.success) throw new ForbiddenError('Unknown help desk group');

    const accessible = await getAccessibleGroups();
    const target = accessible.find((group) => group.id === parsed.data.helpDeskGroupId);
    if (!target) {
      logger.warn(
        { userId: actor.userId, helpDeskGroupId: parsed.data.helpDeskGroupId },
        'rejected group switch to inaccessible group',
      );
      throw new ForbiddenError('You do not have access to that help desk');
    }

    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_GROUP_COOKIE, target.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });

    revalidatePath('/', 'layout');
    return undefined;
  });
}
