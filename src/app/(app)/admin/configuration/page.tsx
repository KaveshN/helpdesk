import { requireSessionContext } from '@/lib/auth/session';
import { listTaxonomy } from '@/lib/taxonomy/service';
import { can } from '@/lib/authz/guard';
import { StatusCategory, TicketTypeKind } from '@/generated/prisma/enums';
import {
  saveCategoryAction,
  savePriorityAction,
  saveStatusAction,
  saveSubCategoryAction,
  saveTicketTypeAction,
} from '@/server/actions/taxonomy';
import { ActionForm } from '@/components/action-form';
import { Pill } from '@/components/ui/pill';
import { NoPermission } from '@/components/no-permission';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Configuration' };

const STATUS_CATEGORY_HELP: Record<StatusCategory, string> = {
  NEW: 'Newly raised, not yet picked up',
  OPEN: 'Actively being worked',
  PENDING: 'Waiting on the requester',
  ON_HOLD: 'Waiting on a third party',
  RESOLVED: 'Fixed, awaiting confirmation',
  CLOSED: 'Finished',
  CANCELLED: 'Withdrawn',
};

/** Shared inputs for the active/default flags. */
function Flags({ isActive, isDefault }: { isActive: boolean; isDefault?: boolean }) {
  return (
    <div className="flex flex-wrap gap-4 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="isActive"
          value="true"
          defaultChecked={isActive}
          className="size-4"
        />
        Active
      </label>
      {isDefault !== undefined ? (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="isDefault"
            value="true"
            defaultChecked={isDefault}
            className="size-4"
          />
          Default
        </label>
      ) : null}
    </div>
  );
}

