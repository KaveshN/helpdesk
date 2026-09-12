import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSessionContext } from '@/lib/auth/session';
import { getTicketDetail, groupMembers, ticketFormOptions } from '@/lib/tickets/service';
import { can, canSeeInternalNotes } from '@/lib/authz/guard';
import { NotFoundError } from '@/lib/errors';
import { Pill } from '@/components/ui/pill';
import { resolveRequester } from '@/lib/tickets/requester';
import { TicketUpdatePanel } from '@/components/ticket-update-panel';
import { TicketReplyBox } from '@/components/ticket-reply-box';
import { WatcherManager } from '@/components/watcher-manager';

export const dynamic = 'force-dynamic';

function formatDateTime(value: Date): string {
  return value.toISOString().slice(0, 16).replace('T', ' ');
}

/** Event rows store ids; turn them into names using the group's own config. */
function describeEvent(
  event: { type: string; field: string | null; oldValue: string | null; newValue: string | null },
  names: Map<string, string>,
): string {
  const from = event.oldValue ? (names.get(event.oldValue) ?? event.oldValue) : null;
  const to = event.newValue ? (names.get(event.newValue) ?? event.newValue) : null;

  switch (event.type) {
    case 'CREATED':
      return 'created the ticket';
    case 'STATUS_CHANGED':
      return `changed status${from ? ` from ${from}` : ''} to ${to}`;
    case 'PRIORITY_CHANGED':
      return `changed priority${from ? ` from ${from}` : ''} to ${to}`;
    case 'ASSIGNED':
      return `assigned the ticket to ${to}`;
    case 'UNASSIGNED':
      return 'removed the assignee';
    case 'CATEGORY_CHANGED':
      return to ? `set the category to ${to}` : 'cleared the category';
    case 'COMMENT_ADDED':
      return 'added a reply';
    case 'WATCHER_ADDED':
      return `added ${to} as a watcher`;
    case 'WATCHER_REMOVED':
      return `removed ${from} as a watcher`;
    case 'REOPENED':
      return `reopened the ticket as ${to}`;
    default:
      return event.type.toLowerCase().replace(/_/g, ' ');
  }
}

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, group } = await requireSessionContext();

  let ticket;
  try {
    ticket = await getTicketDetail(actor, group, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const [options, members] = await Promise.all([ticketFormOptions(group), groupMembers(group)]);

  // One lookup table for every id the timeline might reference.
  const names = new Map<string, string>();
  for (const status of options.statuses) names.set(status.id, status.name);
  for (const priority of options.priorities) names.set(priority.id, priority.name);
  for (const type of options.types) names.set(type.id, type.name);
  for (const category of options.categories) names.set(category.id, category.name);
  for (const member of members) names.set(member.id, member.name);

  const requester = resolveRequester(ticket);
  const mailbox = ticket.group.outboundEmailAddress ?? ticket.group.inboundEmailAddress;
  const canEdit = can(actor, 'ticket:update', group.helpDeskGroupId);
  const canComment = can(actor, 'ticket:comment', group.helpDeskGroupId);

  return (
    <div className="space-y-6">
      <nav className="text-sm text-muted-foreground">
        <Link href="/tickets" className="underline">
          Tickets
        </Link>
        <span className="mx-2">/</span>
        <span className="font-mono">{ticket.reference}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{ticket.subject}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Pill label={ticket.status.name} colour={ticket.status.colour} />
            <Pill label={ticket.priority.name} colour={ticket.priority.colour} />
            <span>{ticket.type.name}</span>
            <span>&middot;</span>
            <span>
              raised by {requester.name}
              {requester.isExternal ? (
                <span className="ml-1 text-faint">(external)</span>
              ) : null} on {formatDateTime(ticket.createdAt)}
            </span>
          </div>
        </div>
        <dl className="text-right text-xs text-muted-foreground">
          <dt className="sr-only">Reference</dt>
          <dd className="font-mono text-sm text-foreground">{ticket.reference}</dd>
          <dt className="mt-1 sr-only">Help desk</dt>
          <dd>{group.groupName}</dd>
        </dl>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="space-y-6">
          <article className="card p-4">
            <h2 className="panel-title">Description</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{ticket.description}</p>
          </article>

          <section className="card divide-y divide-border overflow-hidden">
            <h2 className="panel-title border-b px-4 py-3">
              Conversation ({ticket.comments.length})
            </h2>
            {ticket.comments.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">No replies yet.</p>
            ) : (
              ticket.comments.map((comment) => (
                <article
                  key={comment.id}
                  className="px-4 py-3"
                  style={comment.isInternal ? { background: 'var(--warning-subtle)' } : undefined}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{comment.author.name}</span>
                    <span>{formatDateTime(comment.createdAt)}</span>
                    {comment.isInternal ? (
                      <span
                        className="rounded px-1.5 py-0.5 font-medium"
                        style={{ background: 'var(--warning-subtle)', color: 'var(--warning)' }}
                      >
                        Internal note
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{comment.body}</p>
                </article>
              ))
            )}

            {canComment ? (
              <div className="px-4 py-4">
                <TicketReplyBox
                  ticketId={ticket.id}
                  canReplyByEmail={canComment && Boolean(requester.email)}
                  canAddInternal={canSeeInternalNotes(actor, group.helpDeskGroupId)}
                  requesterEmail={requester.email || null}
                  mailboxConfigured={Boolean(mailbox)}
                />
              </div>
            ) : (
              <p className="px-4 py-4 text-sm text-muted-foreground">
                You have read-only access to this ticket.
              </p>
            )}
          </section>

          <section className="card p-4">
            <h2 className="panel-title">Activity</h2>
            <ol className="mt-3 space-y-2 text-sm">
              {ticket.events.map((event) => (
                <li key={event.id} className="flex flex-wrap gap-2 text-muted-foreground">
                  <span className="font-mono text-xs text-faint">
                    {formatDateTime(event.createdAt)}
                  </span>
                  <span>
                    <span className="font-medium text-foreground">
                      {event.actor?.name ?? 'System'}
                    </span>{' '}
                    {describeEvent(event, names)}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="space-y-6">
          {canEdit ? (
            <TicketUpdatePanel
              ticketId={ticket.id}
              statuses={options.statuses.map((status) => ({ id: status.id, name: status.name }))}
              priorities={options.priorities.map((priority) => ({
                id: priority.id,
                name: priority.name,
              }))}
              types={options.types.map((type) => ({ id: type.id, name: type.name }))}
              categories={options.categories.map((category) => ({
                id: category.id,
                name: category.name,
              }))}
              assignees={options.assignees.map((assignee) => ({
                id: assignee.id,
                name: assignee.name,
              }))}
              current={{
                statusId: ticket.statusId,
                priorityId: ticket.priorityId,
                typeId: ticket.typeId,
                categoryId: ticket.categoryId,
                assigneeId: ticket.assigneeId,
              }}
              canAssign={can(actor, 'ticket:assign', group.helpDeskGroupId)}
            />
          ) : null}

          <div className="card p-4">
            <h2 className="panel-title mb-2">Details</h2>
            <dl>
              {(
                [
                  ['Assignee', ticket.assignee?.name ?? 'Unassigned'],
                  [
                    'Requester',
                    requester.isExternal ? `${requester.name} · external` : requester.name,
                  ],
                  ['Category', ticket.category?.name ?? '—'],
                  ['Subcategory', ticket.subCategory?.name ?? '—'],
                  ['Source', ticket.source],
                  [
                    'Response due',
                    ticket.firstResponseDueAt
                      ? formatDateTime(ticket.firstResponseDueAt)
                      : 'no SLA yet',
                  ],
                  [
                    'Resolution due',
                    ticket.resolutionDueAt ? formatDateTime(ticket.resolutionDueAt) : 'no SLA yet',
                  ],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="meta-row">
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {can(actor, 'change:create', group.helpDeskGroupId) ? (
            <div className="card p-4 text-sm">
              <h2 className="panel-title">Change management</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                If fixing this needs a controlled change, raise one. It gets its own reference and
                approval path &mdash; this ticket keeps its own lifecycle.
              </p>
              <Link href={`/changes/new?ticketId=${ticket.id}`} className="btn-secondary mt-3">
                Raise a change
              </Link>
            </div>
          ) : null}

          <WatcherManager
            ticketId={ticket.id}
            watchers={ticket.watchers.map((watcher) => ({
              userId: watcher.userId,
              name: watcher.user.name,
              email: watcher.user.email,
            }))}
            candidates={members.map((member) => ({
              id: member.id,
              name: member.name,
              email: member.email,
            }))}
            canManage={can(actor, 'ticket:manage_watchers', group.helpDeskGroupId)}
          />
        </aside>
      </div>
    </div>
  );
}
