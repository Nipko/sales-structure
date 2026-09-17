/**
 * Which of the tenant's WhatsApp numbers are live, read from
 * `GET /channels/whatsapp/status`.
 *
 * That endpoint answers two questions in one body and the screens used to mix
 * them up:
 *  - `status`/`channel` come from the oldest CONNECTED row (and only fall back
 *    to the oldest row when nothing is connected);
 *  - `channels` is EVERY `whatsapp_channels` row, oldest first — and a
 *    disconnect keeps its row, with `channel_status = 'disconnected'`.
 *
 * Building "active numbers" from the raw `channels` array listed the leftover
 * of a replaced number as active (quality badge defaulting to GREEN), counted
 * it against the plan limit and offered a per-number "Desconectar" that the API
 * refuses ("No active account found to disconnect": it only acts on an active
 * `channel_accounts` row). Profile and Templates took `channels[0]`, which is
 * exactly that leftover once a tenant swapped numbers, since it is the oldest.
 *
 * One reading for the three screens, so they cannot disagree with each other
 * or with the API about what "connected" means.
 */

/**
 * The only status a number that can send carries. Mirrors
 * `SENDABLE_CHANNEL_STATUS` in apps/api (whatsapp-connection.service.ts), which
 * compares the same trimmed, lower-cased value when it picks `channel`.
 */
export const CONNECTED_CHANNEL_STATUS = "connected";

/** A status row as the screens read it; every field is optional on the wire. */
export type WhatsAppStatusRow = Record<string, any>;

export interface WhatsAppChannelRows<Row extends object = WhatsAppStatusRow> {
  /** Every row the endpoint returned, in its order (oldest first). */
  all: Row[];
  /** The rows that are connected, in that same order. The only ones to list, count or act on. */
  connected: Row[];
  /**
   * The number a screen uses when the person has not picked one: the first
   * connected row, else the first row (so a request still names a number and
   * the server explains why it cannot serve it), else null.
   */
  preferred: Row | null;
}

export function normalizeChannelStatus(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rowsOf(value: unknown): WhatsAppStatusRow[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function readWhatsAppChannelRows<Row extends object = WhatsAppStatusRow>(
  payload: unknown,
): WhatsAppChannelRows<Row> {
  const root = isRecord(payload) ? payload : {};
  // Same precedence the screens always used: a `data` envelope when present.
  const src = isRecord(root.data) ? root.data : root;

  let all: WhatsAppStatusRow[];
  let connected: WhatsAppStatusRow[];

  const channels = rowsOf(src.channels);
  const accounts = rowsOf(src.accounts);
  if (channels.length) {
    all = channels;
    connected = channels.filter(isConnectedRow);
  } else if (accounts.length) {
    // The generic `GET /channels/:channelType/status` shape. It returns only
    // `channel_accounts` rows with `isActive: true` and carries no
    // `channel_status`, so every row it lists is active by construction.
    // Reading the missing status as "disconnected" would empty a working page.
    all = accounts;
    connected = accounts;
  } else if (isRecord(src.channel)) {
    all = [src.channel];
    connected = all.filter(isConnectedRow);
  } else if (isRecord(src.account)) {
    all = [src.account];
    connected = all;
  } else {
    all = [];
    connected = [];
  }

  return {
    all: all as Row[],
    connected: connected as Row[],
    preferred: (connected[0] ?? all[0] ?? null) as Row | null,
  };
}

function isConnectedRow(row: WhatsAppStatusRow): boolean {
  return normalizeChannelStatus(row.channel_status) === CONNECTED_CHANNEL_STATUS;
}

/** The Meta phone number id of a status row, whichever shape carried it. */
export function whatsAppRowPhoneNumberId(row: unknown): string {
  if (!isRecord(row)) return "";
  const metadata = isRecord(row.metadata) ? row.metadata : {};
  for (const candidate of [row.phone_number_id, metadata.phoneNumberId, row.accountId]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}