export default async function ConfigurationPage() {
  const { actor, group } = await requireSessionContext();

  if (!can(actor, 'group:view_settings', group.helpDeskGroupId)) {
    return (
      <NoPermission
        title="You cannot view this help desk's configuration"
        detail={`Your role in ${group.groupName} does not include viewing its configuration.`}
      />
    );
  }

  const readOnly = !can(actor, 'group:manage_taxonomy', group.helpDeskGroupId);
  const { categories, statuses, priorities, types } = await listTaxonomy(actor, group);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Configuration</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ticket taxonomy for <span className="font-medium">{group.groupName}</span>. These values
          belong to this help desk only &mdash; other groups have their own.
        </p>
        {readOnly ? (
          <p className="mt-2 rounded-md bg-muted px-3 py-2 text-sm text-foreground">
            You can view this configuration but not change it.
          </p>
        ) : null}
      </header>

      {/* --- Statuses --------------------------------------------------- */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">Statuses</h2>
          <p className="text-sm text-muted-foreground">
            Each status maps to a fixed semantic category so dashboards and the SLA engine
            understand it, whatever you call it.
          </p>
        </div>

        <div className="card divide-y divide-border">
          {statuses.map((status) => (
            <details key={status.id} className="px-4 py-3">
              <summary className="flex cursor-pointer flex-wrap items-center gap-3 text-sm">
                <Pill label={status.name} colour={status.colour} />
                <span className="text-muted-foreground">{status.category}</span>
                {status.pausesSla ? <span className="text-xs text-warning">pauses SLA</span> : null}
                {status.isDefault ? (
                  <span className="text-xs text-muted-foreground">default</span>
                ) : null}
                {!status.isActive ? (
                  <span className="text-xs text-destructive">inactive</span>
                ) : null}
              </summary>

              {readOnly ? null : (
                <div className="mt-4">
                  <ActionForm action={saveStatusAction} submitLabel="Save status" compact>
                    <input type="hidden" name="id" value={status.id} />
                    <div className="grid gap-3 sm:grid-cols-4">
                      <div className="sm:col-span-2">
                        <label className="label">Name</label>
                        <input name="name" defaultValue={status.name} required className="input" />
                      </div>
                      <div>
                        <label className="label">Semantic category</label>
                        <select name="category" defaultValue={status.category} className="input">
                          {Object.values(StatusCategory).map((value) => (
                            <option key={value} value={value}>
                              {value} — {STATUS_CATEGORY_HELP[value]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="label">Sort order</label>
                        <input
                          name="sortOrder"
                          type="number"
                          defaultValue={status.sortOrder}
                          className="input"
                        />
                      </div>
                      <div>
                        <label className="label">Colour</label>
                        <input
                          name="colour"
                          defaultValue={status.colour ?? ''}
                          placeholder="#2563eb"
                          className="input font-mono"
                        />
                      </div>
                      <div className="sm:col-span-3 flex items-end gap-4">
                        <Flags isActive={status.isActive} isDefault={status.isDefault} />
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            name="pausesSla"
                            value="true"
                            defaultChecked={status.pausesSla}
                            className="size-4"
                          />
                          Pauses the SLA clock
                        </label>
                      </div>
                    </div>
                  </ActionForm>
                </div>
              )}
            </details>
          ))}
        </div>

        {readOnly ? null : (
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Add a status</h3>
            <ActionForm
              action={saveStatusAction}
              submitLabel="Add status"
              compact
              successMessage="Added."
            >
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="sm:col-span-2">
                  <label className="label">Name</label>
                  <input name="name" required className="input" placeholder="Awaiting Vendor" />
                </div>
                <div>
                  <label className="label">Semantic category</label>
                  <select name="category" defaultValue={StatusCategory.OPEN} className="input">
                    {Object.values(StatusCategory).map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Colour</label>
                  <input name="colour" placeholder="#7c3aed" className="input font-mono" />
                </div>
              </div>
            </ActionForm>
          </div>
        )}
      </section>

      {/* --- Priorities ------------------------------------------------- */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">Priorities</h2>
          <p className="text-sm text-muted-foreground">
            Level 1 is the most urgent. SLA targets are set per priority, so changing a level
            changes which target applies.
          </p>
        </div>

        <div className="card divide-y divide-border">
          {priorities.map((priority) => (
            <details key={priority.id} className="px-4 py-3">
              <summary className="flex cursor-pointer flex-wrap items-center gap-3 text-sm">
                <Pill label={priority.name} colour={priority.colour} />
                <span className="text-muted-foreground">level {priority.level}</span>
                {priority.isDefault ? (
                  <span className="text-xs text-muted-foreground">default</span>
                ) : null}
                {!priority.isActive ? (
                  <span className="text-xs text-destructive">inactive</span>
                ) : null}
              </summary>

              {readOnly ? null : (
                <div className="mt-4">
                  <ActionForm action={savePriorityAction} submitLabel="Save priority" compact>
                    <input type="hidden" name="id" value={priority.id} />
                    <div className="grid gap-3 sm:grid-cols-4">
                      <div className="sm:col-span-2">
                        <label className="label">Name</label>
                        <input
                          name="name"
                          defaultValue={priority.name}
                          required
                          className="input"
                        />
                      </div>
                      <div>
                        <label className="label">Level</label>
                        <input
                          name="level"
                          type="number"
                          min={1}
                          max={99}
                          defaultValue={priority.level}
                          required
                          className="input"
                        />
                      </div>
                      <div>
                        <label className="label">Colour</label>
                        <input
                          name="colour"
                          defaultValue={priority.colour ?? ''}
                          className="input font-mono"
                        />
                      </div>
                      <div className="sm:col-span-4">
                        <Flags isActive={priority.isActive} isDefault={priority.isDefault} />
                      </div>
                    </div>
                  </ActionForm>
                </div>
              )}
            </details>
          ))}
        </div>

        {readOnly ? null : (
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Add a priority</h3>
            <ActionForm
              action={savePriorityAction}
              submitLabel="Add priority"
              compact
              successMessage="Added."
            >
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="sm:col-span-2">
                  <label className="label">Name</label>
                  <input name="name" required className="input" placeholder="P0 - Emergency" />
                </div>
                <div>
                  <label className="label">Level</label>
                  <input name="level" type="number" min={1} max={99} required className="input" />
                </div>
                <div>
                  <label className="label">Colour</label>
                  <input name="colour" className="input font-mono" placeholder="#991b1b" />
                </div>
              </div>
            </ActionForm>
          </div>
        )}
      </section>

      {/* --- Ticket types ----------------------------------------------- */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">Ticket types</h2>
          <p className="text-sm text-muted-foreground">
            The <em>kind</em> is the fixed ITIL-ish meaning; the name is yours.
          </p>
        </div>

        <div className="card divide-y divide-border">
          {types.map((type) => (
            <details key={type.id} className="px-4 py-3">
              <summary className="flex cursor-pointer flex-wrap items-center gap-3 text-sm">
                <span className="font-medium">{type.name}</span>
                <span className="text-muted-foreground">{type.kind}</span>
                {type.isDefault ? (
                  <span className="text-xs text-muted-foreground">default</span>
                ) : null}
                {!type.isActive ? <span className="text-xs text-destructive">inactive</span> : null}
              </summary>

              {readOnly ? null : (
                <div className="mt-4">
                  <ActionForm action={saveTicketTypeAction} submitLabel="Save type" compact>
                    <input type="hidden" name="id" value={type.id} />
                    <div className="grid gap-3 sm:grid-cols-4">
                      <div className="sm:col-span-2">
                        <label className="label">Name</label>
                        <input name="name" defaultValue={type.name} required className="input" />
                      </div>
                      <div>
                        <label className="label">Kind</label>
                        <select name="kind" defaultValue={type.kind} className="input">
                          {Object.values(TicketTypeKind).map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
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
                      <div className="sm:col-span-4">
                        <Flags isActive={type.isActive} isDefault={type.isDefault} />
                      </div>
                    </div>
                  </ActionForm>
                </div>
              )}
            </details>
          ))}
        </div>

        {readOnly ? null : (
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Add a ticket type</h3>
            <ActionForm
              action={saveTicketTypeAction}
              submitLabel="Add type"
              compact
              successMessage="Added."
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="label">Name</label>
                  <input name="name" required className="input" />
                </div>
                <div>
                  <label className="label">Kind</label>
                  <select
                    name="kind"
                    defaultValue={TicketTypeKind.SERVICE_REQUEST}
                    className="input"
                  >
                    {Object.values(TicketTypeKind).map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </ActionForm>
          </div>
        )}
      </section>

      {/* --- Categories -------------------------------------------------- */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">Categories and subcategories</h2>
          <p className="text-sm text-muted-foreground">
            Deactivate rather than delete: historical tickets still reference these.
          </p>
        </div>

        <div className="space-y-3">
          {categories.map((category) => (
            <div key={category.id} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  {category.name}
                  {!category.isActive ? (
                    <span className="ml-2 text-xs text-destructive">inactive</span>
                  ) : null}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {category.subCategories.length} subcategor
                  {category.subCategories.length === 1 ? 'y' : 'ies'}
                </span>
              </div>

              <ul className="mt-2 flex flex-wrap gap-2">
                {category.subCategories.map((subCategory) => (
                  <li
                    key={subCategory.id}
                    className={`rounded-full border px-2 py-0.5 text-xs ${
                      subCategory.isActive ? ' text-foreground' : ' text-destructive'
                    }`}
                  >
                    {subCategory.name}
                  </li>
                ))}
              </ul>

              {readOnly ? null : (
                <div className="mt-4 grid gap-4 border-t pt-4 lg:grid-cols-2">
                  <ActionForm action={saveCategoryAction} submitLabel="Save category" compact>
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
                      <div className="sm:col-span-2">
                        <Flags isActive={category.isActive} />
                      </div>
                    </div>
                  </ActionForm>

                  <ActionForm
                    action={saveSubCategoryAction}
                    submitLabel="Add subcategory"
                    compact
                    successMessage="Added."
                  >
                    <input type="hidden" name="categoryId" value={category.id} />
                    <div>
                      <label className="label">New subcategory</label>
                      <input name="name" required className="input" placeholder="Docking station" />
                    </div>
                  </ActionForm>
                </div>
              )}
            </div>
          ))}
        </div>

        {readOnly ? null : (
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Add a category</h3>
            <ActionForm
              action={saveCategoryAction}
              submitLabel="Add category"
              compact
              successMessage="Added."
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="label">Name</label>
                  <input name="name" required className="input" placeholder="Facilities" />
                </div>
                <div>
                  <label className="label">Sort order</label>
                  <input name="sortOrder" type="number" defaultValue={0} className="input" />
                </div>
              </div>
            </ActionForm>
          </div>
        )}
      </section>
    </div>
  );
}
