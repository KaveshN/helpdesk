import { TicketEventType, TicketSource } from '@/generated/prisma/enums';
import { db } from '@/lib/db/client';
import { scopedDb, scopedTransaction } from '@/lib/db/scoped';
import { requireCapability } from '@/lib/authz/guard';
import type { Actor, GroupContext } from '@/lib/authz/actor';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { groupLogger } from '@/lib/logger';
import { graphConfigured } from '@/lib/graph/client';
import { replyToMessage, sendMail } from '@/lib/graph/mail';
import { REPLY_SEPARATOR } from '@/lib/email/parse';
import { resolveRequester } from '@/lib/tickets/requester';

/**
 * Replying to a requester from inside the application.
 *
 * Two steps on purpose: the reply is committed as a TicketComment plus a QUEUED
 * OutboundEmail in one transaction, and delivery happens afterwards. If Graph
 * is down the agent's words are not lost — the row stays QUEUED and the worker
 * retries. A send that happened inside the transaction would either block the
 * request on Exchange or send mail that a rollback then erases from the ticket.
 *
 * Mail always leaves as the shared mailbox, never as the agent, so the
 * requester's reply comes back to the help desk rather than a personal inbox.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Agent prose is plain text; wrap it for mail without letting HTML through. */
export function buildReplyHtml(input: {
  body: string;
  agentName: string;
  groupName: string;
  reference: string;
}): string {
  const paragraphs = escapeHtml(input.body)
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, '<br>')}</p>`)
    .join('');

  return (
    `${paragraphs}` +
    `<p style="margin-top:16px">${escapeHtml(input.agentName)}<br>` +
    `<span style="color:#666">${escapeHtml(input.groupName)}</span></p>` +
    `<hr style="border:none;border-top:1px solid #ddd;margin:16px 0">` +
    `<p style="color:#888;font-size:12px">${REPLY_SEPARATOR}<br>` +
    `Reference ${escapeHtml(input.reference)}</p>`
  );
}

export type QueueReplyInput = {
  ticketId: string;
  body: string;
  ccAddresses?: string[];
};

/** Record the reply and queue it for delivery. Returns the comment id. */
export async function queueReply(actor: Actor, group: GroupContext, input: QueueReplyInput) {
  requireCapability(actor, 'ticket:comment', group.helpDeskGroupId);
  const helpDeskGroupId = group.helpDeskGroupId;
  const scoped = scopedDb(helpDeskGroupId);

  const ticket = await scoped.ticket.findFirst({
    where: { id: input.ticketId },
    include: { requester: true, contact: true, group: true },
  });
  if (!ticket) throw new NotFoundError('Ticket not found');

  const mailbox = ticket.group.outboundEmailAddress ?? ticket.group.inboundEmailAddress;
  if (!mailbox) {
    throw new ConflictError(
      'This help desk has no mailbox configured, so replies cannot be emailed. An administrator can set one under Configuration.',
    );
  }

  const requester = resolveRequester(ticket);
  if (!requester.email) {
    throw new ConflictError('This ticket has no requester email address to reply to.');
  }

  // Reply in-thread when we know the message being answered, so the exchange
  // stays one conversation in the requester's client.
  const lastInbound = await scoped.inboundEmail.findFirst({
    where: { ticketId: ticket.id, graphMessageId: { not: null } },
    orderBy: { receivedAt: 'desc' },
    select: { graphMessageId: true },
  });

  const bodyHtml = buildReplyHtml({
    body: input.body,
    agentName: actor.name,
    groupName: group.groupName,
    reference: ticket.reference,
  });

  const result = await scopedTransaction(helpDeskGroupId, async (tx) => {
    const comment = await tx.ticketComment.create({
      data: {
        helpDeskGroupId,
        ticketId: ticket.id,
        authorId: actor.userId,
        body: input.body,
        isInternal: false,
        source: TicketSource.EMAIL,
      },
    });

    const outbound = await tx.outboundEmail.create({
      data: {
        helpDeskGroupId,
        ticketId: ticket.id,
        commentId: comment.id,
        fromAddress: mailbox,
        toAddresses: [requester.email],
        ccAddresses: input.ccAddresses ?? [],
        subject: `[${ticket.reference}] ${ticket.subject}`,
        bodyHtml,
        inReplyToGraphId: lastInbound?.graphMessageId ?? null,
        conversationId: ticket.emailThreadId,
        sentById: actor.userId,
      },
    });

    await tx.ticketEvent.create({
      data: {
        helpDeskGroupId,
        ticketId: ticket.id,
        actorId: actor.userId,
        type: TicketEventType.COMMENT_ADDED,
        metadata: { commentId: comment.id, outboundEmailId: outbound.id, channel: 'EMAIL' },
      },
    });

    // First public reply from someone other than the requester stops the
    // response clock.
    if (!ticket.firstRespondedAt && ticket.requesterId !== actor.userId) {
      await tx.ticket.update({
        where: { id: ticket.id, helpDeskGroupId },
        data: { firstRespondedAt: new Date() },
      });
    }

    return { commentId: comment.id, outboundEmailId: outbound.id };
  });

  // Best-effort immediate delivery; the worker picks up anything that fails.
  void flushOutbound(helpDeskGroupId).catch(() => undefined);

  return result;
}

/**
 * Deliver queued outbound mail for a group.
 *
 * Attempts are counted and capped so a permanently bad address does not get
 * retried forever on every tick.
 */
export async function flushOutbound(helpDeskGroupId: string, limit = 20) {
  const log = groupLogger(helpDeskGroupId);
  if (!graphConfigured()) return { sent: 0, failed: 0, skipped: 'graph not configured' as const };

  const pending = await db().outboundEmail.findMany({
    where: { helpDeskGroupId, status: 'QUEUED', attempts: { lt: 5 } },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  let sent = 0;
  let failed = 0;

  for (const email of pending) {
    try {
      if (email.inReplyToGraphId) {
        await replyToMessage({
          mailbox: email.fromAddress,
          messageId: email.inReplyToGraphId,
          bodyHtml: email.bodyHtml,
          ccAddresses: email.ccAddresses,
        });
      } else {
        await sendMail({
          mailbox: email.fromAddress,
          toAddresses: email.toAddresses,
          ccAddresses: email.ccAddresses,
          subject: email.subject,
          bodyHtml: email.bodyHtml,
        });
      }

      await db().outboundEmail.update({
        where: { id: email.id },
        data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 }, error: null },
      });
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = email.attempts + 1;
      await db().outboundEmail.update({
        where: { id: email.id },
        data: {
          // Give up after five attempts rather than retrying a bad address on
          // every tick forever.
          status: attempts >= 5 ? 'FAILED' : 'QUEUED',
          attempts,
          error: message.slice(0, 500),
        },
      });
      failed += 1;
      log.error({ err: error, outboundEmailId: email.id, attempts }, 'outbound email failed');
    }
  }

  if (sent || failed) log.info({ sent, failed }, 'outbound mail flushed');
  return { sent, failed };
}
