import { Transform, Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsEmail,
    IsIn,
    IsObject,
    IsOptional,
    IsString,
    MaxLength,
    ValidateNested,
} from 'class-validator';
import { SUPPORTED_BILLING_COUNTRIES } from '../../../common/utils/billing-country.util';

/**
 * Same list the fiscal endpoint validates (PATCH /fiscal/:tenantId/billing-country):
 * the countries we recognize as a tenant billing country. This used to be the
 * narrower "has a charging currency" map (17 entries) while the fiscal PATCH
 * accepted ~55, so the two write paths for the SAME column disagreed about what
 * was valid — and timezone inference could already produce a country the DTO
 * rejected. Charging currency is a separate, narrower question answered by
 * `hasBillingCurrency` inside BillingService; a recognized country without one is
 * quoted in USD by the plan catalog.
 */
const BILLING_COUNTRIES = SUPPORTED_BILLING_COUNTRIES;

class SocialMediaDto {
    @IsOptional() @IsString() @MaxLength(500) instagram?: string;
    @IsOptional() @IsString() @MaxLength(500) facebook?: string;
    @IsOptional() @IsString() @MaxLength(500) linkedin?: string;
    @IsOptional() @IsString() @MaxLength(500) tiktok?: string;
}

class OnboardingCompanyDto {
    @IsOptional() @IsString() @MaxLength(200) name?: string;
    @IsOptional() @IsString() @MaxLength(500) website?: string;
    @IsOptional() @IsString() @MaxLength(30) phone?: string;
    @IsOptional() @IsEmail() @MaxLength(254) email?: string;
    @IsOptional() @IsString() @MaxLength(5000) about?: string;

    @IsOptional()
    @ValidateNested()
    @Type(() => SocialMediaDto)
    socialMedia?: SocialMediaDto;

    @IsOptional() @IsString() @MaxLength(80) industry?: string;
    @IsOptional() @IsString() @MaxLength(80) subType?: string;
    @IsOptional() @IsString() @MaxLength(50) orgSize?: string;
    @IsOptional() @IsString() @MaxLength(100) timezone?: string;
    @IsOptional() @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
    @IsString() @IsIn(BILLING_COUNTRIES) country?: string;
}

export class CompleteOnboardingDto {
    @IsOptional()
    @ValidateNested()
    @Type(() => OnboardingCompanyDto)
    company?: OnboardingCompanyDto;

    @IsOptional() @IsArray() @ArrayMaxSize(25) @IsString({ each: true }) audiences?: string[];
    @IsOptional() @IsArray() @ArrayMaxSize(25) @IsString({ each: true }) goals?: string[];
    @IsOptional() @IsString() @MaxLength(300) referral?: string;
    @IsOptional() @IsString() @MaxLength(10) locale?: string;
    // Slugs are data-owned by billing_plans. BillingService validates that the
    // selected plan exists and is active; a DTO enum would reject new plans that
    // Superadmin has already published to the live catalog.
    @IsOptional() @IsString() @MaxLength(80) plan?: string;
    @IsOptional() @IsIn(['monthly', 'annual']) billingCycle?: 'monthly' | 'annual';
    @IsOptional() @IsString() @MaxLength(500) cardTokenId?: string;
    // Código promocional opcional del alta. Sin esta declaración el ValidationPipe
    // global (whitelist: true) lo descartaría en silencio, sin error visible.
    @IsOptional() @IsString() @MaxLength(40) couponCode?: string;

    // Backwards-compatible top-level fields accepted by older clients.
    @IsOptional() @IsString() @MaxLength(200) companyName?: string;
    @IsOptional() @IsString() @MaxLength(500) website?: string;
    @IsOptional() @IsObject() socialLinks?: Record<string, string>;
    @IsOptional() @IsString() @MaxLength(80) industry?: string;
    @IsOptional() @IsString() @MaxLength(80) subType?: string;
    @IsOptional() @IsString() @MaxLength(50) companySize?: string;
    @IsOptional() @IsString() @MaxLength(100) timezone?: string;
    @IsOptional() @IsArray() @ArrayMaxSize(25) @IsString({ each: true }) customerTypes?: string[];
    @IsOptional() @IsArray() @ArrayMaxSize(25) @IsString({ each: true }) chatReasons?: string[];
    @IsOptional() @IsString() @MaxLength(300) referralSource?: string;
    @IsOptional() @IsString() @MaxLength(80) planSlug?: string;
    @IsOptional() @IsString() @MaxLength(100) signupSource?: string;
    @IsOptional() @IsObject() signupAttribution?: Record<string, unknown>;
    @IsOptional() @IsString() @MaxLength(30) phone?: string;
    @IsOptional() @IsEmail() @MaxLength(254) businessEmail?: string;
    @IsOptional() @IsString() @MaxLength(5000) about?: string;
    @IsOptional() @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
    @IsString() @IsIn(BILLING_COUNTRIES) billingCountry?: string;
}
