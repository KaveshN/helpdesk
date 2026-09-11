import Link from 'next/link';
import { requireSessionContext } from '@/lib/auth/session';
import { ticketFormOptions } from '@/lib/tickets/service';
import { can } from '@/lib/authz/guard';
import { TicketCreateForm } from '@/components/ticket-create-form';
import { PageHeader } from '@/components/ui/page-header';
import { NoPermission } from '@/components/no-permission';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New ticket' };

export default async function NewTicketPage() {
  const { actor, group } = await requireSessionContext();

  if (!can(actor, 'ticket:create', group.helpDeskGroupId)) {
    return (
      <NoPermission
        title="You cannot raise tickets in this help desk"
        detail={`Your role in ${group.groupName} is read-only. An agent or administrator can raise one on your behalf.`}
        backHref="/tickets"
        backLabel="Back to tickets"
      />
    );
  }

  const options = await ticketFormOptions(group);

  const misconfigured =
    options.types.length === 0 || options.priorities.length === 0 || options.statuses.length === 0;

  return (
    <div className="max-w-[80rem]">
      <PageHeader
        title="New ticket"
        breadcrumb={
          <Link href="/tickets" className="link">
            Tickets
          </Link>
        }
        description={
          <>
            Raising this in <span className="font-medium text-foreground">{group.groupName}</span> (
            {group.groupKey}).
          </>
        }
      />

      {misconfigured ? (
        <div
          className="card p-4"
          style={{ background: 'var(--warning-subtle)', color: 'var(--warning)' }}
        >
          This help desk has no active types, priorities or statuses configured, so tickets cannot
          be created yet.{' '}
          {can(actor, 'group:manage_taxonomy', group.helpDeskGroupId) ? (
            <Link href="/admin/configuration" className="font-medium underline">
              Configure them now
            </Link>
          ) : (
            'Ask a help desk administrator to configure them.'
          )}
        </div>
      ) : (
        <TicketCreateForm
          types={options.types.map((type) => ({ id: type.id, name: type.name }))}
          priorities={options.priorities.map((priority) => ({
            id: priority.id,
            name: priority.name,
          }))}
          categories={options.categories.map((category) => ({
            id: category.id,
            name: category.name,
            subCategories: category.subCategories.map((subCategory) => ({
              id: subCategory.id,
              name: subCategory.name,
            })),
          }))}
          assignees={options.assignees}
          canAssign={can(actor, 'ticket:assign', group.helpDeskGroupId)}
        />
      )}
    </div>
  );
}
