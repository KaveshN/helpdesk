import { env } from '@/lib/env';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { AppError } from '@/lib/errors';

/**
 * Microsoft Graph client (application permissions / client credentials).
 *
 * App-only rather than delegated, because the mailbox poller runs on a timer
 * with no signed-in user. This is a different credential path from the user
 * sign-in in src/lib/auth: that one proves who a person is, this one lets the
 * service read a shared mailbox and the directory.
 *
 * REQUIRED APP REGISTRATION (application permissions, admin consent granted):
 *   User.Read.All   - directory lookup for the people pickers
 *   Mail.ReadWrite  - read the shared mailbox and mark messages processed
 *   Mail.Send       - reply as the shared mailbox
 *
 * SCOPE THE MAIL PERMISSIONS. Mail.ReadWrite application permission grants
 * access to EVERY mailbox in the tenant. Restrict it to the help desk mailboxes
 * with an Exchange application access policy, or this app becomes a
 * tenant-wide mail reader:
 *
 *   New-ApplicationAccessPolicy -AppId <client-id> `
 *     -PolicyScopeGroupId helpdesk-mailboxes@contoso.com `
 *     -AccessRight RestrictAccess `
 *     -Description "Help desk app may only touch help desk mailboxes"
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';
const TOKEN_CACHE_KEY = 'graph:app-token';

export class GraphError extends AppError {
  constructor(
    message: string,
    readonly graphStatus: number,
    readonly graphCode?: string,
  ) {
    super(message, { status: 502, code: 'graph_error', context: { graphStatus, graphCode } });
  }
}

export function graphConfigured(): boolean {
  const config = env();
  return config.entraConfigured;
}

function requireGraphConfig() {
  const config = env();
  if (!config.entraConfigured) {
    throw new AppError(
      'Microsoft Graph is not configured. Set AZURE_AD_CLIENT_ID, AZURE_AD_CLIENT_SECRET and AZURE_AD_TENANT_ID.',
      { status: 503, code: 'graph_not_configured' },
    );
  }
  return {
    tenantId: config.AZURE_AD_TENANT_ID!,
    clientId: config.AZURE_AD_CLIENT_ID!,
    clientSecret: config.AZURE_AD_CLIENT_SECRET!,
  };
}

/**
 * Acquire an app-only token, cached in Redis.
 *
 * Cached across processes because the poller, the web app and the outbound
 * worker all need it — three independent token requests per tick would hit
 * Entra's throttling for no reason. Expiry is shortened by 60s so a token is
 * never used in the last moments of its life.
 */
export async function getAppToken(): Promise<string> {
  const cached = await redis().get(TOKEN_CACHE_KEY);
  if (cached) return cached;

  const { tenantId, clientId, clientSecret } = requireGraphConfig();
  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    // Never log the response body verbatim: a token request echo can contain
    // the client secret back in an error description.
    logger.error({ status: response.status }, 'graph token request failed');
    throw new GraphError(
      `Could not acquire a Microsoft Graph token (${response.status}). Check the client secret and admin consent.`,
      response.status,
      detail.slice(0, 0),
    );
  }

  const body = (await response.json()) as { access_token: string; expires_in: number };
  const ttl = Math.max(60, body.expires_in - 60);
  await redis().set(TOKEN_CACHE_KEY, body.access_token, 'EX', ttl);
  return body.access_token;
}

/** Drop the cached token — call after a 401 so the next attempt re-acquires. */
export async function invalidateAppToken(): Promise<void> {
  await redis().del(TOKEN_CACHE_KEY);
}

type GraphRequest = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Path relative to the Graph root, or an absolute Graph URL (delta links). */
  path: string;
  body?: unknown;
  /** Graph returns 202/204 with no body for sends and updates. */
  expectNoContent?: boolean;
};

export async function graphFetch<T>(request: GraphRequest, retry = true): Promise<T> {
  const token = await getAppToken();
  const url = request.path.startsWith('http') ? request.path : `${GRAPH}${request.path}`;

  const response = await fetch(url, {
    method: request.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(request.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: request.body ? JSON.stringify(request.body) : undefined,
  });

  // A cached token can be revoked mid-life; retry once with a fresh one.
  if (response.status === 401 && retry) {
    await invalidateAppToken();
    return graphFetch<T>(request, false);
  }

  // Graph asks callers to back off explicitly; honouring it is the difference
  // between a brief slowdown and a throttled app.
  if (response.status === 429 && retry) {
    const wait = Number(response.headers.get('Retry-After') ?? '5');
    logger.warn({ waitSeconds: wait, path: request.path }, 'graph throttled, backing off');
    await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 30) * 1000));
    return graphFetch<T>(request, false);
  }

  if (!response.ok) {
    let code: string | undefined;
    let message = `Graph request failed (${response.status})`;
    try {
      const error = (await response.json()) as { error?: { code?: string; message?: string } };
      code = error.error?.code;
      if (error.error?.message) message = error.error.message;
    } catch {
      // Non-JSON error body; the status alone will have to do.
    }
    logger.error({ status: response.status, code, path: request.path }, 'graph request failed');
    throw new GraphError(message, response.status, code);
  }

  if (request.expectNoContent || response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
