/**
 * Which WABAs a tenant-wide WhatsApp credential still has to be able to read.
 *
 * ── THE SECOND COPY, ON PURPOSE ──────────────────────────────────────────────
 *
 * TWIN: apps/whatsapp/src/modules/onboarding/live-coverage-wabas.ts, used by
 * `OnboardingService.resolveCredentialForCoverage` in the Embedded Signup flow.
 * This copy is used by `WhatsappConnectionService.saveConnection` (manual
 * connect). The two apps do not share runtime code, so the rule is written
 * twice and must be CHANGED twice, test table included: a number that one
 * connect path lets go of and the other still demands is the incident below
 * with a different entry point.
 *
 * ── WHAT WENT WRONG ─────────────────────────────────────────────────────────
 *
 * cotes-asociados, 16-sep-2026. A Meta test number was disconnected. Its
 * `whatsapp_channels` row stayed (deliberately: history and templates hang off
 * it) with its WABA id, and the list of WABAs to cover was built from EVERY row.
 * The next number came from a different business portfolio, so its token could
 * never read the old WABA, and every attempt to connect it was refused for a
 * number nobody was using any more.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * A row is DEAD only when ALL of these hold:
 *
 *   · its `channel_status`, trimmed and lower-cased, is `disconnected`;
 *   · it has a non-blank `phone_number_id` (without one nothing can be matched
 *     to an account row, so nothing can prove it dead);
 *   · a `channel_accounts` row for that number exists; and
 *   · that account row is inactive OR belongs to ANOTHER tenant.
 *
 * A WABA is required while ANY row carrying it is not dead. The target WABA is
 * always required: it is the one being connected. Rows with a blank WABA id are
 * skipped — there is nothing a token could be asked to read.
 *
 * Why two authorities: `channel_status` alone is not durable — Meta's
 * `account_update` webhook rewrites it and can put a disconnected number back
 * to `connected` on its own. And a number with NO account row is a legacy
 * tenant provisioned before that table was populated, not a disconnect:
 * absence is not inactivity, the reading `connection-usability.ts` takes too.
 *
 * Why another tenant's row counts as dead: `channel_accounts` is unique on
 * (channel_type, account_id), and connecting a number MOVES that row to
 * whichever tenant connected it last (`registerChannelAccount` in Embedded
 * Signup, the account upsert in `saveConnection` here). Once it points at
 * another tenant, the webhooks for that number resolve to that tenant: the
 * number is theirs, and this tenant's disconnected row is a leftover its
 * credential has no reason to cover. That is also why the account read must
 * NOT be filtered by tenant: filtered, a number another tenant took over looks
 * like "no account row" — legacy, still required — and blocks this tenant for
 * as long as the leftover row exists.
 *
 * ── KNOWN LIMIT (not fixed here) ────────────────────────────────────────────
 *
 * `OffboardingService.reactivate` and the super-admin `reactivateChannels`
 * (apps/api/src/modules/offboarding/offboarding.service.ts) set
 * `is_active = true` on this tenant's inactive `channel_accounts` whose
 * `metadata.disconnected_at_provider` is false, and an `account_update` webhook
 * can flip `channel_status` back to `connected`. After both, a number excluded
 * here can look sendable again while the tenant credential that replaced the
 * old one does not cover its WABA. Sends through it would then be refused (the
 * tenant's own token has no scope on that WABA), not mis-signed: no other
 * tenant's token is ever reached for.
 */

import { metaGraphAnswer, metaGraphClassifier, type ProviderAnswer } from '../../channels/provider-error-classification';

export interface CoverageChannelRow {
  readonly meta_waba_id?: string | null;
  readonly phone_number_id?: string | null;
  readonly channel_status?: string | null;
}

/** The projection of `channel_accounts` the rule reads — never the token. */
export interface CoverageAccountRow {
  readonly tenantId: string;
  readonly accountId: string;
  readonly isActive: boolean;
}

/** `lower(trim(channel_status))`, the reading every usability check takes. */
function normalizedStatus(status: string | null | undefined): string {
  return String(status ?? '').trim().toLowerCase();
}

function phoneIdOf(row: CoverageChannelRow): string {
  return String(row.phone_number_id ?? '').trim();
}

/**
 * The phone number ids whose `channel_accounts` row is worth reading at all:
 * only a row that already says `disconnected` can be dropped, so nothing else
 * needs the second authority consulted. Read them by channel type and account
 * id ONLY — see "Why another tenant's row counts as dead" above.
 */
export function disconnectedCoveragePhoneIds(rows: readonly CoverageChannelRow[]): string[] {
  return [...new Set(rows
    .filter(row => normalizedStatus(row.channel_status) === 'disconnected')
    .map(phoneIdOf)
    .filter(Boolean))];
}

export function liveCoverageWabaIds(input: {
  /** The tenant whose credential is being validated. */
  readonly tenantId: string;
  /** The tenant's `whatsapp_channels` rows. */
  readonly rows: readonly CoverageChannelRow[];
  /** `channel_accounts` rows for the disconnected numbers, of ANY tenant. */
  readonly accounts: readonly CoverageAccountRow[];
  /** The WABA being connected now. */
  readonly targetWabaId: string;
}): string[] {
  // Unique on (channel_type, account_id), so one account per phone id.
  const accountByPhone = new Map<string, CoverageAccountRow>();
  for (const account of input.accounts) {
    accountByPhone.set(String(account.accountId ?? '').trim(), account);
  }

  const isDead = (row: CoverageChannelRow): boolean => {
    if (normalizedStatus(row.channel_status) !== 'disconnected') return false;
    const phoneId = phoneIdOf(row);
    // No phone number id: nothing can be matched to an account row, so nothing
    // can prove it dead.
    if (!phoneId) return false;
    const account = accountByPhone.get(phoneId);
    // No account row is a legacy tenant, not a disconnect.
    if (!account) return false;
    return account.tenantId !== input.tenantId || account.isActive === false;
  };

  const live = input.rows
    .filter(row => !isDead(row))
    .map(row => String(row.meta_waba_id ?? '').trim())
    // No WABA id is nothing a token could be asked to read.
    .filter(Boolean);
  return [...new Set([...live, String(input.targetWabaId)])];
}

