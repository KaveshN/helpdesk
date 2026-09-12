import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getActor, resolveGroupContext } from '@/lib/auth/session';
import { can } from '@/lib/authz/guard';
import { listChanges } from '@/lib/changes/service';
import { changeFilterSchema } from '@/lib/changes/schemas';
import { listTickets } from '@/lib/tickets/service';
import { ticketFilterSchema } from '@/lib/tickets/schemas';

export const dynamic = 'force-dynamic';

const querySchema = z.object({ q: z.string().trim().min(2).max(200) });

/**
 * Command-palette search. Reuses the list services, so results respect the
 * actor's visibility (observer scope, watchers) and the active group scope
 * exactly as the list pages do. Returns the few fields the palette renders.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const group = await resolveGroupContext();
  if (!group) return NextResponse.json({ error: 'No active help desk' }, { status: 400 });

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ q: url.searchParams.get('q') ?? '' });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Query must be 2 to 200 characters' }, { status: 400 });
  }
  const q = parsed.data.q;

  const [tickets, changes] = await Promise.all([
    listTickets(actor, group, ticketFilterSchema.parse({ q, view: 'all', pageSize: 8 })),
    can(actor, 'change:read', group.helpDeskGroupId)
      ? listChanges(actor, group, changeFilterSchema.parse({ q, view: 'all', pageSize: 5 }))
      : Promise.resolve({ items: [] }),
  ]);

  return NextResponse.json({
    tickets: tickets.items.map((ticket) => ({
      id: ticket.id,
      reference: ticket.reference,
      subject: ticket.subject,
      status: ticket.status.name,
      statusColour: ticket.status.colour,
    })),
    changes: changes.items.map((change) => ({
      id: change.id,
      reference: change.reference,
      title: change.title,
      status: change.status,
    })),
  });
}
