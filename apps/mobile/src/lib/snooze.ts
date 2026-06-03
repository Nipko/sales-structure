export type SnoozePreset = '1h' | '3h' | 'tomorrow' | 'nextWeek';

/** Compute the absolute time to snooze until for a given preset. `now` is injectable for tests. */
export function snoozeUntil(preset: SnoozePreset, now: Date = new Date()): Date {
    const d = new Date(now.getTime());
    switch (preset) {
        case '1h': d.setHours(d.getHours() + 1); break;
        case '3h': d.setHours(d.getHours() + 3); break;
        case 'tomorrow': d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); break;
        case 'nextWeek': d.setDate(d.getDate() + 7); d.setHours(9, 0, 0, 0); break;
    }
    return d;
}

export const SNOOZE_PRESETS: { key: SnoozePreset; labelKey: string }[] = [
    { key: '1h', labelKey: 'conv.snooze1h' },
    { key: '3h', labelKey: 'conv.snooze3h' },
    { key: 'tomorrow', labelKey: 'conv.snoozeTomorrow' },
    { key: 'nextWeek', labelKey: 'conv.snoozeNextWeek' },
];
