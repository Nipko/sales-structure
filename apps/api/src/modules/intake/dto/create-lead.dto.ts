import {
    IsString,
    IsEmail,
    IsOptional,
    IsBoolean,
    IsUUID,
    Matches,
    MaxLength,
    MinLength,
    IsNotEmpty,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateLeadDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    firstName: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    lastName: string;

    /**
     * Phone number — will be normalized to E.164 in the service.
     * Accept formats: +573001234567, 3001234567, 573001234567
     */
    @IsString()
    @IsNotEmpty()
    @MinLength(7)
    @MaxLength(20)
    phone: string;

    @IsEmail()
    @IsOptional()
    @MaxLength(255)
    email?: string;

    @IsUUID()
    @IsOptional()
    courseId?: string;

    @IsUUID()
    @IsOptional()
    campaignId?: string;

    @IsString()
    @IsOptional()
    @MaxLength(50)
    preferredContact?: string;

    // ─── UTM Attribution ─────────────────────────────────────────────────────

    @IsString()
    @IsOptional()
    @MaxLength(255)
    utmSource?: string;

    @IsString()
    @IsOptional()
    @MaxLength(255)
    utmMedium?: string;

    @IsString()
    @IsOptional()
    @MaxLength(255)
    utmCampaign?: string;

    @IsString()
    @IsOptional()
    @MaxLength(255)
    utmContent?: string;

    @IsString()
    @IsOptional()
    @MaxLength(500)
    referrerUrl?: string;

    @IsString()
    @IsOptional()
    @MaxLength(500)
    gclid?: string;

    @IsString()
    @IsOptional()
    @MaxLength(500)
    fbclid?: string;

    // ─── Consent ─────────────────────────────────────────────────────────────

    /**
     * Consent must be explicitly true.
     * Any falsy value will be rejected by the service.
     */
    @IsBoolean()
    @Transform(({ value }) => value === true || value === 'true')
    consent: boolean;

    /**
     * Version of the legal text shown to the user at form submission.
     * e.g. "v1.0" or "2026-01-01"
     */
    @IsString()
    @IsOptional()
    @MaxLength(50)
    legalVersion?: string;
}
