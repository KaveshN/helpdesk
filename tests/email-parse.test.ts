import { describe, expect, it } from 'vitest';
import {
  findTicketReference,
  isChangeReference,
  htmlToText,
  normaliseSubject,
  parseMessage,
  shouldIgnore,
  stripQuotedReply,
} from '@/lib/email/parse';

describe('normaliseSubject', () => {
  it('strips a single reply prefix', () => {
    expect(normaliseSubject('Re: Printer is jammed')).toBe('Printer is jammed');
  });

  it('strips stacked and mixed prefixes', () => {
    expect(normaliseSubject('RE: FW: Re: Printer is jammed')).toBe('Printer is jammed');
    expect(normaliseSubject('Fwd: AW: VPN down')).toBe('VPN down');
  });

  it('strips numbered prefixes some clients add', () => {
    expect(normaliseSubject('Re[2]: VPN down')).toBe('VPN down');
  });

  it('leaves an ordinary subject alone', () => {
    expect(normaliseSubject('Research findings')).toBe('Research findings');
  });

  it('does not eat a word that merely starts with re', () => {
    expect(normaliseSubject('Reboot required')).toBe('Reboot required');
  });

  it('handles empty input', () => {
    expect(normaliseSubject(null)).toBe('');
    expect(normaliseSubject(undefined)).toBe('');
  });
});

describe('findTicketReference', () => {
  it('finds a bracketed reference', () => {
    expect(findTicketReference('Re: [ITHD-000123] Printer jammed')).toBe('ITHD-000123');
  });

  it('uppercases a lowercase reference', () => {
    expect(findTicketReference('re: [ithd-000123] printer')).toBe('ITHD-000123');
  });

  it('requires brackets, so a quoted reference in prose is not a match', () => {
    // Otherwise someone writing "similar to ITHD-000999" reopens that ticket.
    expect(findTicketReference('Similar to ITHD-000999 but different')).toBeNull();
  });

  it('returns null when absent', () => {
    expect(findTicketReference('Printer jammed')).toBeNull();
    expect(findTicketReference(null)).toBeNull();
  });

  it('finds a change reference, including the C segment', () => {
    expect(findTicketReference('[ITHD-C-000042] approved')).toBe('ITHD-C-000042');
    expect(isChangeReference('ITHD-C-000042')).toBe(true);
    expect(isChangeReference('ITHD-000042')).toBe(false);
  });
});

describe('htmlToText', () => {
  it('converts breaks and blocks to newlines', () => {
    expect(htmlToText('<p>One</p><p>Two</p>')).toBe('One\n\nTwo');
    expect(htmlToText('a<br>b')).toBe('a\nb');
  });

  it('drops style and script content entirely', () => {
    expect(htmlToText('<style>.a{color:red}</style><p>Hi</p>')).toBe('Hi');
    expect(htmlToText('<script>alert(1)</script><p>Hi</p>')).toBe('Hi');
  });

  it('decodes the common entities', () => {
    expect(htmlToText('<p>Tom &amp; Jerry &lt;tom@x.com&gt; &quot;hi&quot;</p>')).toBe(
      'Tom & Jerry <tom@x.com> "hi"',
    );
  });

  it('collapses runs of blank lines', () => {
    expect(htmlToText('<p>a</p><p></p><p></p><p>b</p>')).toBe('a\n\nb');
  });

  it('handles empty input', () => {
    expect(htmlToText(null)).toBe('');
  });
});

describe('stripQuotedReply', () => {
  it('cuts at the Outlook original-message divider', () => {
    const body = 'Still broken.\n\n-----Original Message-----\nFrom: Help Desk\nOld text';
    expect(stripQuotedReply(body)).toBe('Still broken.');
  });

  it('cuts at the Gmail "On ... wrote:" line', () => {
    const body = 'Thanks, fixed.\n\nOn Mon, 8 Sep 2026 at 09:14, Help Desk wrote:\n> earlier';
    expect(stripQuotedReply(body)).toBe('Thanks, fixed.');
  });

  it('cuts at a quoted > block', () => {
    expect(stripQuotedReply('Nope.\n\n> previous message\n> more')).toBe('Nope.');
  });

  it('cuts at our own reply separator', () => {
    const body = `New info here.\n\n--- Please reply above this line ---\n\nTicket ITHD-000123`;
    expect(stripQuotedReply(body)).toBe('New info here.');
  });

  it('cuts at a From: header block', () => {
    expect(stripQuotedReply('See below.\n\nFrom: Help Desk <hd@x.com>\nSent: yesterday')).toBe(
      'See below.',
    );
  });

  it('returns the original when stripping would empty it', () => {
    // A top-posted reply with nothing above the quote must not become blank —
    // losing the customer's message is worse than keeping the history.
    const onlyQuote = '> previous message only';
    expect(stripQuotedReply(onlyQuote)).toBe(onlyQuote);
  });

  it('leaves a clean body untouched', () => {
    expect(stripQuotedReply('Just a normal message.')).toBe('Just a normal message.');
  });

  it('takes the earliest marker when several are present', () => {
    const body = 'Reply.\n\nOn Mon someone wrote:\n\n-----Original Message-----\nolder';
    expect(stripQuotedReply(body)).toBe('Reply.');
  });
});

