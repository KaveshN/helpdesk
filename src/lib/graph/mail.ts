import { graphFetch } from '@/lib/graph/client';

/**
 * Exchange Online mail access for a help desk's shared mailbox.
 *
 * Every call is app-only and addresses the mailbox explicitly by UPN, so the
 * Exchange application access policy can restrict this app to the help desk
 * mailboxes and nothing else.
 */

export type GraphMailAddress = { name?: string | null; address: string };

export type GraphMessage = {
  id: string;
  conversationId?: string | null;
  internetMessageId?: string | null;
  subject?: string | null;
  receivedDateTime: string;
  hasAttachments?: boolean;
  isRead?: boolean;
  from?: { emailAddress?: GraphMailAddress | null } | null;
  sender?: { emailAddress?: GraphMailAddress | null } | null;
  toRecipients?: Array<{ emailAddress?: GraphMailAddress | null }> | null;
  ccRecipients?: Array<{ emailAddress?: GraphMailAddress | null }> | null;
  body?: { contentType?: string | null; content?: string | null } | null;
  bodyPreview?: string | null;
  /** Present on delta results for a deleted message. */
  '@removed'?: unknown;
};

const MESSAGE_SELECT =
  'id,conversationId,internetMessageId,subject,receivedDateTime,hasAttachments,isRead,' +
  'from,sender,toRecipients,ccRecipients,body,bodyPreview';

export type MailboxPage = {
  messages: GraphMessage[];
  /** Persist this and pass it next time: Graph then returns only what changed. */
  deltaLink: string | null;
  nextLink: string | null;
};

/**
 * Read new mail from the mailbox inbox.
 *
 * Uses Graph's delta query so each poll asks only for messages that arrived or
 * changed since the last one — polling `receivedDateTime > x` re-reads and
 * re-pages the same mail every tick and is what gets an app throttled.
 */
export async function listMailboxDelta(input: {
  mailbox: string;
  deltaLink?: string | null;
  since?: Date | null;
  pageSize?: number;
}): Promise<MailboxPage> {
  const path = input.deltaLink
    ? input.deltaLink
    : `/users/${encodeURIComponent(input.mailbox)}/mailFolders/inbox/messages/delta` +
      `?$select=${MESSAGE_SELECT}&$top=${input.pageSize ?? 25}` +
      (input.since
        ? `&$filter=${encodeURIComponent(`receivedDateTime ge ${input.since.toISOString()}`)}`
        : '');

  const result = await graphFetch<{
    value: GraphMessage[];
    '@odata.deltaLink'?: string;
    '@odata.nextLink'?: string;
  }>({ path });

  return {
    // Deletions arrive as tombstones with no usable content.
    messages: (result.value ?? []).filter((message) => !message['@removed']),
    deltaLink: result['@odata.deltaLink'] ?? null,
    nextLink: result['@odata.nextLink'] ?? null,
  };
}

export async function getMessage(mailbox: string, messageId: string): Promise<GraphMessage> {
  return graphFetch<GraphMessage>({
    path: `/users/${encodeURIComponent(mailbox)}/messages/${messageId}?$select=${MESSAGE_SELECT}`,
  });
}

export type GraphAttachment = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
  contentBytes?: string;
};

export async function listAttachments(
  mailbox: string,
  messageId: string,
): Promise<GraphAttachment[]> {
  const result = await graphFetch<{ value: GraphAttachment[] }>({
    path:
      `/users/${encodeURIComponent(mailbox)}/messages/${messageId}/attachments` +
      `?$select=id,name,contentType,size,isInline`,
  });
  return result.value ?? [];
}

export async function markRead(mailbox: string, messageId: string): Promise<void> {
  await graphFetch({
    method: 'PATCH',
    path: `/users/${encodeURIComponent(mailbox)}/messages/${messageId}`,
    body: { isRead: true },
    expectNoContent: true,
  });
}

/**
 * Reply in-thread as the mailbox.
 *
 * `/reply` is used rather than composing a fresh message because Exchange then
 * sets In-Reply-To and References itself, which is what keeps the exchange as
 * one conversation in the requester's client instead of a pile of unrelated
 * emails.
 */
export async function replyToMessage(input: {
  mailbox: string;
  messageId: string;
  bodyHtml: string;
  ccAddresses?: string[];
}): Promise<void> {
  await graphFetch({
    method: 'POST',
    path: `/users/${encodeURIComponent(input.mailbox)}/messages/${input.messageId}/reply`,
    body: {
      message: {
        ...(input.ccAddresses?.length
          ? {
              ccRecipients: input.ccAddresses.map((address) => ({
                emailAddress: { address },
              })),
            }
          : {}),
      },
      comment: input.bodyHtml,
    },
    expectNoContent: true,
  });
}

/** Send a new message as the mailbox — acknowledgements and notifications. */
export async function sendMail(input: {
  mailbox: string;
  toAddresses: string[];
  ccAddresses?: string[];
  subject: string;
  bodyHtml: string;
  /** Saves to Sent Items so the mailbox keeps a complete record. */
  saveToSentItems?: boolean;
}): Promise<void> {
  await graphFetch({
    method: 'POST',
    path: `/users/${encodeURIComponent(input.mailbox)}/sendMail`,
    body: {
      message: {
        subject: input.subject,
        body: { contentType: 'HTML', content: input.bodyHtml },
        toRecipients: input.toAddresses.map((address) => ({ emailAddress: { address } })),
        ...(input.ccAddresses?.length
          ? { ccRecipients: input.ccAddresses.map((address) => ({ emailAddress: { address } })) }
          : {}),
      },
      saveToSentItems: input.saveToSentItems ?? true,
    },
    expectNoContent: true,
  });
}

/** Confirm the mailbox exists and the app can read it — used by the admin UI. */
export async function probeMailbox(
  mailbox: string,
): Promise<{ displayName: string; mail: string }> {
  const result = await graphFetch<{
    displayName?: string;
    mail?: string;
    userPrincipalName?: string;
  }>({ path: `/users/${encodeURIComponent(mailbox)}?$select=displayName,mail,userPrincipalName` });
  return {
    displayName: result.displayName ?? mailbox,
    mail: result.mail ?? result.userPrincipalName ?? mailbox,
  };
}
