import {
    IsBoolean,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    IsDateString,
    IsEmail,
    Matches,
    Max,
    MaxLength,
    Min,
    ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateChannelManagerConfigDto {
    @IsOptional()
    @IsIn(['hostaway', 'guesty', 'ical', 'direct'])
    provider?: 'hostaway' | 'guesty' | 'ical' | 'direct';

    @IsOptional()
    @IsString()
    @MaxLength(2048)
    apiKey?: string;

    @IsOptional()
    @IsString()
    @MaxLength(2048)
    apiSecret?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    accountId?: string;

    @IsOptional()
    @IsInt()
    @Min(15)
    @Max(1440)
    syncInterval?: number;

    @IsOptional()
    @IsBoolean()
    autoBlock?: boolean;
}

export class MapChannelManagerListingDto {
    @IsUUID()
    listingId!: string;

    @IsOptional()
    @ValidateIf((_object, value) => value !== null && value !== undefined)
    @IsUUID()
    propertyId?: string | null;
}

export class CreateChannelManagerListingDto {
    @IsString() @MaxLength(200)
    name!: string;

    @IsOptional() @IsString() @MaxLength(500)
    address?: string;

    @IsOptional() @IsString() @MaxLength(255)
    externalId?: string;

    @IsOptional() @IsIn(['direct', 'ical'])
    provider?: 'direct' | 'ical';

    @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
    checkInTime?: string;

    @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
    checkOutTime?: string;

    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000)
    maxGuests?: number;

    @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(2_147_483_647)
    basePriceCents?: number;

    @IsOptional() @Matches(/^[A-Za-z]{3}$/)
    currency?: string;

    @IsOptional() @IsUUID()
    propertyId?: string;
}

export class CreateChannelManagerReservationDto {
    @IsUUID()
    listingId!: string;

    @IsString() @MaxLength(200)
    guestName!: string;

    @IsOptional() @IsEmail() @MaxLength(320)
    guestEmail?: string;

    @IsOptional() @IsString() @MaxLength(40)
    guestPhone?: string;

    @IsDateString({ strict: true })
    checkIn!: string;

    @IsDateString({ strict: true })
    checkOut!: string;

    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000)
    guests?: number;

    @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(2_147_483_647)
    totalCents?: number;

    @IsOptional() @Matches(/^[A-Za-z]{3}$/)
    currency?: string;

    @IsOptional() @IsString() @MaxLength(80)
    source?: string;

    @IsOptional() @IsString() @MaxLength(2000)
    notes?: string;
}

export class ChannelManagerReservationQueryDto {
    @IsOptional() @IsUUID()
    listingId?: string;

    @IsOptional() @IsString() @MaxLength(40)
    status?: string;

    @IsOptional() @IsDateString({ strict: true })
    fromDate?: string;

    @IsOptional() @IsDateString({ strict: true })
    toDate?: string;
}

export class ChannelManagerAvailabilityQueryDto {
    @IsUUID()
    listingId!: string;

    @IsDateString({ strict: true })
    from!: string;

    @IsDateString({ strict: true })
    to!: string;
}