describe('shouldIgnore', () => {
  const mailbox = 'it-helpdesk@example.com';

  it('ignores mail from the mailbox itself', () => {
    // Our own sent copy landing back in the inbox must not raise a ticket.
    expect(shouldIgnore({ fromEmail: mailbox, subject: 'Hi', mailbox }).ignore).toBe(true);
  });

  it('ignores no-reply and bounce senders', () => {
    for (const from of [
      'no-reply@vendor.com',
      'noreply@vendor.com',
      'do-not-reply@vendor.com',
      'MAILER-DAEMON@vendor.com',
      'postmaster@vendor.com',
    ]) {
      expect(shouldIgnore({ fromEmail: from, subject: 'x', mailbox }).ignore, from).toBe(true);
    }
  });

  it('ignores out-of-office and delivery reports', () => {
    // The loop this prevents: our ack triggers an OOO, which we ack, forever.
    for (const subject of [
      'Automatic reply: your request',
      'Out of Office: back Monday',
      'Undeliverable: your message',
      'Delivery Status Notification (Failure)',
    ]) {
      expect(shouldIgnore({ fromEmail: 'a@b.com', subject, mailbox }).ignore, subject).toBe(true);
    }
  });

  it('ignores anything marked auto-submitted', () => {
    expect(
      shouldIgnore({
        fromEmail: 'a@b.com',
        subject: 'Ticket',
        mailbox,
        headers: { 'auto-submitted': 'auto-generated' },
      }).ignore,
    ).toBe(true);
  });

  it('accepts auto-submitted: no, which is what normal mail sets', () => {
    expect(
      shouldIgnore({
        fromEmail: 'a@b.com',
        subject: 'Ticket',
        mailbox,
        headers: { 'auto-submitted': 'no' },
      }).ignore,
    ).toBe(false);
  });

  it('ignores a message with no sender', () => {
    expect(shouldIgnore({ fromEmail: '', subject: 'x', mailbox }).ignore).toBe(true);
  });

  it('accepts an ordinary message', () => {
    const result = shouldIgnore({
      fromEmail: 'lerato@example.com',
      subject: 'Laptop will not start',
      mailbox,
    });
    expect(result.ignore).toBe(false);
  });
});

describe('parseMessage', () => {
  const base = {
    id: 'AAMk-1',
    conversationId: 'conv-1',
    internetMessageId: '<abc@example.com>',
    receivedDateTime: '2026-09-11T06:30:00Z',
    hasAttachments: true,
    from: { emailAddress: { name: 'Lerato Ndlovu', address: 'Lerato@Example.com' } },
    toRecipients: [{ emailAddress: { address: 'IT-Helpdesk@Example.com' } }],
  };

  it('extracts and normalises a new message', () => {
    const parsed = parseMessage(
      {
        ...base,
        subject: 'Laptop will not start',
        body: { contentType: 'html', content: '<p>It is dead.</p>' },
      },
      'it-helpdesk@example.com',
    );

    expect(parsed.fromEmail).toBe('lerato@example.com'); // lowercased
    expect(parsed.fromName).toBe('Lerato Ndlovu');
    expect(parsed.toEmail).toBe('it-helpdesk@example.com');
    expect(parsed.cleanSubject).toBe('Laptop will not start');
    expect(parsed.body).toBe('It is dead.');
    expect(parsed.ticketReference).toBeNull();
    expect(parsed.conversationId).toBe('conv-1');
    expect(parsed.hasAttachments).toBe(true);
    expect(parsed.receivedAt.toISOString()).toBe('2026-09-11T06:30:00.000Z');
  });

  it('recognises a reply and keeps the raw text for audit', () => {
    const parsed = parseMessage(
      {
        ...base,
        subject: 'Re: [ITHD-000123] Laptop will not start',
        body: {
          contentType: 'html',
          content: '<p>Still dead.</p><p>-----Original Message-----</p><p>old</p>',
        },
      },
      'it-helpdesk@example.com',
    );

    expect(parsed.ticketReference).toBe('ITHD-000123');
    expect(parsed.cleanSubject).toBe('[ITHD-000123] Laptop will not start');
    expect(parsed.body).toBe('Still dead.');
    expect(parsed.rawText).toContain('Original Message');
  });

  it('falls back to the mailbox when there is no recipient', () => {
    const parsed = parseMessage(
      { ...base, toRecipients: null, subject: 'x', body: { contentType: 'text', content: 'y' } },
      'it-helpdesk@example.com',
    );
    expect(parsed.toEmail).toBe('it-helpdesk@example.com');
  });

  it('substitutes a placeholder for a missing subject', () => {
    const parsed = parseMessage(
      { ...base, subject: null, body: { contentType: 'text', content: 'body' } },
      'it-helpdesk@example.com',
    );
    expect(parsed.cleanSubject).toBe('(no subject)');
  });
});