// ═══ RULE T: WHAT ONE COVERAGE PROBE PROVES ═══════════════════════════════════
//
// TWIN: the Embedded Signup flow applies the same three-way reading to its WABA
// reads (apps/whatsapp, `OnboardingService.assertTokenCoverage`). Change both.
//
// Asking Meta "can this token read that WABA?" has THREE answers, not two. A
// read that failed because Meta had a bad minute says nothing about access, and
// reading it as "does not cover" is how a stored permanent credential that
// covered the only live number got replaced by a temporary candidate: its probe
// timed out, P2 saw "cannot read the target, nothing else live", and wrote.
//
//   covers     Meta answered 2xx about the very WABA that was asked for.
//   denied     Meta answered and refused: a 4xx other than 429 carrying a Graph
//              error that is not a throttle (permission, not found, unsupported
//              get request, OAuthException), or a 2xx about another object.
//   transient  everything else — no HTTP answer (timeout, abort, DNS, reset), a
//              5xx, a 429, a Graph throttling code, a body nobody can read, a
//              4xx with no Graph error (an edge answered, not Meta).
//
// Only `denied` may decide that a credential does not cover. `transient` must
// stop the decision without writing anything; the person is asked to try again.

export type CoverageProbeResult = 'covers' | 'denied' | 'transient';

export interface CoverageProbeAnswer {
  /** The HTTP status, or `null` when no answer arrived at all. */
  readonly status: number | null;
  /** The parsed JSON body; `undefined` when it could not be read. */
  readonly body?: unknown;
}

/**
 * Graph API throttles a WABA read can meet that the send classifier never sees:
 * 17 (user request limit) and 32 (page request limit) are the Graph API's own,
 * not the Cloud API's. Every other throttle — 4, 613, 80007, 130429, 133016, an
 * `is_transient` flag, the documented "temporary downtime" 2 — is the send
 * path's `metaGraphClassifier`, the rule `whatsapp-messaging.service.ts`
 * already reads Meta's answers with, so the two cannot drift on what a
 * rate limit is.
 */
const GRAPH_READ_THROTTLING_CODES = new Set<number>([17, 32]);

/**
 * The Business Use Case throttles, 80000-80014. `GET /{waba-id}` is a WhatsApp
 * Business Management read, whose throttle Meta documents as 80008 — a plain
 * 400 OAuthException with no `is_transient`, which the send classifier (built
 * for Cloud API sends, where 80007 is the one that appears) does not know. Read
 * as a refusal, it let a management rate limit decide that a covering permanent
 * credential "does not cover". The range matches the apps/whatsapp twin's
 * `isMetaRateLimit`, so both connect paths call the same answer a blip.
 */
const BUSINESS_USE_CASE_THROTTLE_MIN = 80000;
const BUSINESS_USE_CASE_THROTTLE_MAX = 80014;

/** Graph's documented temporary-downtime codes: 1 (unknown) and 2 (service), as the twin reads them. */
const GRAPH_TEMPORARY_DOWNTIME_CODES = new Set<number>([1, 2]);

function isThrottle(answer: ProviderAnswer): boolean {
  const code = Number(answer.error?.code);
  if (GRAPH_READ_THROTTLING_CODES.has(code)) return true;
  if (GRAPH_TEMPORARY_DOWNTIME_CODES.has(code)) return true;
  if (Number.isInteger(code) && code >= BUSINESS_USE_CASE_THROTTLE_MIN && code <= BUSINESS_USE_CASE_THROTTLE_MAX) {
    return true;
  }
  // Asked about the error object ALONE, as the non-2xx refusal it is: the send
  // classifier reads a 2xx as "accepted without a receipt" before it looks at
  // any code, and the question here is only whether the code is a throttle.
  const verdict = metaGraphClassifier({ ...answer, status: 400, receipt: null });
  return verdict.kind === 'rejected' && verdict.retryable;
}

export function classifyCoverageProbe(answer: CoverageProbeAnswer, wabaId: string): CoverageProbeResult {
  const status = answer.status;
  // No answer at all: nothing Meta said can be read into it.
  if (status === null || !Number.isFinite(status)) return 'transient';
  if (status === 429 || status >= 500) return 'transient';

  const graph = metaGraphAnswer(status, answer.body, 'message_id');
  const success = status >= 200 && status < 300;
  if (graph.error) {
    if (isThrottle(graph)) return 'transient';
    return success || (status >= 400 && status < 500) ? 'denied' : 'transient';
  }
  if (success) {
    // A 2xx whose body cannot be read is a cut stream, not an answer.
    if (!graph.bodyReadable) return 'transient';
    return String((answer.body as { id?: unknown }).id ?? '') === String(wabaId) ? 'covers' : 'denied';
  }
  // A 4xx with no Graph error object did not come from the Graph API: whatever
  // answered, it was not Meta refusing this token.
  return 'transient';
}
