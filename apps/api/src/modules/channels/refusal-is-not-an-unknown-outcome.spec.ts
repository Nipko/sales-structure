import { readFileSync } from 'fs';
import { resolve } from 'path';
import { deliveryOutcome } from './delivery-outcome';

/**
 * ═══ A MESSAGE WE REFUSED IS NOT A MESSAGE THAT MIGHT HAVE ARRIVED ═══
 *
 * Both durable lanes that are not the dispatch outbox closed a failed delivery
 * by reading one boolean, `started`, set immediately BEFORE the send closure
 * runs. It is a proxy for "a request may have left, so we cannot say what the
 * customer got".
 *
 * The spend gate lives INSIDE that closure. So a refusal — a decision this
 * platform made before addressing anybody — arrived with `started` already
 * true, and the row closed `reconciliation_required` with the code
 * `delivery_outcome_unknown`. Both lanes' recovery queries EXCLUDE that state,
 * by design: a row that might have reached a phone must not be re-sent by a
 * sweep.
 *
 * So an effect nobody sent was filed as one that might have arrived, and then
 * nothing looked at it again. Not lost in the ordinary sense — removed from
 * every mechanism that could have noticed it was missing.
 *
 * ── WHY THESE CASES DRIVE THE REAL FUNCTION ─────────────────────────────────
 *
 * The first version of this file re-implemented each lane's conditional and
 * asserted against the copy. Every case passed with the defect restored,
 * because the copy was correct and nothing connected it to what ships — the
 * "test that agrees with itself" this repository has been bitten by before.
 *
 * So the rule now lives in ONE function that both lanes call, and these cases
 * drive it. That also removes the second copy, which is what let the two lanes
 * hold the same defect while either could have been fixed alone.
 */
describe('the state a refusal is recorded in', () => {
    it('records a delivery WE refused as suppressed, even after the proxy is set', () => {
        // `started` is true because the gate sits inside the closure it guards.
        // That is precisely the condition under which this went wrong.
        expect(deliveryOutcome({ started: true, refused: true }))
            .toEqual({ state: 'suppressed', reason: 'refused' });
    });

    it('still says OUTCOME UNKNOWN when a request really may have left', () => {
        // The half that must not move. A provider error after the POST is a
        // genuine unknown: the customer may well have the message, and
        // re-sending it is the duplicate the whole outbox exists to prevent.
        expect(deliveryOutcome({ started: true, refused: false }))
            .toEqual({ state: 'reconciliation_required', reason: 'outcome_unknown' });
    });

    it('still says FAILED when nothing started and nothing refused it', () => {
        // Retryable, and the only one of the three that is.
        expect(deliveryOutcome({ started: false, refused: false }))
            .toEqual({ state: 'failed', reason: 'preflight_failed' });
    });

    it('treats a refusal before the closure exactly like one inside it', () => {
        // Where the gate happens to sit must not change what is recorded. It
        // moved once already — that is how this defect was introduced.
        expect(deliveryOutcome({ started: false, refused: true }).state)
            .toBe(deliveryOutcome({ started: true, refused: true }).state);
    });

    it('is the rule BOTH lanes call, not a rule one of them reimplements', () => {
        // The two lanes held the identical defect, and each could have been
        // fixed without the other. A second copy of a rule is the mechanism by
        // which that happens, so the absence of one is the property worth
        // pinning — a re-inlined conditional goes red here.
        const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');

        const approval = read('../conversations/tool-approval-effects.service.ts');
        expect(approval).toContain('deliveryOutcome({ started, refused: suppressed })');
        expect(approval).not.toMatch(/started \? 'reconciliation_required'/);

        const notice = read('../operational-notices/operational-notice.service.ts');
        expect(notice).toContain('deliveryOutcome({started,refused})');
        expect(notice).not.toMatch(/started\?'reconciliation_required'/);
    });

    it('reaches that rule at all, because the notice lane THROWS its refusal', () => {
        // The typed branch is unreachable if the gate returns `null`: the lane
        // then raises `notice_provider_no_receipt`, which is not a refusal and
        // lands back on the proxy. This is the edit that connects the two.
        const processor = read('./outbound-queue.processor.ts');
        expect(processor).toContain("throw new NoticeSuppressed('spend_refused')");
        expect(processor).toContain("throw new NoticeSuppressed('transmission_not_owned')");
    });
});

function read(rel: string): string {
    return readFileSync(resolve(__dirname, rel), 'utf8');
}
