import { Logger } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import type { ToolsConfig } from '@parallext/shared';
import type { RevisionQuery } from '../../modules/persona/agent-configuration-revision';
import { readServingPersona } from '../../modules/persona/serving-persona';

/**
 * ═══ WHOSE SWITCH DECIDES WHETHER THE CONFIRMATION GOES OUT ═══
 *
 * `agent_personas.config_json.tools.<family>.emailConfirmations` is a per-AGENT
 * switch. Every consumer of it read it like this:
 *
 *     SELECT config_json FROM agent_personas WHERE is_active = true LIMIT 1
 *
 * which is not the agent that took the booking — it is whichever active row the
 * planner happened to return first, with no ORDER BY at all. On a tenant with
 * one agent the two coincide and nothing looks wrong. On a tenant with two —
 * a WhatsApp agent that sends confirmations and an Instagram agent that does
 * not — the switch the owner set on the agent that actually took the booking
 * was ignored half the time, and which half changed between two identical
 * bookings because an unordered `LIMIT 1` is not a stable choice.
 *
 * The connection the operation arrived on names the agent that served it:
 * that is what `readServingPersona` resolves, with the same binding → channel →
 * default ranking production routing uses. So the confirmation is sent under
 * the policy of the agent that made the promise, not of a sibling.
 */

/** The connection an operation originated on, when it originated on one. */
export interface OriginConnection {
    readonly channelType: string;
    /** Null when the channel is known but the account is not. */
    readonly channelAccountId: string | null;
}

const logger = new Logger('ServedConfirmationPolicy');

/**
 * The connection the operation was performed on, read from its thread.
 *
 * `null` is a real answer and the common one: an appointment entered by hand,
 * an order raised from the dashboard and a stay booked through the public page
 * all have no thread, and therefore no serving agent to ask.
 */
export async function originConnectionForThread(
    query: RevisionQuery,
    conversationId: string | null | undefined,
): Promise<OriginConnection | null> {
    const id = String(conversationId ?? '').trim();
    if (!id) return null;
    try {
        const rows = await query<any[]>(
            `SELECT channel_type, channel_account_id FROM conversations
              WHERE id = $1::uuid LIMIT 1`,
            [id],
        );
        const row = rows?.[0];
        const channelType = String(row?.channel_type ?? '').trim();
        if (!channelType) return null;
        const account = String(row?.channel_account_id ?? '').trim();
        return { channelType, channelAccountId: account || null };
    } catch (error: any) {
        logger.warn(`Could not read the origin thread ${id}: ${error?.message}`);
        return null;
    }
}

/**
 * Which families govern one event, most specific first.
 *
 * One event can belong to two families at once. A test drive is written by the
 * appointment writer and emitted as `appointment.created`, but the tool that
 * asked for it — `schedule_test_drive` — is gated by `vehicles`
 * (`agent-tool-registry.ts`). So the owner of a dealership has two switches
 * that both plausibly describe its confirmation, and picking one arbitrarily is
 * how a control ends up meaning nothing.
 *
 * The nearer family decides when the owner set it, and only then. A dealership
 * that switches test-drive confirmations off keeps its service-appointment
 * confirmations; one that never touched `vehicles` keeps following the
 * appointment switch it already set. `enabled` is deliberately not consulted:
 * the family being switched off for the AGENT does not un-happen an operation
 * that already committed, and the customer is still owed the receipt.
 */
export type ConfirmationFamilies = readonly [keyof ToolsConfig, ...(keyof ToolsConfig)[]];

/** The first family whose `emailConfirmations` the owner actually set. */
function decide(tools: any, families: ConfirmationFamilies): boolean {
    for (const family of families) {
        const value = tools?.[family]?.emailConfirmations;
        if (typeof value === 'boolean') return value;
    }
    // ── ABSENT IS PERMITTED, AND ONLY AN EXPLICIT `false` SWITCHES IT OFF ──
    //
    // The same rule the tool registry states for subpermissions, for the same
    // reason: an agent saved before the key existed must not lose a behaviour
    // to a contract change. All four prior consumers already read it as
    // `!== false`, so a one-family list keeps their exact meaning.
    return true;
}

/**
 * Does the agent that served this operation's origin send the email
 * confirmation for it?
 *
 * ── WHY EVERY UNCERTAIN ANSWER STILL SENDS ─────────────────────────────────
 *
 * No thread, no agent bound to the channel, a tenant still on legacy config, a
 * read that failed, two agents tied for the same connection: none of those is
 * an owner switching the confirmation off. Treating them as "off" would drop a
 * customer's booking confirmation over a configuration the owner never made,
 * which is the louder failure of the two — so they send, and the ambiguous case
 * says so in the log rather than picking one agent's answer over the other's.
 */
export async function servedEmailConfirmationsEnabled(
    query: RevisionQuery,
    families: ConfirmationFamilies,
    origin: OriginConnection | null,
): Promise<boolean> {
    if (!origin) return true;
    const label = families.join('→');
    try {
        const served = await readServingPersona(
            query, origin.channelType, origin.channelAccountId ?? undefined,
        );
        return decide((served.config as any)?.tools, families);
    } catch (error: any) {
        if (error instanceof ConflictException) {
            logger.warn(`[${label}] two agents claim ${origin.channelType}`
                + `${origin.channelAccountId ? `:${origin.channelAccountId}` : ''} — nobody `
                + `chose, so the confirmation is not suppressed on either one's behalf`);
            return true;
        }
        logger.error(`[${label}] could not resolve the serving agent for `
            + `${origin.channelType}: ${error?.message}`);
        return true;
    }
}

/**
 * Both halves at once, for the callers that hold a domain row and want the
 * answer: read the row's thread, then ask the agent that served it.
 */
export async function emailConfirmationsForOperation(
    query: RevisionQuery,
    families: ConfirmationFamilies,
    conversationId: string | null | undefined,
): Promise<boolean> {
    return servedEmailConfirmationsEnabled(
        query, families, await originConnectionForThread(query, conversationId),
    );
}
