export interface ScheduledTransitionPayload {
    status: 'scheduled';
    scheduledAt: string;
}

export function validScheduleInput(dateValue: string, timeValue: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return false;
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(timeValue)) return false;
    const [year, month, day] = dateValue.split('-').map(Number);
    const parsed = new Date(year, month - 1, day);
    return parsed.getFullYear() === year
        && parsed.getMonth() === month - 1
        && parsed.getDate() === day;
}

/** Status and wall-clock timestamp are one indivisible scheduling command. */
export function buildScheduledTransition(
    dateValue: string,
    timeValue: string,
): ScheduledTransitionPayload | null {
    if (!validScheduleInput(dateValue, timeValue)) return null;
    return {
        status: 'scheduled',
        // Tenant-local TIMESTAMP: a UTC conversion would shift the chosen time.
        scheduledAt: `${dateValue}T${timeValue}:00`,
    };
}
