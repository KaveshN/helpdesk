/**
 * Pure email parsing. No Graph, no database — this is the logic that decides
 * whether a message becomes a new ticket or a reply on an existing one, and
 * getting it wrong is how a help desk ends up with forty duplicate tickets for
 * one conversation.
 */

/** `Re:`, `Fw:`, `FWD:`, `AW:` (German), `RE :` and stacked combinations. */
const PREFIX = /^\s*((re|fw|fwd|aw|antw|sv|vs|tr|rif)\s*(\[\d+\])?\s*:\s*)+/i;

export function normaliseSubject(subject: string | null | undefined): string {
  if (!subject) return '';
  return subject.replace(PREFIX, '').trim();
}

/**
 * Find a reference in a subject line, e.g. "[ITHD-000123]" or "[ITHD-C-000042]".
 *
 * Anchored to the bracketed form the outbound templates use. A bare
 * `ITHD-000123` anywhere in a subject would match a requester quoting a
 * reference from a different help desk, so brackets are required.
 *
 * The optional `C-` segment matters: change references share the group prefix,
 * and without it a reply about a change silently fails to thread.
 */
export function findTicketReference(subject: string | null | undefined): string | null {
  if (!subject) return null;
  const match = /\[([A-Z0-9]{2,10}-(?:C-)?\d{4,10})\]/i.exec(subject);
  return match ? match[1]!.toUpperCase() : null;
}

/** Is this reference a change request rather than a ticket? */
export function isChangeReference(reference: string): boolean {
  return /^[A-Z0-9]{2,10}-C-\d+$/i.test(reference);
}

/** Strip HTML to readable text: used for previews and the plain-text body. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  return (
    html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      // Paragraphs and headings read as separate blocks; divs are line wrappers
      // in Outlook HTML, so they only get a single break.
      .replace(/<\/(p|h[1-6])>/gi, '\n\n')
      .replace(/<\/(div|tr|li)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .trim()
  );
}

/**
 * Markers that begin quoted history in a reply.
 *
 * Everything from the first match onwards is the previous conversation, which
 * the ticket already holds. Without this, every reply re-posts the whole thread
 * and a ticket becomes unreadable after three exchanges.
 */
const QUOTE_MARKERS: RegExp[] = [
  /^-{2,}\s*original message\s*-{2,}/im,
  /^_{5,}$/m,
  /^-{5,}$/m,
  /^\s*on .{5,80}\s+wrote:\s*$/im,
  /^\s*from:\s.+$/im,
  /^\s*sent from my \w+/im,
  /^\s*>{1,}\s?/m,
  // The marker our own outbound templates plant.
  /^\s*--- please reply above this line ---\s*$/im,
];

export const REPLY_SEPARATOR = '--- Please reply above this line ---';

/**
 * Remove quoted history from a reply body.
 *
 * Conservative on purpose: if stripping would leave nothing, the original is
 * returned instead. A ticket with too much text is a nuisance; a ticket with an
 * empty body has lost the customer's message.
 */
export function stripQuotedReply(text: string): string {
  if (!text.trim()) return text;

  let cutAt = text.length;
  for (const marker of QUOTE_MARKERS) {
    const match = marker.exec(text);
    if (match && match.index < cutAt) cutAt = match.index;
  }

  const stripped = text.slice(0, cutAt).trim();
  return stripped.length === 0 ? text.trim() : stripped;
}

export type ParsedEmail = {
  fromEmail: string;
  fromName: string | null;
  toEmail: string;
  subject: string;
  /** Subject with Re:/Fwd: removed — used as the ticket subject. */
  cleanSubject: string;
  /** Quoted history removed — used as the ticket body or comment. */
  body: string;
  /** Full text including quoted history, kept on InboundEmail for audit. */
  rawText: string;
  ticketReference: string | null;
  conversationId: string | null;
  internetMessageId: string | null;
  receivedAt: Date;
  hasAttachments: boolean;
};

type MessageLike = {
  id: string;
  conversationId?: string | null;
  internetMessageId?: string | null;
  subject?: string | null;
  receivedDateTime: string;
  hasAttachments?: boolean;
  from?: { emailAddress?: { name?: string | null; address: string } | null } | null;
  sender?: { emailAddress?: { name?: string | null; address: string } | null } | null;
  toRecipients?: Array<{ emailAddress?: { name?: string | null; address: string } | null }> | null;
  body?: { contentType?: string | null; content?: string | null } | null;
  bodyPreview?: string | null;
};

export function parseMessage(message: MessageLike, mailbox: string): ParsedEmail {
  const fromAddress = message.from?.emailAddress ?? message.sender?.emailAddress ?? null;
  const isHtml = (message.body?.contentType ?? '').toLowerCase() === 'html';
  const rawText = isHtml
    ? htmlToText(message.body?.content)
    : (message.body?.content ?? message.bodyPreview ?? '').trim();

  const subject = message.subject ?? '';

  return {
    fromEmail: (fromAddress?.address ?? '').toLowerCase(),
    fromName: fromAddress?.name?.trim() || null,
    toEmail: (message.toRecipients?.[0]?.emailAddress?.address ?? mailbox).toLowerCase(),
    subject,
    cleanSubject: normaliseSubject(subject) || '(no subject)',
    body: stripQuotedReply(rawText),
    rawText,
    ticketReference: findTicketReference(subject),
    conversationId: message.conversationId ?? null,
    internetMessageId: message.internetMessageId ?? null,
    receivedAt: new Date(message.receivedDateTime),
    hasAttachments: Boolean(message.hasAttachments),
  };
}

/**
 * Should this message be ignored entirely?
 *
 * Auto-replies and delivery reports must never raise a ticket: an
 * out-of-office answering our acknowledgement, which acknowledges the
 * out-of-office, is a mail loop that fills a queue in minutes.
 */
export function shouldIgnore(input: {
  fromEmail: string;
  subject: string;
  mailbox: string;
  headers?: Record<string, string>;
}): { ignore: boolean; reason?: string } {
  const from = input.fromEmail.toLowerCase();
  const subject = input.subject.toLowerCase();

  if (!from) return { ignore: true, reason: 'no sender address' };

  // Mail from the mailbox to itself is our own outbound copy.
  if (from === input.mailbox.toLowerCase()) {
    return { ignore: true, reason: 'message from the mailbox itself' };
  }

  if (/^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce)/i.test(from)) {
    return { ignore: true, reason: 'no-reply or bounce sender' };
  }

  if (
    /^(automatic reply|out of office|undeliverable|delivery status notification|mail delivery)/i.test(
      subject,
    )
  ) {
    return { ignore: true, reason: 'auto-reply or delivery report' };
  }

  const autoSubmitted = input.headers?.['auto-submitted'];
  if (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') {
    return { ignore: true, reason: `auto-submitted: ${autoSubmitted}` };
  }
  if (input.headers?.['x-auto-response-suppress']) {
    return { ignore: true, reason: 'x-auto-response-suppress present' };
  }

  return { ignore: false };
}
