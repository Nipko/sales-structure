import { createHash } from 'crypto';

/**
 * What the customer was shown before the business was committed to anything.
 *
 * Four families bound their terms and eleven did not, and the eleven were about
 * to be closed one at a time — a bespoke terms module per vertical, each with
 * its own hash, its own error and its own idea of what "changed" means. That is
 * how the four that exist already ended up different from each other.
 *
 * So this is one contract for all of them. A proposal is the sentence the
 * customer agreed to, in a shape a machine can compare:
 *
 *   · the RESOURCES it commits — the property, the table, the technician, the
 *     seat — by id and by the name the customer heard;
 *   · the WINDOW, when the commitment has dates or times;
 *   · the PRICE and currency when money will move, in cents, never as a float;
 *   · the CONDITIONS that were read out — the deposit, the cancellation rule,
 *     the review step — because "you can cancel free until Friday" is part of
 *     what was agreed and changing it changes the agreement;
 *   · the CUSTOMER it is for, so a proposal cannot be replayed for somebody
 *     else;
 *   · the AUTHORITY that made it: which agent, at which revision, answering
 *     which inbound message.
 *
 * The hash covers all of it. That is the whole mechanism: the proposal is built
 * from the catalogue when it is shown, and built again from the catalogue when
 * the writer is about to run. If the two hashes differ, something the customer
 * was told is no longer true, and the confirmation they gave was for a different
 * thing. It does not matter which field moved.
 *
 * What this deliberately does NOT do is reconstruct a proposal from a row that
 * already exists. A price in a column is evidence that somebody computed it,
 * never evidence that a person agreed to it, and a family whose history predates
 * this contract has rows that need a human rather than a hash.
 */

export const COMMITMENT_ACTIONS = [
    'create', 'cancel', 'reschedule', 'quote', 'approve', 'update',
] as const;
export type CommitmentAction = (typeof COMMITMENT_ACTIONS)[number];

export interface CommitmentResource {
    /** `property`, `service`, `menu_item`, `vehicle`, `package`, `class`… */
    readonly kind: string;
    readonly id: string;
    /** The name the customer heard. A renamed resource is a changed proposal. */
    readonly name: string;
    readonly quantity?: number;
}

export interface CommitmentMoney {
    /** Cents, as a decimal string. Never a float: money and floats do not mix. */
    readonly amountCents: string;
    readonly currency: string;
    /** What must be paid to confirm, when that is less than the total. */
    readonly dueCents?: string | null;
}

export interface CommitmentAuthority {
    readonly agentId: string | null;
    readonly agentRevision: string | null;
    /** The customer message this proposal answers. Shared with writer and ledger. */
    readonly inboundMessageId: string | null;
}

export interface CommitmentProposal {
    readonly version: 1;
    /** A key of `EVAL_WRITER_SANDBOX_FAMILIES`. */
    readonly family: string;
    readonly action: CommitmentAction;
    readonly resources: readonly CommitmentResource[];
    readonly window: { readonly startAt: string; readonly endAt: string } | null;
    readonly price: CommitmentMoney | null;
    /** Codes, not prose: `deposit_required`, `free_cancellation_48h`, `pending_review`. */
    readonly conditions: readonly string[];
    readonly contactId: string;
    readonly authority: CommitmentAuthority;
}

/**
 * Stable across property order, and never stable across a change of terms.
 *
 * A proposal that fails validation hashes to `null` rather than to something:
 * an invalid proposal must not be comparable to anything, or a malformed one
 * would silently match another malformed one.
 */
export function commitmentProposalHash(proposal: unknown): string | null {
    if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return null;
    const value = proposal as CommitmentProposal;
    if (value.version !== 1) return null;
    if (typeof value.family !== 'string' || !value.family) return null;
    if (!COMMITMENT_ACTIONS.includes(value.action)) return null;
    if (typeof value.contactId !== 'string' || !value.contactId) return null;
    if (!Array.isArray(value.resources)) return null;
    for (const resource of value.resources) {
        if (!resource || typeof resource.kind !== 'string' || typeof resource.id !== 'string'
            || typeof resource.name !== 'string') return null;
        if (resource.quantity !== undefined
            && (!Number.isInteger(resource.quantity) || resource.quantity < 1)) return null;
    }
    if (value.window !== null) {
        if (!value.window || typeof value.window.startAt !== 'string' || typeof value.window.endAt !== 'string') return null;
    }
    if (value.price !== null) {
        if (!value.price || !/^\d+$/.test(String(value.price.amountCents))
            || !/^[A-Z]{3}$/.test(String(value.price.currency))) return null;
        if (value.price.dueCents !== undefined && value.price.dueCents !== null
            && !/^\d+$/.test(String(value.price.dueCents))) return null;
    }
    if (!Array.isArray(value.conditions) || value.conditions.some(item => typeof item !== 'string')) return null;
    if (!value.authority || typeof value.authority !== 'object') return null;

    // Ordered explicitly rather than by JSON.stringify of the object: a hash
    // that depends on key insertion order is a hash that changes when somebody
    // reorders a literal.
    return createHash('sha256').update(JSON.stringify([
        value.version, value.family, value.action,
        [...value.resources]
            .map(resource => [resource.kind, resource.id, resource.name, resource.quantity ?? null])
            .sort((a, b) => `${a[0]}|${a[1]}`.localeCompare(`${b[0]}|${b[1]}`)),
        value.window ? [value.window.startAt, value.window.endAt] : null,
        value.price ? [String(value.price.amountCents), String(value.price.currency),
            value.price.dueCents == null ? null : String(value.price.dueCents)] : null,
        [...value.conditions].sort(),
        value.contactId,
        [value.authority.agentId ?? null, value.authority.agentRevision ?? null,
            value.authority.inboundMessageId ?? null],
    ])).digest('hex');
}

