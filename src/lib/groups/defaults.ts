import {
  NotificationChannel,
  NotificationEvent,
  StatusCategory,
  TicketTypeKind,
} from '@/generated/prisma/enums';

/**
 * The starting configuration every new help desk group gets.
 *
 * A group with no statuses, priorities or types cannot accept a single ticket,
 * so provisioning these is part of creating the group rather than a separate
 * chore. Everything here is ordinary data that an HD Admin can rename, reorder
 * or deactivate afterwards -- brief §8 (self-service administration) means no
 * code change is ever needed to alter this list for one group.
 */

export const DEFAULT_STATUSES = [
  {
    name: 'New',
    category: StatusCategory.NEW,
    sortOrder: 10,
    isDefault: true,
    pausesSla: false,
    colour: '#2563eb',
  },
  {
    name: 'Open',
    category: StatusCategory.OPEN,
    sortOrder: 20,
    isDefault: false,
    pausesSla: false,
    colour: '#0891b2',
  },
  {
    name: 'Awaiting Requester',
    category: StatusCategory.PENDING,
    sortOrder: 30,
    isDefault: false,
    pausesSla: true,
    colour: '#d97706',
  },
  {
    name: 'On Hold',
    category: StatusCategory.ON_HOLD,
    sortOrder: 40,
    isDefault: false,
    pausesSla: true,
    colour: '#7c3aed',
  },
  {
    name: 'Resolved',
    category: StatusCategory.RESOLVED,
    sortOrder: 50,
    isDefault: false,
    pausesSla: false,
    colour: '#16a34a',
  },
  {
    name: 'Closed',
    category: StatusCategory.CLOSED,
    sortOrder: 60,
    isDefault: false,
    pausesSla: false,
    colour: '#475569',
  },
  {
    name: 'Cancelled',
    category: StatusCategory.CANCELLED,
    sortOrder: 70,
    isDefault: false,
    pausesSla: false,
    colour: '#dc2626',
  },
] as const;

export const DEFAULT_PRIORITIES = [
  { name: 'P1 - Critical', level: 1, colour: '#dc2626', isDefault: false },
  { name: 'P2 - High', level: 2, colour: '#ea580c', isDefault: false },
  { name: 'P3 - Medium', level: 3, colour: '#ca8a04', isDefault: true },
  { name: 'P4 - Low', level: 4, colour: '#65a30d', isDefault: false },
] as const;

export const DEFAULT_TICKET_TYPES = [
  { name: 'Incident', kind: TicketTypeKind.INCIDENT, sortOrder: 10, isDefault: true },
  {
    name: 'Service Request',
    kind: TicketTypeKind.SERVICE_REQUEST,
    sortOrder: 20,
    isDefault: false,
  },
  { name: 'Query', kind: TicketTypeKind.QUERY, sortOrder: 30, isDefault: false },
  { name: 'Problem', kind: TicketTypeKind.PROBLEM, sortOrder: 40, isDefault: false },
  // Deliberately no "Change" type: change management is its own module with its
  // own taxonomy, lifecycle and numbering (see src/lib/changes/).
] as const;

/** Response / resolution minutes per priority level for the default SLA. */
export const DEFAULT_SLA_TARGETS: Record<
  number,
  { responseMinutes: number; resolutionMinutes: number }
> = {
  1: { responseMinutes: 15, resolutionMinutes: 240 },
  2: { responseMinutes: 30, resolutionMinutes: 480 },
  3: { responseMinutes: 60, resolutionMinutes: 1440 },
  4: { responseMinutes: 240, resolutionMinutes: 2880 },
};

/** Monday-Friday, 08:00-17:00 in the calendar's own time zone. */
export const DEFAULT_WORKING_HOURS = [
  { dayOfWeek: 0, isWorkingDay: false, startMinute: 0, endMinute: 0 },
  { dayOfWeek: 1, isWorkingDay: true, startMinute: 8 * 60, endMinute: 17 * 60 },
  { dayOfWeek: 2, isWorkingDay: true, startMinute: 8 * 60, endMinute: 17 * 60 },
  { dayOfWeek: 3, isWorkingDay: true, startMinute: 8 * 60, endMinute: 17 * 60 },
  { dayOfWeek: 4, isWorkingDay: true, startMinute: 8 * 60, endMinute: 17 * 60 },
  { dayOfWeek: 5, isWorkingDay: true, startMinute: 8 * 60, endMinute: 17 * 60 },
  { dayOfWeek: 6, isWorkingDay: false, startMinute: 0, endMinute: 0 },
] as const;

