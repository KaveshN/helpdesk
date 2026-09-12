import { describe, expect, it } from 'vitest';
import { crumbsForPath } from '@/components/shell/breadcrumbs';

const id = '01a08c63-4444-7368-93ff-4588db1ca983';

describe('crumbsForPath', () => {
  it.each([
    ['/', ['Dashboard']],
    ['/dashboard', ['Dashboard']],
    ['/tickets', ['Tickets']],
    ['/tickets/new', ['Tickets', 'New ticket']],
    [`/tickets/${id}`, ['Tickets', 'Ticket']],
    ['/changes', ['Changes']],
    ['/changes/new', ['Changes', 'Raise a change']],
    [`/changes/${id}`, ['Changes', 'Change']],
    ['/reports', ['Reports']],
    ['/reports/overview', ['Reports', 'All help desks']],
    ['/admin/configuration', ['Administration', 'Configuration']],
    ['/admin/change-config', ['Administration', 'CAB & risk']],
    ['/admin/audit', ['Administration', 'Audit trail']],
    ['/admin/groups', ['Administration', 'Help desks']],
    [`/admin/groups/${id}`, ['Administration', 'Help desks', 'Help desk']],
  ])('%s -> %j', (pathname, labels) => {
    expect(crumbsForPath(pathname).map((crumb) => crumb.label)).toEqual(labels);
  });

  it('links every crumb except the last, and only where a page exists', () => {
    const crumbs = crumbsForPath(`/admin/groups/${id}`);
    expect(crumbs.map((crumb) => crumb.href)).toEqual([undefined, '/admin/groups', undefined]);
    expect(crumbsForPath('/tickets/new')[0]?.href).toBe('/tickets');
    expect(crumbsForPath('/tickets').at(-1)?.href).toBeUndefined();
  });

  it('falls back to raw segments for an unknown path', () => {
    expect(crumbsForPath('/something/else').map((crumb) => crumb.label)).toEqual([
      'something',
      'else',
    ]);
  });
});