/** Raised when the terms moved between showing them and writing the row. */
export class CommitmentTermsChangedError extends Error {
    readonly code = 'commitment_terms_changed';
    constructor(readonly family: string, readonly current: CommitmentProposal) {
        super('commitment_terms_changed');
    }
}

/**
 * The answer the agent must give the customer when terms move.
 *
 * It carries the CURRENT proposal, because the useful next sentence is "the
 * price went up to X, do you still want it?" and not "something changed".
 */
export function commitmentReviewResult(family: string, current: CommitmentProposal): Record<string, unknown> {
    return {
        error: 'commitment_terms_changed',
        family,
        persisted: false,
        retryable: false,
        requiresConfirmation: true,
        proposal: current,
        message: 'Los términos cambiaron desde que se los mostraste. Volvé a leer el detalle exacto '
            + '—recurso, fechas, precio, moneda y condiciones— y pedí una confirmación nueva. '
            + 'No se creó, canceló ni cobró nada.',
    };
}

/**
 * The durable record of a proposal a customer accepted.
 *
 * It is a table of its own rather than a column on each family's row for two
 * reasons. The first is that the eleven families have eleven different tables
 * and adding a JSONB column to each is eleven migrations and eleven chances to
 * get it wrong. The second is that the proposal exists BEFORE the row does: it
 * is shown, accepted, and only then does anything get written, so it cannot
 * live on a row that may never exist.
 */
export const COMMITMENT_PROPOSAL_DDL: readonly string[] = Object.freeze([
    `CREATE TABLE IF NOT EXISTS commitment_proposals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        proposal_hash TEXT NOT NULL,
        family TEXT NOT NULL,
        action TEXT NOT NULL,
        contact_id UUID NOT NULL,
        conversation_id UUID,
        inbound_message_id UUID,
        idempotency_key TEXT,
        proposal JSONB NOT NULL,
        amount_cents NUMERIC,
        currency TEXT,
        accepted_at TIMESTAMPTZ,
        /** The row this proposal turned into, once the writer produced one. */
        consumed_entity_id UUID,
        consumed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT commitment_proposals_action
            CHECK (action IN ('create','cancel','reschedule','quote','approve','update'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uidx_commitment_proposal_key
        ON commitment_proposals (idempotency_key) WHERE idempotency_key IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_commitment_proposal_entity
        ON commitment_proposals (consumed_entity_id) WHERE consumed_entity_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_commitment_proposal_contact
        ON commitment_proposals (contact_id)`,
]);

export type CommitmentQuery = <R = any[]>(sql: string, params?: any[]) => Promise<R>;

export async function ensureCommitmentProposals(query: CommitmentQuery): Promise<void> {
    for (const statement of COMMITMENT_PROPOSAL_DDL) await query(statement);
}

/**
 * The amount a charge may take for a row created from an accepted proposal.
 *
 * The shape every payable family uses, so the till reads the same thing
 * everywhere: the money the customer agreed to, or nothing. A row with no
 * accepted proposal yields NULL and stops being payable, which is the refusal
 * appointments and catalogue orders already make.
 */
export function commitmentAgreedAmountSql(entity = 'target'): string {
    if (!/^[a-z_]+$/.test(entity)) throw new Error('invalid_sql_alias');
    return `(SELECT p.amount_cents / 100 FROM commitment_proposals p
              WHERE p.consumed_entity_id = ${entity}.id AND p.accepted_at IS NOT NULL
                AND p.amount_cents IS NOT NULL
              ORDER BY p.accepted_at DESC LIMIT 1)`;
}

export function commitmentAgreedCurrencySql(entity = 'target'): string {
    if (!/^[a-z_]+$/.test(entity)) throw new Error('invalid_sql_alias');
    return `(SELECT p.currency FROM commitment_proposals p
              WHERE p.consumed_entity_id = ${entity}.id AND p.accepted_at IS NOT NULL
                AND p.amount_cents IS NOT NULL
              ORDER BY p.accepted_at DESC LIMIT 1)`;
}

/**
 * Live rows of one payable family with no accepted proposal behind them.
 *
 * The dry run every family needs before this ships: they stop being payable the
 * moment the charge starts reading the proposal, and somebody has to know how
 * many there are first.
 */
export function commitmentOrphansSql(table: string, liveStates: readonly string[]): string {
    if (!/^[a-z_]+$/.test(table)) throw new Error('invalid_sql_table');
    if (liveStates.some(state => !/^[a-z_]+$/.test(state))) throw new Error('invalid_sql_state');
    const states = liveStates.map(state => `'${state}'`).join(', ');
    return `SELECT count(*)::int AS orphans FROM ${table} target
             WHERE NOT EXISTS (
                 SELECT 1 FROM commitment_proposals p
                  WHERE p.consumed_entity_id = target.id AND p.accepted_at IS NOT NULL)
               AND target.status NOT IN (${states})`;
}
