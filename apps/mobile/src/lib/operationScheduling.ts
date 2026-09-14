export interface ScheduledTransitionPayload {
    status: 'scheduled';
    scheduledAt: string;
}

export interface HomeServiceOption {
    id: string;
    name: string;
    category: string;
    durationMinutes: number;
}

/** Match the API capacity predicate: active catalog service with a duration. */
export function readHomeServices(response: any): HomeServiceOption[] {
    if (!response?.success || !Array.isArray(response.data)) throw new Error('home_service_catalog_unavailable');
    return response.data.filter((service: any) => service?.isActive === true
        && typeof service.id === 'string' && service.id.length > 0
        && typeof service.name === 'string' && service.name.trim()
        && Number.isInteger(service.durationMinutes) && service.durationMinutes > 0)
        .map((service: any) => ({ id: service.id, name: service.name,
            category: service.category || 'otro', durationMinutes: service.durationMinutes }));
}

export function buildHomeServiceSchedule(
    dateValue: string,
    timeValue: string,
    serviceId: string,
    services: readonly HomeServiceOption[],
): (ScheduledTransitionPayload & { serviceId: string }) | null {
    const scheduled = buildScheduledTransition(dateValue, timeValue);
    return scheduled && services.some(service => service.id === serviceId)
        ? { ...scheduled, serviceId } : null;
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
