import { TicketEventType, TicketSource } from '@/generated/prisma/enums';
import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db/client';
import { scopedDb, scopedTransaction } from '@/lib/db/scoped';
import { groupLogger } from '@/lib/logger';
import { listMailboxDelta, markRead, sendMail } from '@/lib/graph/mail';
import { graphConfigured } from '@/lib/graph/client';
import { isChangeReference, parseMessage, shouldIgnore, REPLY_SEPARATOR } from '@/lib/email/parse';
import { claimTicketSequence, formatTicketReference } from '@/lib/tickets/reference';

/**
 * Email-to-ticket for one help desk mailbox.
 *
 * Threading precedence, most reliable first:
 *   1. a bracketed reference in the subject — survives forwarding
 *   2. Graph conversationId — survives subject edits
 *   3. otherwise a new ticket
 *
 * Deduplication is the InboundEmail.messageId unique index: if a poll is
 * retried, or two workers run at once, the second insert loses and the message
 * is skipped rather than raising a duplicate ticket.
 */

export type SyncResult = {
  fetched: number;
  created: number;
  appended: number;
  ignored: number;
  failed: number;
  error?: string;
};

/** Sender resolution: an Entra user if we know them, else an external Contact. */
async function resolveSender(
  tx: Prisma.TransactionClient,
  helpDeskGroupId: string,
  email: string,
  name: string | null,
): Promise<{ requesterId: string | null; contactId: string | null }> {
  const address = email.toLowerCase();

  // Staff who email in are matched to their existing account, so their ticket
  // history stays in one place rather than splitting into a shadow contact.
  const user = await tx.user.findUnique({ where: { email: address }, select: { id: true } });
  if (user) return { requesterId: user.id, contactId: null };

  const contact = await tx.contact.upsert({
    where: { helpDeskGroupId_email: { helpDeskGroupId, email: address } },
    create: { helpDeskGroupId, email: address, name },
    update: { lastSeenAt: new Date(), ...(name ? { name } : {}) },
    select: { id: true },
  });
  return { requesterId: null, contactId: contact.id };
}

async function groupDefaults(helpDeskGroupId: string) {
  const scoped = scopedDb(helpDeskGroupId);
  const [status, type, priority] = await Promise.all([
    scoped.ticketStatus.findFirst({
      where: { isActive: true },
      orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }],
    }),
    scoped.ticketType.findFirst({
      where: { isActive: true },
      orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }],
    }),
    scoped.priority.findFirst({
      where: { isActive: true },
      orderBy: [{ isDefault: 'desc' }, { level: 'asc' }],
    }),
  ]);
  return { status, type, priority };
}

/**
 * Poll one group's mailbox and turn new mail into tickets and comments.
 *
 * Safe to call repeatedly; safe to call when Graph is not configured (returns
 * a no-op result rather than throwing, so a scheduler does not spam errors on
 * an unconfigured deployment).
 */
