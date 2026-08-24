import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Superset used by the provider-specific PATCH route. Whitelisting rejects
 * undeclared keys; the service then applies the exact provider contract and
 * endpoint validation before persisting anything.
 */
export class UpdateVerticalIntegrationConfigDto {
    @IsOptional() @IsString() @MaxLength(500)
    hostname?: string;

    @IsOptional() @IsString() @MaxLength(200)
    clientId?: string;

    @IsOptional() @IsString() @MaxLength(2048)
    clientSecret?: string;

    @IsOptional() @IsString() @MaxLength(200)
    locationGuid?: string;

    @IsOptional() @IsString() @MaxLength(2048)
    apiKey?: string;

    @IsOptional() @IsString() @MaxLength(100)
    siteId?: string;

    @IsOptional() @IsString() @MaxLength(200)
    sourceName?: string;

    @IsOptional() @IsString() @MaxLength(200)
    username?: string;

    @IsOptional() @IsString() @MaxLength(2048)
    password?: string;

    @IsOptional() @IsString() @MaxLength(500)
    baseUrl?: string;

    @IsOptional() @IsString() @MaxLength(128)
    businessId?: string;

    @IsOptional() @IsString() @MaxLength(128)
    practitionerId?: string;
}