/**
 * Notification templates. `{{placeholder}}` tokens are substituted by the
 * Phase 2 renderer; the token vocabulary lives with that renderer, not here.
 */
export const DEFAULT_NOTIFICATION_TEMPLATES = [
  {
    event: NotificationEvent.TICKET_CREATED,
    channel: NotificationChannel.EMAIL,
    subject: '[{{ticket.reference}}] We have logged your request: {{ticket.subject}}',
    bodyTemplate:
      'Hello {{requester.name}},\n\n' +
      'Your request has been logged with {{group.name}} as {{ticket.reference}}.\n\n' +
      'Subject: {{ticket.subject}}\nPriority: {{ticket.priority}}\n\n' +
      'We will be in touch as it progresses.\n\n{{group.name}}',
  },
  {
    event: NotificationEvent.TICKET_ASSIGNED,
    channel: NotificationChannel.EMAIL,
    subject: '[{{ticket.reference}}] Assigned to you',
    bodyTemplate:
      'Hello {{assignee.name}},\n\n' +
      '{{ticket.reference}} ({{ticket.priority}}) has been assigned to you.\n\n' +
      'Subject: {{ticket.subject}}\nRequester: {{requester.name}}\n\n{{ticket.url}}',
  },
  {
    event: NotificationEvent.TICKET_STATUS_CHANGED,
    channel: NotificationChannel.EMAIL,
    subject: '[{{ticket.reference}}] Status changed to {{ticket.status}}',
    bodyTemplate:
      'Hello {{requester.name}},\n\n' +
      '{{ticket.reference}} is now {{ticket.status}}.\n\n{{ticket.url}}',
  },
  {
    event: NotificationEvent.TICKET_RESOLVED,
    channel: NotificationChannel.EMAIL,
    subject: '[{{ticket.reference}}] Resolved',
    bodyTemplate:
      'Hello {{requester.name}},\n\n' +
      'We have marked {{ticket.reference}} as resolved.\n\n' +
      'If the problem persists, reply to this email and the ticket will reopen.\n\n{{group.name}}',
  },
  {
    event: NotificationEvent.SLA_RESPONSE_WARNING,
    channel: NotificationChannel.EMAIL,
    subject: '[{{ticket.reference}}] Response SLA at risk',
    bodyTemplate:
      '{{ticket.reference}} ({{ticket.priority}}) is approaching its response target.\n\n' +
      'Due: {{ticket.firstResponseDueAt}}\nAssignee: {{assignee.name}}\n\n{{ticket.url}}',
  },
  {
    event: NotificationEvent.SLA_RESOLUTION_BREACH,
    channel: NotificationChannel.EMAIL,
    subject: '[{{ticket.reference}}] Resolution SLA breached',
    bodyTemplate:
      '{{ticket.reference}} ({{ticket.priority}}) has breached its resolution target.\n\n' +
      'Due: {{ticket.resolutionDueAt}}\nAssignee: {{assignee.name}}\n\n{{ticket.url}}',
  },
] as const;

/** Categories are business-specific; these are a usable starting point only. */
export const STARTER_CATEGORIES = [
  { name: 'Hardware', subCategories: ['Laptop', 'Desktop', 'Printer', 'Mobile device'] },
  { name: 'Software', subCategories: ['Microsoft 365', 'Line of business app', 'Licensing'] },
  { name: 'Network & Connectivity', subCategories: ['VPN', 'Wi-Fi', 'Internet', 'Site link'] },
  {
    name: 'Access & Accounts',
    subCategories: ['Password reset', 'New starter', 'Leaver', 'Permissions'],
  },
  { name: 'Email', subCategories: ['Mailbox', 'Distribution list', 'Spam'] },
] as const;
