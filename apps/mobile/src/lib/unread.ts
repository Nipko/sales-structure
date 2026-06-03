/**
 * Tiny global store for the total unread count, so the Inbox tab can show a badge
 * without the InboxScreen (which owns the data) and the RootNavigator (which owns
 * the tabs) sharing a parent. InboxScreen publishes on every load; the tab subscribes.
 *
 * Same subscribe pattern as `outbox` — no external state lib needed.
 */
let total = 0;
const listeners = new Set<(n: number) => void>();

export function setUnreadTotal(n: number) {
    const next = Math.max(0, Math.floor(n || 0));
    if (next === total) return;
    total = next;
    listeners.forEach((cb) => cb(total));
}

export function getUnreadTotal(): number {
    return total;
}

export function subscribeUnread(cb: (n: number) => void): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
}
