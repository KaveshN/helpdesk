'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Mail, MessageSquareLock } from 'lucide-react';
import { addCommentAction } from '@/server/actions/tickets';
import { replyByEmailAction } from '@/server/actions/email';
import { toast } from 'sonner';
import { FieldError, FormMessage } from '@/components/ui/form-message';
import { TONE_CALLOUT } from '@/lib/design/tones';
import { cn } from '@/lib/utils';

/**
 * Two genuinely different actions behind one composer.
 *
 * "Email the requester" leaves the building as the shared mailbox; "internal
 * note" never does. Conflating them is how a note meant for colleagues ends up
 * in a customer's inbox, so they are separate tabs with different submit
 * buttons rather than a checkbox on one form.
 */
export function TicketReplyBox({
  ticketId,
  canReplyByEmail,
  canAddInternal,
  requesterEmail,
  mailboxConfigured,
}: {
  ticketId: string;
  canReplyByEmail: boolean;
  canAddInternal: boolean;
  requesterEmail: string | null;
  mailboxConfigured: boolean;
}) {
  const [mode, setMode] = useState<'email' | 'internal'>(
    canReplyByEmail && mailboxConfigured ? 'email' : 'internal',
  );

  const [emailState, emailAction, emailPending] = useActionState(replyByEmailAction, undefined);
  const [noteState, noteAction, notePending] = useActionState(addCommentAction, undefined);
  const emailForm = useRef<HTMLFormElement>(null);
  const noteForm = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (emailState?.ok) {
      emailForm.current?.reset();
      toast.success('Reply recorded and queued for delivery from the help desk mailbox');
    }
  }, [emailState]);
  useEffect(() => {
    if (noteState?.ok) {
      noteForm.current?.reset();
      toast.success('Internal note added');
    }
  }, [noteState]);

  const tabs = [
    ...(canReplyByEmail
      ? [{ id: 'email' as const, label: 'Email the requester', icon: Mail }]
      : []),
    ...(canAddInternal
      ? [{ id: 'internal' as const, label: 'Internal note', icon: MessageSquareLock }]
      : []),
  ];

  return (
    <div className="space-y-3">
      {tabs.length > 1 ? (
        <div className="flex gap-1">
          {tabs.map((tab) => {
            const active = mode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setMode(tab.id)}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                <tab.icon className="size-4" aria-hidden />
                {tab.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {mode === 'email' && canReplyByEmail ? (
        <form ref={emailForm} action={emailAction} className="space-y-3">
          <input type="hidden" name="ticketId" value={ticketId} />
          <FormMessage result={emailState} />

          {!mailboxConfigured ? (
            <p className={cn('rounded-lg border px-3 py-2 text-xs', TONE_CALLOUT.warning)}>
              This help desk has no Exchange Online mailbox configured, so the reply will be
              recorded on the ticket but cannot be delivered.
            </p>
          ) : null}

          <div>
            <label className="label" htmlFor="reply-body">
              Reply{' '}
              {requesterEmail ? (
                <span className="font-normal text-muted-foreground">to {requesterEmail}</span>
              ) : null}
            </label>
            <textarea
              id="reply-body"
              name="body"
              rows={5}
              required
              className="textarea"
              placeholder="This goes to the requester by email."
            />
            <FieldError result={emailState} field="body" />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1">
              <label className="label" htmlFor="reply-cc">
                CC <span className="font-normal text-faint">optional, comma separated</span>
              </label>
              <input
                id="reply-cc"
                name="cc"
                className="input"
                placeholder="colleague@example.com"
              />
              <FieldError result={emailState} field="cc" />
            </div>
            <button type="submit" className="btn-primary" disabled={emailPending}>
              <Mail className="size-4" aria-hidden />
              {emailPending ? 'Sending…' : 'Send reply'}
            </button>
          </div>
        </form>
      ) : null}

      {mode === 'internal' && canAddInternal ? (
        <form ref={noteForm} action={noteAction} className="space-y-3">
          <input type="hidden" name="ticketId" value={ticketId} />
          <input type="hidden" name="isInternal" value="true" />
          <FormMessage result={noteState} />

          <div>
            <label className="label" htmlFor="note-body">
              Internal note
            </label>
            <textarea
              id="note-body"
              name="body"
              rows={4}
              required
              className="textarea"
              placeholder="Only agents and administrators see this. It is never emailed."
            />
            <FieldError result={noteState} field="body" />
          </div>

          <button type="submit" className="btn-secondary" disabled={notePending}>
            <MessageSquareLock className="size-4" aria-hidden />
            {notePending ? 'Saving…' : 'Add internal note'}
          </button>
        </form>
      ) : null}
    </div>
  );
}
