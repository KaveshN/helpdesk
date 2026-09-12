import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApprovalDecision, ChangeStatus } from '@/generated/prisma/enums';
import { requireSessionContext } from '@/lib/auth/session';
import { getChangeDetail } from '@/lib/changes/service';
import { allowedTransitions, evaluateCab, isEditable } from '@/lib/changes/lifecycle';
import { can } from '@/lib/authz/guard';
import { NotFoundError } from '@/lib/errors';
import { Pill } from '@/components/ui/pill';
import { ChangeStatusBadge } from '@/components/change-status-badge';
import { ChangeDecisionForm } from '@/components/change-decision-form';
import { ChangeLifecycleActions } from '@/components/change-lifecycle-actions';

export const dynamic = 'force-dynamic';

function formatDateTime(value: Date | null): string {
  return value ? value.toISOString().slice(0, 16).replace('T', ' ') : '—';
}

const DECISION_LABEL: Record<ApprovalDecision, string> = {
  PENDING: 'Awaiting',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  ABSTAINED: 'Abstained',
};

/** Buttons for the transitions the state machine permits from here. */
const TRANSITION_META: Partial<
  Record<
    ChangeStatus,
    { label: string; tone: 'primary' | 'secondary' | 'danger'; needsNotes?: boolean }
  >
> = {
  SCHEDULED: { label: 'Mark scheduled', tone: 'secondary' },
  IN_PROGRESS: { label: 'Start implementation', tone: 'primary' },
  COMPLETED: { label: 'Mark completed', tone: 'primary', needsNotes: true },
  FAILED: { label: 'Mark failed', tone: 'danger', needsNotes: true },
  ROLLED_BACK: { label: 'Record rollback', tone: 'danger', needsNotes: true },
  CANCELLED: { label: 'Cancel change', tone: 'danger' },
  DRAFT: { label: 'Return to draft', tone: 'secondary' },
};

