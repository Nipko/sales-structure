/**
 * ═══ A METER THAT CANNOT ANSWER DOES NOT GRANT PERMISSION ═══
 *
 * Every failure inside the money authority used to end in `return null`, and
 * every caller read `null` as "no gate wired — carry on". So a schema that could
 * not be resolved, a database that was briefly unreachable, or a module that
 * simply had not been imported all produced the same thing: a WhatsApp message
 * on a customer's phone, a charge on the business's account, and no record that
 * either happened.
 *
 * That is the worst failure mode this system has. A refused send is visible and
 * recoverable; an unmeasured one is neither, and it is unmeasured precisely when
 * something is already wrong.
 *
 * So an unavailable meter DEFERS. The effect is not sent and not lost: the
 * durable row stays claimable, the job retries with backoff, and an operator is
 * told. The customer waits seconds; nobody is billed for a message nothing
 * counted.
 *
 * ── WHY THIS IS AN ERROR AND NOT A RETURN VALUE ─────────────────────────────
 *
 * Because a return value can be ignored, and this one was — thirteen call sites
 * read `null` and carried on. An exception cannot be ignored by accident: a
 * caller either handles it deliberately or the effect defers, which is the safe
 * direction.
 */
export class SpendMeterUnavailable extends Error {
    constructor(
        /** What could not be reached, in terms an operator can act on. */
        readonly detail: string,
        readonly cause?: unknown,
    ) {
        super(`spend_meter_unavailable: ${detail}`);
        this.name = 'SpendMeterUnavailable';
    }
}

/** Is this the one error that means "defer, do not send"? */
export function isMeterUnavailable(error: unknown): error is SpendMeterUnavailable {
    return error instanceof SpendMeterUnavailable;
}

/**
 * Inbound is never held hostage to the meter.
 *
 * Stated here because it is the half people forget: a customer writing to the
 * business must still be received, recorded and shown to a human whatever the
 * spend authority is doing. Only the CHARGEABLE OUTBOUND defers. A platform
 * that stopped listening because it could not count would turn a billing
 * problem into a lost customer.
 */
export const METER_NEVER_BLOCKS_INBOUND = true;
