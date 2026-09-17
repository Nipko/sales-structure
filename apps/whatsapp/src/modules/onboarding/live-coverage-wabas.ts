/**
 * Which WABAs a tenant-wide WhatsApp credential must still be able to read.
 *
 * The credential in `whatsapp_credentials` is one per tenant, so before it is
 * replaced the new token has to prove it can read every WABA the tenant still
 * sends from. The old rule took EVERY `whatsapp_channels` row, and a number
 * disconnected from the panel keeps its row (with `meta_waba_id` and
 * `channel_status='disconnected'`). Incident cotes-asociados, 16-sep-2026: a
 * Meta test number was connected and disconnected, and six coexistence
 * attempts for a number in ANOTHER business portfolio were refused because
 * their token could not read the dead test WABA — something no token from
 * that portfolio can ever do.
 *
 * ── RULE R-S3 ───────────────────────────────────────────────────────────────
 *
 * A row is DEAD iff ALL of these hold:
 *   - its `channel_status`, trimmed and lower-cased, is `disconnected`;
 *   - it has a non-blank `phone_number_id`;
 *   - `public.channel_accounts` has the row for ('whatsapp', that phone id);
 *   - and that account is no longer this tenant's (`tenantId` differs) OR it
 *     is inactive (`isActive === false`).
 *
 * `channel_accounts` is unique on (channel_type, account_id), and
 * `registerChannelAccount` MOVES the row to whichever tenant connected the
 * number last. So the account is read WITHOUT a tenant filter: a number
 * disconnected here and connected by another tenant has an ACTIVE row that
 * belongs to someone else, and a tenant-filtered read found nothing, which the
 * old rule took as "legacy, still required" — the same refusal as the incident,
 * for a number this tenant cannot send from at all.
 *
 * Everything else still counts — connected, pending, restricted, a status
 * nobody has reasoned about, disconnected with this tenant's active account,
 * and legacy rows with no account at all (absence is not inactivity). The status
 * alone is not durable evidence: a Meta `account_update` webhook can flip
 * `channel_status` back to `connected` on its own. The send path refuses when
 * EITHER authority says dead (apps/api/src/modules/channels/connection-usability.ts
 * `assessConnection`). Blank WABA ids are nothing a token could be asked to
 * read and are skipped. A WABA is required while ANY row carrying it is not
 * dead, and the target WABA is always required.
 *
 * The result is de-duplicated: row WABAs first, in row order, then the target
 * (which keeps its earlier place when a required row already listed it).
 *
 * ── KNOWN LIMIT (not fixed here) ────────────────────────────────────────────
 *
 * `OffboardingService.reactivate` and the super-admin `reactivateChannels`
 * (apps/api/src/modules/offboarding/offboarding.service.ts) set `is_active=true`
 * on inactive `channel_accounts` whose `metadata.disconnected_at_provider` is
 * false, and a Meta `account_update` webhook can put `channel_status` back to
 * `connected`. After that, a number this rule excluded can look sendable while
 * the tenant credential does not cover its WABA. Sends through it would be
 * refused (the credential has no access to that WABA), not signed with the
 * wrong identity — a visible failure, not a mis-attributed message.
 *
 * TWIN: apps/api/src/modules/whatsapp/services/whatsapp-live-coverage.ts
 * (used by `saveConnection`, manual connect) applies the same rule and pins the
 * same case table. Change both.
 */

export interface CoverageChannelRow {
  readonly meta_waba_id?: string | null;
  readonly channel_status?: string | null;
  readonly phone_number_id?: string | null;
}

/** The projection of `public.channel_accounts` the rule reads. */
export interface CoverageChannelAccount {
  readonly tenantId: string;
  readonly accountId: string;
  readonly isActive: boolean | null;
}

export interface LiveCoverageInput {
  readonly tenantId: string;
  readonly rows: readonly CoverageChannelRow[];
  /**
   * Accounts for the phone ids from `disconnectedCoveragePhoneIds`, read for
   * channel type 'whatsapp' WITHOUT a tenant filter (see the rule above).
   */
  readonly accounts: readonly CoverageChannelAccount[];
  readonly targetWabaId: string;
}

/** `lower(trim(channel_status))`, the reading every usability check takes. */
const isDisconnected = (status: unknown): boolean =>
  String(status ?? '').trim().toLowerCase() === 'disconnected';

const phoneIdOf = (row: CoverageChannelRow): string => String(row.phone_number_id ?? '').trim();

const wabaIdOf = (row: CoverageChannelRow): string => String(row.meta_waba_id ?? '').trim();

/**
 * Phone ids whose `channel_accounts` row must be read to decide the rule — only
 * the disconnected rows with a phone id; a live status needs no second opinion
 * and a blank phone id can never be matched.
 */
export function disconnectedCoveragePhoneIds(rows: readonly CoverageChannelRow[]): string[] {
  return [...new Set(rows
    .filter(row => isDisconnected(row.channel_status))
    .map(phoneIdOf)
    .filter(Boolean))];
}

export function liveCoverageWabaIds(input: LiveCoverageInput): string[] {
  // Unique on (channel_type, account_id), so one account per phone id.
  const accountByPhone = new Map<string, CoverageChannelAccount>();
  for (const account of input.accounts) {
    accountByPhone.set(String(account.accountId ?? '').trim(), account);
  }

  const isDead = (row: CoverageChannelRow): boolean => {
    if (!isDisconnected(row.channel_status)) return false;
    const phoneId = phoneIdOf(row);
    if (!phoneId) return false;
    const account = accountByPhone.get(phoneId);
    // No account row is a legacy tenant, not a disconnect.
    if (!account) return false;
    return account.tenantId !== input.tenantId || account.isActive === false;
  };

  const required = input.rows
    .filter(row => !isDead(row))
    .map(wabaIdOf)
    .filter(Boolean);
  return [...new Set([...required, String(input.targetWabaId)])];
}
