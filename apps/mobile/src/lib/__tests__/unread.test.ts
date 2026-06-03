import { setUnreadTotal, getUnreadTotal, subscribeUnread } from '../unread';

describe('unread store', () => {
    beforeEach(() => setUnreadTotal(0));

    it('stores and reads the total', () => {
        setUnreadTotal(5);
        expect(getUnreadTotal()).toBe(5);
    });

    it('clamps negatives and floors decimals to a non-negative integer', () => {
        setUnreadTotal(-3);
        expect(getUnreadTotal()).toBe(0);
        setUnreadTotal(4.9);
        expect(getUnreadTotal()).toBe(4);
    });

    it('notifies subscribers only when the value actually changes', () => {
        const seen: number[] = [];
        const unsub = subscribeUnread((n) => seen.push(n));
        setUnreadTotal(2);
        setUnreadTotal(2); // no-op: same value
        setUnreadTotal(7);
        unsub();
        setUnreadTotal(9); // ignored after unsubscribe
        expect(seen).toEqual([2, 7]);
        expect(getUnreadTotal()).toBe(9);
    });
});
