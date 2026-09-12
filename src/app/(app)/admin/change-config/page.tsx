import { requireSessionContext } from '@/lib/auth/session';
import { listChangeConfig } from '@/lib/changes/config';
import { can } from '@/lib/authz/guard';
import {
  removeCabMemberAction,
  saveCabAction,
  saveCabMemberAction,
  saveChangeCategoryAction,
  saveChangeTypeAction,
  saveRiskLevelAction,
} from '@/server/actions/changes';
import { ActionForm } from '@/components/action-form';
import { ConfirmForm } from '@/components/confirm-form';
import { NoPermission } from '@/components/no-permission';
import { Pill } from '@/components/ui/pill';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Change configuration' };

const APPROVAL_MODES = [
  { value: 'QUORUM', label: 'Quorum — a set number of approvals' },
  { value: 'ALL_MEMBERS', label: 'All voting members must approve' },
  { value: 'ANY_MEMBER', label: 'Any single member can approve' },
  { value: 'CHAIR_ONLY', label: 'Only the chair decides' },
] as const;

export default async function ChangeConfigPage() {
  const { actor, group } = await requireSessionContext();

  if (!can(actor, 'change:read', group.helpDeskGroupId)) {
    return <NoPermission title="You do not have access to change management" />;
  }

  const canEditTaxonomy = can(actor, 'group:manage_change_config', group.helpDeskGroupId);
  const canEditCab = can(actor, 'group:manage_cab', group.helpDeskGroupId);
  const { types, categories, riskLevels, cabs, workflows, candidates } = await listChangeConfig(
    actor,
    group,
  );

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Change configuration</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The change module&rsquo;s own taxonomy and boards for{' '}
          <span className="font-medium">{group.groupName}</span> &mdash; separate from the ticket
          configuration, and separate from every other help desk.
        </p>
        {!canEditTaxonomy && !canEditCab ? (
          <p className="mt-2 rounded-md bg-muted px-3 py-2 text-sm text-foreground">
            You can view this configuration but not change it.
          </p>
        ) : null}
      </header>

      {/* --- Risk levels ------------------------------------------------ */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">Risk levels</h2>
          <p className="text-sm text-muted-foreground">
            Level 1 is the highest risk. <strong>Requires CAB</strong> is what actually gates
            approval, and the notice period is the lead time expected before the planned start.
          </p>
        </div>

        <div className="card divide-y divide-border">
          {riskLevels.map((risk) => (
            <details key={risk.id} className="px-4 py-3">
              <summary className="flex cursor-pointer flex-wrap items-center gap-3 text-sm">
                <Pill label={risk.name} colour={risk.colour} />
                <span className="text-muted-foreground">level {risk.level}</span>
                {risk.requiresCab ? (
                  <span className="text-xs font-medium text-warning">CAB required</span>
                ) : (
                  <span className="text-xs text-muted-foreground">no CAB</span>
                )}
                {risk.minimumNoticeHours > 0 ? (
                  <span className="text-xs text-muted-foreground">{risk.minimumNoticeHours}h notice</span>
                ) : null}
                {risk.isDefault ? <span className="text-xs text-muted-foreground">default</span> : null}
                {!risk.isActive ? <span className="text-xs text-destructive">inactive</span> : null}
              </summary>

              {canEditTaxonomy ? (
                <div className="mt-4">
                  <ActionForm action={saveRiskLevelAction} submitLabel="Save risk level" compact>
                    <input type="hidden" name="id" value={risk.id} />
                    <div className="grid gap-3 sm:grid-cols-4">
                      <div className="sm:col-span-2">
                        <label className="label">Name</label>
                        <input name="name" defaultValue={risk.name} required className="input" />
                      </div>
                      <div>
                        <label className="label">Level (1 = highest)</label>
                        <input
                          name="level"
                          type="number"
                          min={1}
                          max={99}
                          defaultValue={risk.level}
                          required
                          className="input"
                        />
                      </div>
                      <div>
                        <label className="label">Colour</label>
                        <input
                          name="colour"
                          defaultValue={risk.colour ?? ''}
                          className="input font-mono"
                        />
                      </div>
                      <div>
                        <label className="label">Minimum notice (hours)</label>
                        <input
                          name="minimumNoticeHours"
                          type="number"
                          min={0}
                          defaultValue={risk.minimumNoticeHours}
                          className="input"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="label">Description</label>
                        <input
                          name="description"
                          defaultValue={risk.description ?? ''}
                          className="input"
                        />
                      </div>
                      <div className="flex flex-wrap items-end gap-4 sm:col-span-4">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            name="requiresCab"
                            value="true"
                            defaultChecked={risk.requiresCab}
                            className="size-4"
                          />
                          Requires CAB approval
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            name="isDefault"
                            value="true"
                            defaultChecked={risk.isDefault}
                            className="size-4"
                          />
                          Default
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            name="isActive"
                            value="true"
                            defaultChecked={risk.isActive}
                            className="size-4"
                          />
                          Active
                        </label>
                      </div>
                    </div>
                  </ActionForm>
                </div>
              ) : null}
            </details>
          ))}
        </div>

        {canEditTaxonomy ? (
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Add a risk level</h3>
            <ActionForm
              action={saveRiskLevelAction}
              submitLabel="Add risk level"
              compact
              successMessage="Added."
            >
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="sm:col-span-2">
                  <label className="label">Name</label>
                  <input name="name" required className="input" placeholder="Very high" />
                </div>
                <div>
                  <label className="label">Level</label>
                  <input name="level" type="number" min={1} max={99} required className="input" />
                </div>
                <div>
                  <label className="label">Notice (hours)</label>
                  <input
                    name="minimumNoticeHours"
                    type="number"
                    min={0}
                    defaultValue={0}
                    className="input"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm sm:col-span-4">
                  <input
                    type="checkbox"
                    name="requiresCab"
                    value="true"
                    defaultChecked
                    className="size-4"
                  />
                  Requires CAB approval
                </label>
              </div>
            </ActionForm>
          </div>
        ) : null}
      </section>

      {/* --- CABs -------------------------------------------------------- */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">Change Advisory Boards</h2>
          <p className="text-sm text-muted-foreground">
            A CAB is scoped to this help desk. Risk levels routed here decide which changes it sees;
            a change at a risk level with no CAB cannot be submitted.
          </p>
        </div>

        {cabs.map((cab) => (
          <div key={cab.id} className="card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">
                {cab.name}
                {cab.isDefault ? <span className="ml-2 text-xs text-muted-foreground">default</span> : null}
                {!cab.isActive ? <span className="ml-2 text-xs text-destructive">inactive</span> : null}
              </h3>
              <span className="text-xs text-muted-foreground">
                {cab.approvalMode === 'QUORUM'
                  ? `quorum of ${cab.quorum}`
                  : cab.approvalMode.toLowerCase().replace(/_/g, ' ')}
                {' · '}
                {cab._count.changes} change(s)
                {cab.workflow ? ` · workflow: ${cab.workflow.name}` : ''}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              {cab.riskLevels.length === 0 ? (
                <span className="text-xs text-warning">
                  No risk levels routed here — this board will never be asked to approve anything.
                </span>
              ) : (
                cab.riskLevels.map((link) => (
                  <span
                    key={link.id}
                    className="rounded-full border px-2 py-0.5 text-xs text-foreground"
                  >
                    {link.riskLevel.name}
                  </span>
                ))
              )}
            </div>

            <table className="data-table mt-4 w-full text-sm">
              <thead>
                <tr>
                  <th className="px-2 py-2">Member</th>
                  <th className="px-2 py-2">Role</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {cab.members.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-2 py-4 text-center text-warning">
                      No members. A board with no voting members can never approve a change.
                    </td>
                  </tr>
                ) : (
                  cab.members.map((member) => (
                    <tr key={member.id}>
                      <td className="px-2 py-2">
                        {member.user.name}
                        <span className="ml-2 text-xs text-muted-foreground">{member.user.email}</span>
                      </td>
                      <td className="px-2 py-2 text-xs text-muted-foreground">
                        {member.isChair ? 'Chair · ' : ''}
                        {member.isVoting ? 'Voting' : 'Non-voting'}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {canEditCab ? (
                          <ConfirmForm
                            action={removeCabMemberAction}
                            values={{ cabId: cab.id, userId: member.userId }}
                            label="Remove"
                            confirmMessage={`Remove ${member.user.name} from ${cab.name}?`}
                          />
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {canEditCab ? (
              <div className="mt-4 grid gap-6 border-t pt-4 lg:grid-cols-2">
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-foreground">
                    Add or update a member
                  </h4>
                  <ActionForm action={saveCabMemberAction} submitLabel="Save member" compact>
                    <input type="hidden" name="cabId" value={cab.id} />
                    <div>
                      <label className="label">Person</label>
                      <select name="userId" className="input" required>
                        <option value="">Choose…</option>
                        {candidates.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name} ({candidate.email})
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Must already be a member of this help desk.
                      </p>
                    </div>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="isVoting"
                          value="true"
                          defaultChecked
                          className="size-4"
                        />
                        Voting
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="isChair" value="true" className="size-4" />
                        Chair
                      </label>
                    </div>
                  </ActionForm>
                </div>

                <div>
                  <h4 className="mb-2 text-sm font-semibold text-foreground">Board settings</h4>
                  <ActionForm action={saveCabAction} submitLabel="Save board" compact>
                    <input type="hidden" name="id" value={cab.id} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="label">Name</label>
                        <input name="name" defaultValue={cab.name} required className="input" />
                      </div>
                      <div>
                        <label className="label">Approval mode</label>
                        <select
                          name="approvalMode"
                          defaultValue={cab.approvalMode}
                          className="input"
                        >
                          {APPROVAL_MODES.map((mode) => (
                            <option key={mode.value} value={mode.value}>
                              {mode.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="label">Quorum</label>
                        <input
                          name="quorum"
                          type="number"
                          min={1}
                          defaultValue={cab.quorum}
                          className="input"
                        />
                      </div>
                      <div>
                        <label className="label">Attached workflow</label>
                        <select
                          name="workflowId"
                          defaultValue={cab.workflowId ?? ''}
                          className="input"
                        >
                          <option value="">None</option>
                          {workflows.map((workflow) => (
                            <option key={workflow.id} value={workflow.id}>
                              {workflow.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <fieldset className="sm:col-span-2">
                        <legend className="label">Risk levels routed to this board</legend>
                        <div className="flex flex-wrap gap-3">
                          {riskLevels.map((risk) => (
                            <label key={risk.id} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                name="riskLevelIds[]"
                                value={risk.id}
                                defaultChecked={cab.riskLevels.some(
                                  (link) => link.riskLevelId === risk.id,
                                )}
                                className="size-4"
                              />
                              {risk.name}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <div className="flex flex-wrap gap-4 sm:col-span-2">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            name="rejectionIsFinal"
                            value="true"
                            defaultChecked={cab.rejectionIsFinal}
                            className="size-4"
                          />
                          A single rejection ends the change
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            name="isActive"
                            value="true"
                            defaultChecked={cab.isActive}
                            className="size-4"
                          />
                          Active
                        </label>
                      </div>
                    </div>
                  </ActionForm>
                </div>
              </div>
            ) : null}
          </div>
        ))}

        {canEditCab ? (
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Add a CAB</h3>
            <ActionForm
              action={saveCabAction}
              submitLabel="Add board"
              compact
              successMessage="Added."
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="label">Name</label>
                  <input name="name" required className="input" placeholder="Emergency CAB" />
                </div>
                <div>
                  <label className="label">Approval mode</label>
                  <select name="approvalMode" defaultValue="QUORUM" className="input">
                    {APPROVAL_MODES.map((mode) => (
                      <option key={mode.value} value={mode.value}>
                        {mode.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Quorum</label>
                  <input name="quorum" type="number" min={1} defaultValue={2} className="input" />
                </div>
                <fieldset className="sm:col-span-3">
                  <legend className="label">Risk levels routed to this board</legend>
                  <div className="flex flex-wrap gap-3">
                    {riskLevels.map((risk) => (
                      <label key={risk.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="riskLevelIds[]"
                          value={risk.id}
                          className="size-4"
                        />
                        {risk.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            </ActionForm>
          </div>
        ) : null}
      </section>

      {/* --- Types and categories --------------------------------------- */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-semibold">Change types</h2>
            <p className="text-sm text-muted-foreground">
              A <strong>pre-approved</strong> type skips the CAB regardless of risk &mdash;
              ITIL&rsquo;s standard change.
            </p>
          </div>

          <div className="card divide-y divide-border">
            {types.map((type) => (
              <details key={type.id} className="px-4 py-3">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{type.name}</span>
                  {type.isPreApproved ? (
                    <span className="text-xs text-success">pre-approved</span>
                  ) : null}
                  {type.isDefault ? <span className="text-xs text-muted-foreground">default</span> : null}
                  {!type.isActive ? <span className="text-xs text-destructive">inactive</span> : null}
                </summary>
                {canEditTaxonomy ? (
                  <div className="mt-4">
                    <ActionForm action={saveChangeTypeAction} submitLabel="Save type" compact>
                      <input type="hidden" name="id" value={type.id} />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="label">Name</label>
                          <input name="name" defaultValue={type.name} required className="input" />
                        </div>
                        <div>
                          <label className="label">Sort order</label>
                          <input
                            name="sortOrder"
                            type="number"
                            defaultValue={type.sortOrder}
                            className="input"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="label">Description</label>
                          <input
                            name="description"
                            defaultValue={type.description ?? ''}
                            className="input"
                          />
                        </div>
                        <div className="flex flex-wrap gap-4 sm:col-span-2">
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              name="isPreApproved"
                              value="true"
                              defaultChecked={type.isPreApproved}
                              className="size-4"
                            />
                            Pre-approved (skips the CAB)
                          </label>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              name="isDefault"
                              value="true"
                              defaultChecked={type.isDefault}
                              className="size-4"
                            />
                            Default
                          </label>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              name="isActive"
                              value="true"
                              defaultChecked={type.isActive}
                              className="size-4"
                            />
                            Active
                          </label>
                        </div>
                      </div>
                    </ActionForm>
                  </div>
                ) : null}
              </details>
            ))}
          </div>

          {canEditTaxonomy ? (
            <div className="card p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Add a change type</h3>
              <ActionForm
                action={saveChangeTypeAction}
                submitLabel="Add type"
                compact
                successMessage="Added."
              >
                <div>
                  <label className="label">Name</label>
                  <input name="name" required className="input" />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="isPreApproved" value="true" className="size-4" />
                  Pre-approved (skips the CAB)
                </label>
              </ActionForm>
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          <div>
            <h2 className="text-base font-semibold">Change categories</h2>
            <p className="text-sm text-muted-foreground">
              The change module&rsquo;s own categories &mdash; not the ticket categories.
            </p>
          </div>

          <div className="card divide-y divide-border">
            {categories.map((category) => (
              <details key={category.id} className="px-4 py-3">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{category.name}</span>
                  {!category.isActive ? (
                    <span className="text-xs text-destructive">inactive</span>
                  ) : null}
                </summary>
                {canEditTaxonomy ? (
                  <div className="mt-4">
                    <ActionForm
                      action={saveChangeCategoryAction}
                      submitLabel="Save category"
                      compact
                    >
                      <input type="hidden" name="id" value={category.id} />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="label">Name</label>
                          <input
                            name="name"
                            defaultValue={category.name}
                            required
                            className="input"
                          />
                        </div>
                        <div>
                          <label className="label">Sort order</label>
                          <input
                            name="sortOrder"
                            type="number"
                            defaultValue={category.sortOrder}
                            className="input"
                          />
                        </div>
                        <label className="flex items-center gap-2 text-sm sm:col-span-2">
                          <input
                            type="checkbox"
                            name="isActive"
                            value="true"
                            defaultChecked={category.isActive}
                            className="size-4"
                          />
                          Active
                        </label>
                      </div>
                    </ActionForm>
                  </div>
                ) : null}
              </details>
            ))}
          </div>

          {canEditTaxonomy ? (
            <div className="card p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Add a change category</h3>
              <ActionForm
                action={saveChangeCategoryAction}
                submitLabel="Add category"
                compact
                successMessage="Added."
              >
                <div>
                  <label className="label">Name</label>
                  <input name="name" required className="input" placeholder="Cloud platform" />
                </div>
              </ActionForm>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
