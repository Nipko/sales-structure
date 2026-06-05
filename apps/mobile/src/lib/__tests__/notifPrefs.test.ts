/**
 * Tests for notifPrefs — el foco son los rangos de DND (especialmente OVERNIGHT,
 * ej. 22:00→08:00, donde la lógica cruza la medianoche) y el gating por categoría.
 */
jest.mock('expo-secure-store', () => ({
    getItemAsync: jest.fn(),
    setItemAsync: jest.fn(),
    deleteItemAsync: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { getNotifPrefs, isDndActive, NOTIF_DEFAULTS, NotifPrefs } from '../notifPrefs';

const mockStored = (prefs: Partial<NotifPrefs> | null) => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(prefs ? JSON.stringify(prefs) : null);
};

afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
});

describe('getNotifPrefs', () => {
    it('returns defaults when nothing is stored', async () => {
        mockStored(null);
        const p = await getNotifPrefs();
        expect(p).toEqual(NOTIF_DEFAULTS);
    });

    it('merges stored partial over defaults (categories deep-merged)', async () => {
        mockStored({ dndEnabled: true, categories: { sla: false } as any });
        const p = await getNotifPrefs();
        expect(p.dndEnabled).toBe(true);
        expect(p.categories.sla).toBe(false);      // overridden
        expect(p.categories.handoff).toBe(true);    // from defaults
    });

    it('falls back to defaults on corrupt JSON', async () => {
        (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('{not valid json');
        const p = await getNotifPrefs();
        expect(p.dndEnabled).toBe(false);
        expect(p.categories.handoff).toBe(true);
    });
});

describe('isDndActive — category gating', () => {
    it('suppresses a disabled category even when DND is off', async () => {
        mockStored({ dndEnabled: false, categories: { sla: false } as any });
        expect(await isDndActive('sla')).toBe(true);
    });

    it('does NOT suppress an enabled category when DND is off', async () => {
        mockStored({ dndEnabled: false });
        expect(await isDndActive('handoff')).toBe(false);
    });
});

describe('isDndActive — overnight range 22:00 → 08:00', () => {
    const overnight = { dndEnabled: true, dndStart: '22:00', dndEnd: '08:00' };

    it('is active at 23:30 (after start, before midnight)', async () => {
        mockStored(overnight);
        jest.useFakeTimers().setSystemTime(new Date(2026, 5, 5, 23, 30, 0));
        expect(await isDndActive()).toBe(true);
    });

    it('is active at 02:00 (after midnight, before end)', async () => {
        mockStored(overnight);
        jest.useFakeTimers().setSystemTime(new Date(2026, 5, 5, 2, 0, 0));
        expect(await isDndActive()).toBe(true);
    });

    it('is INACTIVE at 09:00 (after end)', async () => {
        mockStored(overnight);
        jest.useFakeTimers().setSystemTime(new Date(2026, 5, 5, 9, 0, 0));
        expect(await isDndActive()).toBe(false);
    });

    it('is INACTIVE at 12:00 (mid-day)', async () => {
        mockStored(overnight);
        jest.useFakeTimers().setSystemTime(new Date(2026, 5, 5, 12, 0, 0));
        expect(await isDndActive()).toBe(false);
    });
});

describe('isDndActive — same-day range 09:00 → 17:00', () => {
    const sameDay = { dndEnabled: true, dndStart: '09:00', dndEnd: '17:00' };

    it('is active at 12:00 (inside)', async () => {
        mockStored(sameDay);
        jest.useFakeTimers().setSystemTime(new Date(2026, 5, 5, 12, 0, 0));
        expect(await isDndActive()).toBe(true);
    });

    it('is INACTIVE at 20:00 (after end)', async () => {
        mockStored(sameDay);
        jest.useFakeTimers().setSystemTime(new Date(2026, 5, 5, 20, 0, 0));
        expect(await isDndActive()).toBe(false);
    });

    it('is INACTIVE at 08:59 (just before start)', async () => {
        mockStored(sameDay);
        jest.useFakeTimers().setSystemTime(new Date(2026, 5, 5, 8, 59, 0));
        expect(await isDndActive()).toBe(false);
    });
});
