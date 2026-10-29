import { UNATTENDED_HANDOFF_MINUTES } from '../handoff/handoff.service';

/**
 * F4300-23 (production QA 27–29-oct, dental and other tenants): a customer who writes into an unattended handoff close to the return
 * got «Su solicitud sigue en espera; alguien del equipo le responderá…» and, a minute later, «En este momento no hay nadie del equipo
 * disponible; sigo ayudándole yo.» with the answer — two notices that contradict each other, read together.
 *
 * The queue notice is worth sending only while the wait has a real way to go. From two minutes before the return threshold the
 * per-minute sweep is about to give the conversation back to the agent, whose return notice and answer are the reply.
 */
export const QUEUE_NOTICE_CUTOFF_MINUTES = UNATTENDED_HANDOFF_MINUTES - 2;

export function queueNoticeDue(handoffStartedAt: string | Date | undefined | null, now: Date = new Date()): boolean {
    if (!handoffStartedAt) return false;
    const started = new Date(handoffStartedAt).getTime();
    if (!Number.isFinite(started)) return true;
    return now.getTime() - started < QUEUE_NOTICE_CUTOFF_MINUTES * 60_000;
}
