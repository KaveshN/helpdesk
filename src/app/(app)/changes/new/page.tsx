import Link from 'next/link';
import { requireSessionContext } from '@/lib/auth/session';
import { changeFormOptions } from '@/lib/changes/service';
import { can } from '@/lib/authz/guard';
import { scopedDb } from '@/lib/db/scoped';
import { createChangeAction } from '@/server/actions/changes';
import { ActionForm } from '@/components/action-form';
import { NoPermission } from '@/components/no-permission';
import { PageHeader } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Raise a change' };

export default async function NewChangePage({
  searchParams,
}: {
  searchParams: Promise<{ ticketId?: string }>;
}) {
  const { actor, group } = await requireSessionContext();

  if (!can(actor, 'change:create', group.helpDeskGroupId)) {
    return (
      <NoPermission
        title="You cannot raise change requests in this help desk"
        detail={`Your role in ${group.groupName} is read-only for change management.`}
        backHref="/changes"
        backLabel="Back to changes"
      />
    );
  }

  const { ticketId } = await searchParams;
  const options = await changeFormOptions(group);

  // Optional cross-reference from an incident. Scoped read, so a ticket id from
  // another group simply resolves to nothing.
  const linkedTicket = ticketId
    ? await scopedDb(group.helpDeskGroupId).ticket.findFirst({
        where: { id: ticketId },
        select: { id: true, reference: true, subject: true },
      })
    : null;

  if (options.types.length === 0 || options.riskLevels.length === 0) {
    return (
      <div
        className="card max-w-2xl p-4"
        style={{ background: 'var(--warning-subtle)', color: 'var(--warning)' }}
      >
        This help desk has no active change types or risk levels, so changes cannot be raised.{' '}
        {can(actor, 'group:manage_change_config', group.helpDeskGroupId) ? (
          <Link href="/admin/change-config" className="link">
            Configure them now
          </Link>
        ) : (
          'Ask a help desk administrator to configure them.'
        )}
      </div>
    );
  }

  const defaultRisk = options.riskLevels.find((risk) => risk.isDefault) ?? options.riskLevels[0]!;
  const defaultType = options.types.find((type) => type.isDefault) ?? options.types[0]!;

  return (
    <div className="max-w-[88rem]">
      <PageHeader
        title="Raise a change"
        breadcrumb={
          <Link href="/changes" className="link">
            Change requests
          </Link>
        }
        description={
          <>
            In <span className="font-medium text-foreground">{group.groupName}</span>. Numbered{' '}
            <span className="font-mono">{group.groupKey}-C-…</span> and saved as a draft — you
            submit it for approval separately.
          </>
        }
      />

      {linkedTicket ? (
        <div className="card mb-4 px-4 py-3">
          Citing ticket <span className="font-mono text-xs">{linkedTicket.reference}</span>:{' '}
          <span className="text-muted-foreground">{linkedTicket.subject}</span>
        </div>
      ) : null}

      <ActionForm
        action={createChangeAction}
        submitLabel="Save draft"
        successMessage="Draft saved."
        redirectTo="/changes/:id"
      >
        {linkedTicket ? (
          <input type="hidden" name="linkedTicketId" value={linkedTicket.id} />
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="card space-y-4 p-5">
              <div>
                <label className="label" htmlFor="title">
                  Title
                </label>
                <input id="title" name="title" required maxLength={300} className="input" />
              </div>

              <div>
                <label className="label" htmlFor="description">
                  What is changing and why
                </label>
                <textarea
                  id="description"
                  name="description"
                  required
                  rows={5}
                  className="textarea"
                />
              </div>
            </div>

            {/* The planning fields carry the governance weight, so they get their
                own panel rather than being buried in a long single column. */}
            <div className="card space-y-4 p-5">
              <h2 className="panel-title">Plans</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="label" htmlFor="implementationPlan">
                    Implementation plan{' '}
                    <span className="font-normal text-faint">required to submit</span>
                  </label>
                  <textarea
                    id="implementationPlan"
                    name="implementationPlan"
                    rows={6}
                    className="textarea"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="rollbackPlan">
                    Rollback plan <span className="font-normal text-faint">required to submit</span>
                  </label>
                  <textarea id="rollbackPlan" name="rollbackPlan" rows={6} className="textarea" />
                </div>
                <div>
                  <label className="label" htmlFor="testPlan">
                    Test plan
                  </label>
                  <textarea id="testPlan" name="testPlan" rows={4} className="textarea" />
                </div>
                <div>
                  <label className="label" htmlFor="impactAssessment">
                    Impact assessment
                  </label>
                  <textarea
                    id="impactAssessment"
                    name="impactAssessment"
                    rows={4}
                    className="textarea"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="card space-y-4 p-5">
              <h2 className="panel-title">Classification</h2>

              <div>
                <label className="label" htmlFor="changeTypeId">
                  Change type
                </label>
                <select
                  id="changeTypeId"
                  name="changeTypeId"
                  defaultValue={defaultType.id}
                  className="select"
                >
                  {options.types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                      {type.isPreApproved ? ' (pre-approved)' : ''}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  A pre-approved type skips the CAB entirely.
                </p>
              </div>

              <div>
                <label className="label" htmlFor="riskLevelId">
                  Risk level
                </label>
                <select
                  id="riskLevelId"
                  name="riskLevelId"
                  defaultValue={defaultRisk.id}
                  className="select"
                >
                  {options.riskLevels.map((risk) => (
                    <option key={risk.id} value={risk.id}>
                      {risk.name}
                      {risk.requiresCab ? ' — CAB required' : ''}
                      {risk.minimumNoticeHours > 0 ? ` — ${risk.minimumNoticeHours}h notice` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label" htmlFor="changeCategoryId">
                  Category
                </label>
                <select id="changeCategoryId" name="changeCategoryId" className="select">
                  <option value="">Not categorised</option>
                  {options.categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label" htmlFor="ownerId">
                  Implementation owner
                </label>
                <select id="ownerId" name="ownerId" className="select">
                  <option value="">Unassigned</option>
                  {options.owners.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="card space-y-4 p-5">
              <h2 className="panel-title">Window</h2>
              <div>
                <label className="label" htmlFor="plannedStartAt">
                  Planned start
                </label>
                <input
                  id="plannedStartAt"
                  name="plannedStartAt"
                  type="datetime-local"
                  className="input"
                />
              </div>
              <div>
                <label className="label" htmlFor="plannedEndAt">
                  Planned end
                </label>
                <input
                  id="plannedEndAt"
                  name="plannedEndAt"
                  type="datetime-local"
                  className="input"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                High and Critical risk levels enforce a minimum notice period between submission and
                the planned start.
              </p>
            </div>
          </div>
        </div>
      </ActionForm>
    </div>
  );
}
