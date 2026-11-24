import { EvaluationRevisionService } from '../evaluation-revision.service';

/**
 * `EvaluationRevisionService` with a clock that is always past the freshness window.
 *
 * `assertCurrent` may reuse a capture that started up to 2 s ago (ADR 0021). A suite that edits a table and
 * verifies in the same instant would then be answered by the capture of the PREVIOUS test, and the edit would
 * go unseen. Every reading of this clock is later than the window, so each verification captures again.
 *
 * For suites whose subject is what a capture measures. The window itself is covered by the unit specs of the
 * service, with the real clock.
 */
export class UnwindowedRevisionService extends EvaluationRevisionService {
    private clock = 0;
    protected now(): number { return this.clock += EvaluationRevisionService.FRESHNESS_WINDOW_MS + 1; }
}
