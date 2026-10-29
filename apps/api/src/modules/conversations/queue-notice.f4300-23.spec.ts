import { QUEUE_NOTICE_CUTOFF_MINUTES, queueNoticeDue } from './queue-notice';
import { UNATTENDED_HANDOFF_MINUTES } from '../handoff/handoff.service';

/**
 * F4300-23 (production QA 29-oct): «sigue en espera» and, a minute later, «no hay nadie del equipo disponible; sigo ayudándole yo»
 * — the queue notice went out when the unattended return was due.
 */
describe('F4300-23 · no queue notice when the unattended return is about to answer', () => {
    const now = new Date('2026-10-29T01:00:00Z');
    const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

    it('the cutoff is before the return threshold', () => {
        expect(QUEUE_NOTICE_CUTOFF_MINUTES).toBeLessThan(UNATTENDED_HANDOFF_MINUTES);
        expect(QUEUE_NOTICE_CUTOFF_MINUTES).toBeGreaterThan(0);
    });

    it.each([[0.5, true], [3, true], [QUEUE_NOTICE_CUTOFF_MINUTES - 0.1, true], [QUEUE_NOTICE_CUTOFF_MINUTES, false], [9.5, false], [14, false]])(
        'handoff started %s min ago → notice %s', (minutes, due) => {
            expect(queueNoticeDue(ago(minutes as number), now)).toBe(due);
        });

    it('no handoff start: no notice; an unreadable start keeps the notice', () => {
        expect(queueNoticeDue(undefined, now)).toBe(false);
        expect(queueNoticeDue('not a date', now)).toBe(true);
    });
});
