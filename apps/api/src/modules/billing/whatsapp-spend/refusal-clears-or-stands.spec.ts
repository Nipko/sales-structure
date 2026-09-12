import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
    SPEND_BLOCK_CODES, TRANSIENT_SPEND_BLOCKS, refusalMayClear, spendBlock,
    type SpendBlockCode,
} from './spend-diagnosis';

/**
 * ═══ WHICH REFUSALS DELAY A MESSAGE AND WHICH ONES DELETE IT ═══
 *
 * On the durable lane a refusal settled `suppressed` is terminal: the row is
 * closed, the payload is dropped, `producerMayAdvance` returns true and the
 * producer writes its "sent" flag. Settled `failed` it is retryable, the
 * payload is kept, and the durable backoff decides when to look again.
 *
 * So this classification is the difference between a customer's order
 * confirmation arriving late and never arriving at all, and it was being made
 * by omission: everything not named transient was suppressed.
 *
 * Two of those omissions were wrong in a way the source itself admits. The
 * admission service refuses an unpriceable effect with the comment *"the effect
 * is DEFERRED rather than sent unpriced"* (`currency_unknown`) and *"Deferred,
 * not sent unpriced"* (`category_unknown`) — and the lane then deleted it. A
 * WhatsApp account whose billing currency we do not hold a rate card for, or a
 * template whose Meta approval has not synced yet, are configuration states
 * that clear on their own; `channel_accounts.waba_timezone` is nullable with a
 * best-effort backfill, so `timezone_missing` can be the standing state of a
 * real account. Under enforcement, every durable message from that number was
 * being destroyed rather than held.
 *
 * ── WHY THIS IS A TABLE AND NOT A LIST ──────────────────────────────────────
 *
 * Every code carries its reason here, and the test fails when a code is added
 * to `SPEND_BLOCK_CODES` without one. A list can be extended silently; a total
 * function over the codes cannot. The reason matters more than the verdict: the
 * next person to add a code has to answer "does this condition clear by
 * itself?" in writing.
 */

/** For every code: does the condition clear without a new decision, and why. */
const CLEARS: Readonly<Record<SpendBlockCode, { readonly clears: boolean; readonly why: string }>> =
    Object.freeze({
        account_paused: { clears: true, why: 'Meta refused to bill; clears when funding is fixed' },
        account_pause_unknown: { clears: true, why: 'the pause store did not answer; clears on the next read' },
        funding_not_ready: { clears: true, why: 'no payment method; clears when a card is attached' },
        connection_unusable: { clears: true, why: 'the credential is unreadable; clears when repaired' },
        transmission_held_elsewhere: { clears: true, why: 'another worker holds the right right now' },
        timezone_missing: { clears: true, why: 'a nullable column an admin can set at any moment' },
        payer_unknown: { clears: true, why: 'clears on a reconnect through Embedded Signup' },
        currency_unknown: { clears: true, why: 'clears when a rate card covers that currency' },
        category_unknown: { clears: true, why: 'clears when the template approval syncs' },
        rate_unknown: { clears: true, why: 'clears when the published rate card covers the market' },
        counter_currency_mismatch: { clears: true, why: 'clears when somebody settles the period currency' },

        cap_exhausted: { clears: false, why: 'a ceiling is a decision; it does not soften by asking again' },
        cap_soft_stop: { clears: false, why: 'campaigns stand down on purpose so replies keep working' },
        task_budget_exhausted: { clears: false, why: 'the campaign was given a budget and it is spent' },
        market_unknown: { clears: false, why: 'the destination cannot be identified from the number; retrying reads the same number' },
        duplicate_recent_send: {
            clears: false,
            why: 'the customer already has this exact sentence from this number. Retrying after '
                + 'the cooldown delivers the duplicate the guard exists to prevent',
        },
        effect_already_resolved: { clears: false, why: 'this effect already had its outcome' },
        transmission_outcome_unknown: { clears: false, why: 'a POST may have landed; a retry could be a second message' },
        effect_identity_missing: {
            clears: false,
            why: 'a producer defect that no waiting repairs. It is unreachable from the durable '
                + 'lane, where every row carries a dispatch item id, so suppressing it closes a '
                + 'legacy queue job rather than deleting a committed effect',
        },
    });

describe('a condition that clears is not a decision that stands', () => {
    it('has an answer, in writing, for every block code', () => {
        // A total function over the codes. Adding one to `SPEND_BLOCK_CODES`
        // without deciding this question fails here rather than defaulting to
        // "delete the message".
        expect(Object.keys(CLEARS).slice().sort()).toEqual([...SPEND_BLOCK_CODES].slice().sort());
        for (const [code, entry] of Object.entries(CLEARS)) {
            expect({ code, explained: entry.why.length > 25 }).toEqual({ code, explained: true });
        }
    });

    it('classifies each one the way the table says', () => {
        for (const code of SPEND_BLOCK_CODES) {
            expect({ code, transient: refusalMayClear(code) })
                .toEqual({ code, transient: CLEARS[code].clears });
        }
    });

    it('keeps the exported list and the predicate in step', () => {
        expect([...TRANSIENT_SPEND_BLOCKS].slice().sort())
            .toEqual(SPEND_BLOCK_CODES.filter(code => CLEARS[code].clears).slice().sort());
        expect(refusalMayClear(null)).toBe(false);
        expect(refusalMayClear('something_nobody_defined')).toBe(false);
    });

    it('agrees with what the admission service says it is doing', () => {
        // The source called these DEFERRED while the lane deleted them. If that
        // word is still there, the code it describes has to be retryable — the
        // comment and the consequence cannot disagree again without failing.
        const admission = readFileSync(
            resolve(__dirname, 'whatsapp-send-admission.service.ts'), 'utf8');
        for (const [code, marker] of [
            ['currency_unknown', 'the effect is DEFERRED rather than sent'],
            ['category_unknown', 'Deferred, not sent unpriced'],
        ] as const) {
            expect({ code, said: admission.includes(marker) }).toEqual({ code, said: true });
            expect({ code, retryable: refusalMayClear(code) }).toEqual({ code, retryable: true });
        }
    });

    it('still tells an operator what to do, whichever way it settles', () => {
        // Retryable must not mean silent. Every transient code keeps a
        // resolution sentence, because "it will clear by itself" is only true
        // if somebody is told what has to change.
        for (const code of TRANSIENT_SPEND_BLOCKS) {
            const block = spendBlock(code, 'detail');
            expect({ code, hasResolution: String(block.resolution || '').length > 25 })
                .toEqual({ code, hasResolution: true });
        }
    });
});
