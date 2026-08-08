import { BadRequestException, Injectable } from '@nestjs/common';

export type TemporalCapacityContract =
    | AppointmentTemporalContract
    | NightlyTemporalContract
    | DayCapacityTemporalContract
    | SessionTemporalContract
    | ResourceTemporalContract;

export interface AppointmentTemporalContract {
    kind: 'appointment';
    /** Tenant-local wall clock, deliberately separate from an instant. */
    startsAtLocal: string;
    timezone: string;
    durationMinutes: number;
    bufferMinutes?: number;
}

export interface NightlyTemporalContract {
    kind: 'nightly';
    checkInDate: string;
    checkOutDate: string;
    nights?: number;
    minNights?: number;
    maxNights?: number;
}

export interface DayCapacityTemporalContract {
    kind: 'day_capacity';
    date: string;
    capacity: number;
    reserved: number;
}

export interface SessionTemporalContract {
    kind: 'session';
    startsAt: string;
    endsAt: string;
    capacity: number;
    booked: number;
}

export interface ResourceTemporalContract {
    kind: 'resource';
    resourceId: string;
    startsAt: string;
    endsAt: string;
    units: number;
    exclusive: boolean;
}

export interface NormalizedAppointmentTemporal extends AppointmentTemporalContract {
    bufferMinutes: number;
    endsAtLocal: string;
}

export interface NormalizedNightlyTemporal extends NightlyTemporalContract {
    nights: number;
}

export type NormalizedTemporalCapacityContract =
    | NormalizedAppointmentTemporal
    | NormalizedNightlyTemporal
    | DayCapacityTemporalContract
    | SessionTemporalContract
    | ResourceTemporalContract;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const TIMEZONE_PATTERN = /^(?:UTC|[A-Za-z_]+\/[A-Za-z0-9_+.-]+(?:\/[A-Za-z0-9_+.-]+)?)$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_APPOINTMENT_MINUTES = 24 * 60;
const MAX_DATE_RANGE_DAYS = 3660;
const MAX_CAPACITY = 1_000_000;

/**
 * Discriminated temporal contract. No kind is coerced into appointment minutes:
 * nights remain date ranges, daycare remains day capacity, sessions keep seats,
 * and resources keep exclusion semantics.
 */
@Injectable()
export class TemporalCapacityContractService {
    normalize(input: TemporalCapacityContract): NormalizedTemporalCapacityContract {
        if (!input || typeof input !== 'object') {
            throw new BadRequestException('temporal contract is required');
        }
        switch (input.kind) {
            case 'appointment': return this.normalizeAppointment(input);
            case 'nightly': return this.normalizeNightly(input);
            case 'day_capacity': return this.normalizeDayCapacity(input);
            case 'session': return this.normalizeSession(input);
            case 'resource': return this.normalizeResource(input);
            default:
                throw new BadRequestException('Unknown temporal contract kind');
        }
    }

    remainingCapacity(input: DayCapacityTemporalContract | SessionTemporalContract): number {
        const normalized = this.normalize(input) as DayCapacityTemporalContract | SessionTemporalContract;
        const used = normalized.kind === 'session' ? normalized.booked : normalized.reserved;
        return normalized.capacity - used;
    }

    /** Half-open overlap: touching boundaries do not conflict. */
    resourcesOverlap(left: ResourceTemporalContract, right: ResourceTemporalContract): boolean {
        const a = this.normalize(left) as ResourceTemporalContract;
        const b = this.normalize(right) as ResourceTemporalContract;
        if (a.resourceId !== b.resourceId) return false;
        if (!a.exclusive && !b.exclusive) return false;
        return Date.parse(a.startsAt) < Date.parse(b.endsAt)
            && Date.parse(a.endsAt) > Date.parse(b.startsAt);
    }

    /**
     * Legacy `open` is ambiguous and cannot silently become a 30/60 minute slot.
     * Callers must explicitly select the target commercial model.
     */
    fromLegacyService(input: {
        durationType?: string | null;
        durationMinutes?: number | null;
        startsAtLocal: string;
        timezone: string;
    }): NormalizedAppointmentTemporal {
        const durationType = input.durationType || 'fixed';
        if (durationType === 'open') {
            throw new BadRequestException({
                error: 'ambiguous_legacy_open_duration',
                message: 'Map the service explicitly to nightly, day_capacity, session, or resource.',
            });
        }
        return this.normalize({
            kind: 'appointment',
            startsAtLocal: input.startsAtLocal,
            timezone: input.timezone,
            durationMinutes: input.durationMinutes || 0,
        }) as NormalizedAppointmentTemporal;
    }

    private normalizeAppointment(input: AppointmentTemporalContract): NormalizedAppointmentTemporal {
        this.assertLocalDateTime(input.startsAtLocal, 'startsAtLocal');
        if (!TIMEZONE_PATTERN.test(input.timezone || '')) {
            throw new BadRequestException('timezone must be an IANA timezone');
        }
        try {
            new Intl.DateTimeFormat('en', { timeZone: input.timezone }).format(new Date(0));
        } catch {
            throw new BadRequestException('timezone must be a valid IANA timezone');
        }
        this.assertIntegerRange(input.durationMinutes, 'durationMinutes', 1, MAX_APPOINTMENT_MINUTES);
        const buffer = input.bufferMinutes ?? 0;
        this.assertIntegerRange(buffer, 'bufferMinutes', 0, MAX_APPOINTMENT_MINUTES);

        const startsAtLocal = input.startsAtLocal.length === 16
            ? `${input.startsAtLocal}:00`
            : input.startsAtLocal;
        const parsed = this.parseLocalAsUtc(startsAtLocal);
        parsed.setUTCMinutes(parsed.getUTCMinutes() + input.durationMinutes);
        return {
            ...input,
            startsAtLocal,
            bufferMinutes: buffer,
            endsAtLocal: this.formatLocal(parsed),
        };
    }

