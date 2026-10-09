/**
 * A fixed «now» for a spec whose appointments, dates and expectations are written against a calendar.
 *
 * `ConversationsService.test` (and the engines under it) read the real clock for «today»: `conversations.service.ts` builds
 * `const now = new Date()` for every turn, and the reschedule / cancel engine refuses a day that has gone by and an appointment that
 * has started. A spec that books «2026-10-12» and expects it to be ahead is green only until that day arrives, then red in CI for no
 * reason that has to do with the code (PR #82 final check).
 *
 * Only the DATE is faked: timers, microtasks and `process.nextTick` stay real, so the asynchronous pipeline runs as it does in
 * production. The pinned instant is Friday 2026-10-09 10:00 in Bogotá, the day the scenarios of these specs were written for.
 *
 * Usage, at the top of the spec file (it registers its own beforeAll / afterAll):  `pinClock();`
 */
export const PINNED_NOW = '2026-10-09T15:00:00.000Z';

const REAL_TIMERS_AND_QUEUES = [
    'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback',
    'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
] as const;

export function pinClock(now: string = PINNED_NOW): void {
    beforeAll(() => { jest.useFakeTimers({ now: new Date(now), doNotFake: [...REAL_TIMERS_AND_QUEUES] }); });
    afterAll(() => { jest.useRealTimers(); });
}