export default async function ChangeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, group } = await requireSessionContext();

  let change;
  try {
    change = await getChangeDetail(actor, group, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const myApproval = change.approvals.find((approval) => approval.approverId === actor.userId);
  const canVote =
    change.status === ChangeStatus.PENDING_APPROVAL &&
    ((myApproval !== undefined && myApproval.decision === ApprovalDecision.PENDING) ||
      (myApproval === undefined && can(actor, 'change:approve', group.helpDeskGroupId)));

  // Show the board's current standing, computed with the same function the
  // server uses when recording a vote.
  const standing =
    change.cab && change.approvals.length > 0
      ? evaluateCab(
          change.cab.approvalMode,
          change.cab.quorum,
          change.cab.rejectionIsFinal,
          change.approvals.map((approval) => ({
            decision: approval.decision,
            isVoting: approval.isVoting,
            isChair: approval.isChair,
          })),
        )
      : null;

  const capabilityFor = (to: ChangeStatus) =>
    to === ChangeStatus.SCHEDULED
      ? 'change:schedule'
      : to === ChangeStatus.CANCELLED
        ? 'change:cancel'
        : to === ChangeStatus.DRAFT
          ? 'change:update'
          : 'change:implement';

  const transitions = allowedTransitions(change.status)
    .filter((to) => TRANSITION_META[to])
    .filter((to) => can(actor, capabilityFor(to), group.helpDeskGroupId))
    // APPROVED/REJECTED are outcomes of voting, never buttons.
    .filter((to) => to !== ChangeStatus.APPROVED && to !== ChangeStatus.REJECTED)
    .map((to) => ({ to, ...TRANSITION_META[to]! }));

  const canSubmit =
    change.status === ChangeStatus.DRAFT && can(actor, 'change:update', group.helpDeskGroupId);

  return (
    <div className="space-y-6">
      <nav className="text-sm text-muted-foreground">
        <Link href="/changes" className="underline">
          Change requests
        </Link>
        <span className="mx-2">/</span>
        <span className="font-mono">{change.reference}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{change.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <ChangeStatusBadge status={change.status} />
            <Pill label={change.riskLevel.name} colour={change.riskLevel.colour} />
            <span>{change.changeType.name}</span>
            {change.changeType.isPreApproved ? (
              <span className="text-xs text-success">pre-approved type</span>
            ) : null}
            <span>&middot;</span>
            <span>
              raised by {change.requester.name} on {formatDateTime(change.createdAt)}
            </span>
          </div>
        </div>
        <dl className="text-right text-xs text-muted-foreground">
          <dt className="sr-only">Reference</dt>
          <dd className="font-mono text-sm text-foreground">{change.reference}</dd>
          <dd>{group.groupName}</dd>
        </dl>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-6">
          {[
            { title: 'What is changing and why', body: change.description },
            { title: 'Impact assessment', body: change.impactAssessment },
            { title: 'Implementation plan', body: change.implementationPlan },
            { title: 'Rollback plan', body: change.rollbackPlan },
            { title: 'Test plan', body: change.testPlan },
            { title: 'Outcome notes', body: change.outcomeNotes },
          ]
            .filter((section) => section.body?.trim())
            .map((section) => (
              <article key={section.title} className="card p-4">
                <h2 className="panel-title">{section.title}</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{section.body}</p>
              </article>
            ))}

          {change.cab ? (
            <section className="card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="panel-title">
                  {change.cab.name}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {change.cab.approvalMode === 'QUORUM'
                      ? `quorum of ${change.cab.quorum}`
                      : change.cab.approvalMode.toLowerCase().replace(/_/g, ' ')}
                  </span>
                </h2>
                {standing ? (
                  <span className="text-xs text-muted-foreground">
                    {standing.approvals} approved / {standing.required} required
                  </span>
                ) : null}
              </div>

              {standing ? <p className="mt-1 text-xs text-muted-foreground">{standing.reason}</p> : null}

              <table className="data-table mt-3 w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-2 py-2">Member</th>
                    <th className="px-2 py-2">Role</th>
                    <th className="px-2 py-2">Decision</th>
                    <th className="px-2 py-2">Comment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {change.approvals.map((approval) => (
                    <tr key={approval.id}>
                      <td className="px-2 py-2">{approval.approver.name}</td>
                      <td className="px-2 py-2 text-xs text-muted-foreground">
                        {approval.isChair ? 'Chair' : approval.isVoting ? 'Voting' : 'Non-voting'}
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className={
                            approval.decision === 'APPROVED'
                              ? 'text-success'
                              : approval.decision === 'REJECTED'
                                ? 'text-destructive'
                                : 'text-muted-foreground'
                          }
                        >
                          {DECISION_LABEL[approval.decision]}
                        </span>
                        {approval.decidedAt ? (
                          <span className="ml-2 text-xs text-faint">
                            {formatDateTime(approval.decidedAt)}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-xs text-muted-foreground">{approval.comment ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {canVote ? (
            <section className="card p-4">
              <h2 className="panel-title">Your CAB decision</h2>
              <p className="mt-1 mb-3 text-xs text-muted-foreground">
                {myApproval
                  ? 'You are on this board.'
                  : 'You are recording a decision as a help desk administrator rather than a board member.'}
              </p>
              <ChangeDecisionForm changeRequestId={change.id} />
            </section>
          ) : null}

          <section className="card p-4">
            <h2 className="panel-title">Lifecycle</h2>
            <ol className="mt-3 space-y-2 text-sm">
              {change.events.map((event) => (
                <li key={event.id} className="flex flex-wrap gap-2 text-muted-foreground">
                  <span className="font-mono text-xs text-faint">
                    {formatDateTime(event.createdAt)}
                  </span>
                  <span>
                    <span className="font-medium text-foreground">
                      {event.actor?.name ?? 'System'}
                    </span>{' '}
                    {event.type.toLowerCase().replace(/_/g, ' ')}
                    {event.newValue ? (
                      <span className="text-muted-foreground"> — {event.newValue}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="space-y-6">
          {canSubmit || transitions.length > 0 ? (
            <div className="card p-4">
              <h2 className="panel-title mb-3">Actions</h2>
              <ChangeLifecycleActions
                changeRequestId={change.id}
                canSubmit={canSubmit}
                transitions={transitions}
              />
              {change.status === ChangeStatus.DRAFT ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Submitting needs an implementation plan and a rollback plan.
                  {change.riskLevel.minimumNoticeHours > 0 ? (
                    <>
                      {' '}
                      {change.riskLevel.name} risk also requires{' '}
                      {change.riskLevel.minimumNoticeHours} hours&rsquo; notice before the planned
                      start.
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="card p-4">
            <h2 className="panel-title mb-2">Details</h2>
            <dl>
              {(
                [
                  ['Category', change.changeCategory?.name ?? '—'],
                  ['Owner', change.owner?.name ?? 'Unassigned'],
                  ['Requester', change.requester.name],
                  ['CAB required', change.riskLevel.requiresCab ? 'Yes' : 'No'],
                  ['Planned start', formatDateTime(change.plannedStartAt)],
                  ['Planned end', formatDateTime(change.plannedEndAt)],
                  ['Actual start', formatDateTime(change.actualStartAt)],
                  ['Actual end', formatDateTime(change.actualEndAt)],
                  ['Submitted', formatDateTime(change.submittedAt)],
                  ['Decided', formatDateTime(change.decidedAt)],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="meta-row">
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {change.linkedTickets.length > 0 ? (
            <div className="card p-4">
              <h2 className="panel-title">Related tickets</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {change.linkedTickets.map((ticket) => (
                  <li key={ticket.id}>
                    <Link href={`/tickets/${ticket.id}`} className="font-mono text-xs underline">
                      {ticket.reference}
                    </Link>
                    <span className="ml-2 text-muted-foreground">{ticket.subject}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                A citation, not ownership: these tickets keep their own lifecycle.
              </p>
            </div>
          ) : null}

          {isEditable(change.status) && can(actor, 'change:update', group.helpDeskGroupId) ? (
            <p className="text-xs text-muted-foreground">
              This change is still editable. Once submitted it is locked, because the CAB votes on
              what it read.
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