    private normalizeNightly(input: NightlyTemporalContract): NormalizedNightlyTemporal {
        const start = this.parseDate(input.checkInDate, 'checkInDate');
        const end = this.parseDate(input.checkOutDate, 'checkOutDate');
        const nights = Math.round((end.getTime() - start.getTime()) / 86_400_000);
        if (nights < 1 || nights > MAX_DATE_RANGE_DAYS) {
            throw new BadRequestException(`nightly range must contain 1-${MAX_DATE_RANGE_DAYS} nights`);
        }
        if (input.nights !== undefined && input.nights !== nights) {
            throw new BadRequestException({
                error: 'night_count_mismatch',
                expected: nights,
                provided: input.nights,
            });
        }
        const minNights = input.minNights ?? 1;
        const maxNights = input.maxNights ?? MAX_DATE_RANGE_DAYS;
        this.assertIntegerRange(minNights, 'minNights', 1, MAX_DATE_RANGE_DAYS);
        this.assertIntegerRange(maxNights, 'maxNights', minNights, MAX_DATE_RANGE_DAYS);
        if (nights < minNights || nights > maxNights) {
            throw new BadRequestException('nightly range violates minNights/maxNights');
        }
        return { ...input, checkInDate: this.formatDate(start), checkOutDate: this.formatDate(end), nights };
    }

    private normalizeDayCapacity(input: DayCapacityTemporalContract): DayCapacityTemporalContract {
        const date = this.parseDate(input.date, 'date');
        this.assertIntegerRange(input.capacity, 'capacity', 1, MAX_CAPACITY);
        this.assertIntegerRange(input.reserved, 'reserved', 0, input.capacity);
        return { ...input, date: this.formatDate(date) };
    }

    private normalizeSession(input: SessionTemporalContract): SessionTemporalContract {
        const startsAt = this.parseInstant(input.startsAt, 'startsAt');
        const endsAt = this.parseInstant(input.endsAt, 'endsAt');
        if (endsAt.getTime() <= startsAt.getTime()) {
            throw new BadRequestException('session endsAt must be after startsAt');
        }
        this.assertIntegerRange(input.capacity, 'capacity', 1, MAX_CAPACITY);
        this.assertIntegerRange(input.booked, 'booked', 0, input.capacity);
        return { ...input, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
    }

    private normalizeResource(input: ResourceTemporalContract): ResourceTemporalContract {
        if (!UUID_PATTERN.test(input.resourceId || '')) {
            throw new BadRequestException('resourceId must be a UUID');
        }
        const startsAt = this.parseInstant(input.startsAt, 'startsAt');
        const endsAt = this.parseInstant(input.endsAt, 'endsAt');
        if (endsAt.getTime() <= startsAt.getTime()) {
            throw new BadRequestException('resource endsAt must be after startsAt');
        }
        this.assertIntegerRange(input.units, 'units', 1, MAX_CAPACITY);
        if (typeof input.exclusive !== 'boolean') {
            throw new BadRequestException('exclusive must be boolean');
        }
        if (input.exclusive && input.units !== 1) {
            throw new BadRequestException('exclusive resource reservations must use exactly one unit');
        }
        return { ...input, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
    }

    private parseDate(value: string, field: string): Date {
        if (!DATE_PATTERN.test(value || '')) throw new BadRequestException(`${field} must use YYYY-MM-DD`);
        const parsed = new Date(`${value}T00:00:00Z`);
        if (Number.isNaN(parsed.getTime()) || this.formatDate(parsed) !== value) {
            throw new BadRequestException(`${field} must be a valid calendar date`);
        }
        return parsed;
    }

    private assertLocalDateTime(value: string, field: string): void {
        if (!LOCAL_DATE_TIME_PATTERN.test(value || '')) {
            throw new BadRequestException(`${field} must be a timezone-neutral local date-time`);
        }
        const canonical = value.length === 16 ? `${value}:00` : value;
        const parsed = this.parseLocalAsUtc(canonical);
        if (Number.isNaN(parsed.getTime()) || this.formatLocal(parsed) !== canonical) {
            throw new BadRequestException(`${field} must be a valid local date-time`);
        }
    }

    private parseInstant(value: string, field: string): Date {
        if (!INSTANT_PATTERN.test(value || '')) {
            throw new BadRequestException(`${field} must include Z or an explicit UTC offset`);
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`${field} is invalid`);
        return parsed;
    }

    private assertIntegerRange(value: number, field: string, min: number, max: number): void {
        if (!Number.isInteger(value) || value < min || value > max) {
            throw new BadRequestException(`${field} must be an integer between ${min} and ${max}`);
        }
    }

    private parseLocalAsUtc(value: string): Date {
        return new Date(`${value}Z`);
    }

    private formatDate(value: Date): string {
        return value.toISOString().slice(0, 10);
    }

    private formatLocal(value: Date): string {
        return value.toISOString().slice(0, 19);
    }
}
