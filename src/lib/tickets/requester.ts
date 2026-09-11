/**
 * A ticket's requester is either an Entra user or an external Contact — never
 * both, and never neither (a CHECK constraint enforces it). Everything that
 * displays "who raised this" goes through here so the two cases cannot drift
 * apart in the UI.
 */
export type RequesterLike = {
  requester: { id: string; name: string; email: string } | null;
  contact: { id: string; name: string | null; email: string } | null;
};

export type ResolvedRequester = {
  name: string;
  email: string;
  /** External correspondents get a visible marker; staff do not need one. */
  isExternal: boolean;
};

export function resolveRequester(ticket: RequesterLike): ResolvedRequester {
  if (ticket.requester) {
    return { name: ticket.requester.name, email: ticket.requester.email, isExternal: false };
  }
  if (ticket.contact) {
    return {
      // An external sender may never have given a display name.
      name: ticket.contact.name?.trim() || ticket.contact.email,
      email: ticket.contact.email,
      isExternal: true,
    };
  }
  // Unreachable while the CHECK constraint holds; degrade visibly rather than
  // crashing a ticket list if it ever does not.
  return { name: 'Unknown requester', email: '', isExternal: false };
}