export async function syncMailbox(helpDeskGroupId: string): Promise<SyncResult> {
  const empty: SyncResult = { fetched: 0, created: 0, appended: 0, ignored: 0, failed: 0 };
  const log = groupLogger(helpDeskGroupId);

  const group = await db().helpDeskGroup.findUnique({ where: { id: helpDeskGroupId } });
  if (!group?.inboundEmailAddress || !group.mailboxSyncEnabled) return empty;
  if (!graphConfigured()) {
    return { ...empty, error: 'Microsoft Graph is not configured' };
  }

  const mailbox = group.inboundEmailAddress;
  const result: SyncResult = { ...empty };

  let page;
  try {
    page = await listMailboxDelta({
      mailbox,
      deltaLink: group.mailboxDeltaLink,
      since: group.mailboxDeltaLink ? null : (group.mailboxSyncFrom ?? null),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db().helpDeskGroup.update({
      where: { id: helpDeskGroupId },
      data: { mailboxLastError: message.slice(0, 500), mailboxLastSyncedAt: new Date() },
    });
    log.error({ err: error, mailbox }, 'mailbox sync failed');
    return { ...empty, failed: 1, error: message };
  }

  result.fetched = page.messages.length;

  for (const message of page.messages) {
    const parsed = parseMessage(message, mailbox);

    const ignore = shouldIgnore({
      fromEmail: parsed.fromEmail,
      subject: parsed.subject,
      mailbox,
    });
    if (ignore.ignore) {
      result.ignored += 1;
      await db()
        .inboundEmail.create({
          data: {
            helpDeskGroupId,
            messageId: parsed.internetMessageId ?? `graph:${message.id}`,
            graphMessageId: message.id,
            conversationId: parsed.conversationId,
            fromEmail: parsed.fromEmail || 'unknown',
            fromName: parsed.fromName,
            toEmail: parsed.toEmail,
            subject: parsed.subject,
            bodyText: parsed.rawText.slice(0, 20_000),
            hasAttachments: parsed.hasAttachments,
            receivedAt: parsed.receivedAt,
            status: 'IGNORED',
            error: ignore.reason,
            processedAt: new Date(),
          },
        })
        // Duplicate messageId simply means we already saw it.
        .catch(() => undefined);
      continue;
    }

    try {
      const outcome = await ingestOne({
        helpDeskGroupId,
        groupKey: group.key,
        mailbox,
        parsed,
        graphId: message.id,
      });
      if (outcome === 'created') result.created += 1;
      else if (outcome === 'appended') result.appended += 1;
      else result.ignored += 1;
    } catch (error) {
      result.failed += 1;
      log.error({ err: error, messageId: parsed.internetMessageId }, 'failed to ingest message');
    }

    // Marking read is best-effort: the delta token is what prevents re-reading,
    // so a failure here costs nothing.
    await markRead(mailbox, message.id).catch(() => undefined);
  }

  await db().helpDeskGroup.update({
    where: { id: helpDeskGroupId },
    data: {
      mailboxDeltaLink: page.deltaLink ?? group.mailboxDeltaLink,
      mailboxLastSyncedAt: new Date(),
      mailboxLastError: null,
    },
  });

  log.info({ mailbox, ...result }, 'mailbox sync complete');
  return result;
}

async function ingestOne(input: {
  helpDeskGroupId: string;
  groupKey: string;
  mailbox: string;
  parsed: ReturnType<typeof parseMessage>;
  graphId: string;
}): Promise<'created' | 'appended' | 'skipped'> {
  const { helpDeskGroupId, parsed } = input;
  const scoped = scopedDb(helpDeskGroupId);

  // 1. Explicit reference in the subject.
  let ticket =
    parsed.ticketReference && !isChangeReference(parsed.ticketReference)
      ? await scoped.ticket.findFirst({ where: { reference: parsed.ticketReference } })
      : null;

  // 2. Same Graph conversation as a ticket we already raised.
  if (!ticket && parsed.conversationId) {
    ticket = await scoped.ticket.findFirst({
      where: { emailThreadId: parsed.conversationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  return scopedTransaction(helpDeskGroupId, async (tx) => {
    const sender = await resolveSender(tx, helpDeskGroupId, parsed.fromEmail, parsed.fromName);

    const inbound = await tx.inboundEmail.create({
      data: {
        helpDeskGroupId,
        messageId: parsed.internetMessageId ?? `graph:${input.graphId}`,
        graphMessageId: input.graphId,
        conversationId: parsed.conversationId,
        fromEmail: parsed.fromEmail,
        fromName: parsed.fromName,
        toEmail: parsed.toEmail,
        subject: parsed.subject,
        bodyText: parsed.rawText.slice(0, 20_000),
        hasAttachments: parsed.hasAttachments,
        receivedAt: parsed.receivedAt,
        status: 'PENDING',
      },
    });

    if (ticket) {
      // A reply becomes a public comment. Authorship: the comment author must
      // be a User, so an external contact's reply is attributed to the original
      // requester when they are staff, and otherwise recorded without an author
      // via the ticket event trail.
      const authorId = sender.requesterId ?? ticket.requesterId ?? ticket.createdById;

      const comment = await tx.ticketComment.create({
        data: {
          helpDeskGroupId,
          ticketId: ticket.id,
          authorId,
          body: parsed.body.slice(0, 20_000),
          isInternal: false,
          source: TicketSource.EMAIL,
          emailMessageId: parsed.internetMessageId,
        },
      });

      await tx.ticketEvent.create({
        data: {
          helpDeskGroupId,
          ticketId: ticket.id,
          actorId: sender.requesterId,
          type: TicketEventType.COMMENT_ADDED,
          metadata: {
            commentId: comment.id,
            source: 'EMAIL',
            fromEmail: parsed.fromEmail,
            inboundEmailId: inbound.id,
          },
        },
      });

      await tx.inboundEmail.update({
        where: { id: inbound.id },
        data: { status: 'PROCESSED', ticketId: ticket.id, processedAt: new Date() },
      });

      return 'appended';
    }

    const defaults = await groupDefaults(helpDeskGroupId);
    if (!defaults.status || !defaults.type || !defaults.priority) {
      await tx.inboundEmail.update({
        where: { id: inbound.id },
        data: {
          status: 'FAILED',
          error: 'Help desk has no default status, type or priority configured',
          processedAt: new Date(),
        },
      });
      return 'skipped';
    }

    const sequence = await claimTicketSequence(tx, helpDeskGroupId);
    const created = await tx.ticket.create({
      data: {
        helpDeskGroupId,
        reference: formatTicketReference(input.groupKey, sequence),
        sequence,
        subject: parsed.cleanSubject.slice(0, 300),
        description: parsed.body.slice(0, 20_000),
        typeId: defaults.type.id,
        priorityId: defaults.priority.id,
        statusId: defaults.status.id,
        requesterId: sender.requesterId,
        contactId: sender.contactId,
        requesterKind: sender.requesterId ? 'USER' : 'CONTACT',
        // createdById records which identity the system acted as; for inbound
        // mail that is the requester when they are staff, otherwise nobody.
        createdById: sender.requesterId ?? (await systemUserId(tx, helpDeskGroupId)),
        source: TicketSource.EMAIL,
        emailMessageId: parsed.internetMessageId,
        emailThreadId: parsed.conversationId,
        events: { create: { helpDeskGroupId, type: TicketEventType.CREATED } },
      },
    });

    await tx.inboundEmail.update({
      where: { id: inbound.id },
      data: { status: 'PROCESSED', ticketId: created.id, processedAt: new Date() },
    });

    return 'created';
  });
}

/**
 * `Ticket.createdById` is NOT NULL, so a ticket raised by an external contact
 * still needs an owning identity. The group's longest-standing administrator
 * stands in — visible and explicable, rather than inventing a synthetic user.
 */
async function systemUserId(
  tx: Prisma.TransactionClient,
  helpDeskGroupId: string,
): Promise<string> {
  const admin = await tx.helpDeskMembership.findFirst({
    where: { helpDeskGroupId, role: 'HD_ADMIN', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { userId: true },
  });
  if (admin) return admin.userId;

  const anyMember = await tx.helpDeskMembership.findFirst({
    where: { helpDeskGroupId, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { userId: true },
  });
  if (anyMember) return anyMember.userId;

  throw new Error(`Help desk ${helpDeskGroupId} has no members to attribute an inbound ticket to`);
}

/** Acknowledge a newly raised ticket to its requester. */
export async function sendAcknowledgement(input: {
  helpDeskGroupId: string;
  ticketId: string;
}): Promise<boolean> {
  const scoped = scopedDb(input.helpDeskGroupId);
  const ticket = await scoped.ticket.findFirst({
    where: { id: input.ticketId },
    include: { requester: true, contact: true, group: true },
  });
  if (!ticket?.group.inboundEmailAddress) return false;

  const template = await scoped.notificationTemplate.findFirst({
    where: { event: 'EMAIL_ACKNOWLEDGEMENT', channel: 'EMAIL', isActive: true },
  });
  if (!template) return false;

  const to = ticket.requester?.email ?? ticket.contact?.email;
  if (!to) return false;

  const subject = `[${ticket.reference}] ${ticket.subject}`;
  const body =
    `<p>${template.bodyTemplate.replace(/\n/g, '<br>')}</p>` +
    `<hr><p style="color:#888;font-size:12px">${REPLY_SEPARATOR}</p>`;

  await sendMail({
    mailbox: ticket.group.inboundEmailAddress,
    toAddresses: [to],
    subject,
    bodyHtml: body,
  });
  return true;
}
