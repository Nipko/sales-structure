import { Transform } from 'class-transformer';
import {
    IsEmail,
    IsOptional,
    IsString,
    MaxLength,
    MinLength,
} from 'class-validator';

export const WIDGET_ID_MAX_CHARS = 80;
export const WIDGET_VISITOR_ID_MAX_CHARS = 128;
export const WIDGET_MESSAGE_MAX_CHARS = 4_000;
export const WIDGET_TOKEN_MAX_CHARS = 4_096;

const trim = ({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value;

export class WidgetIdParamDto {
    @Transform(trim)
    @IsString()
    @MinLength(1)
    @MaxLength(WIDGET_ID_MAX_CHARS)
    widgetId!: string;
}

export class CreateWidgetSessionDto {
    @Transform(trim)
    @IsString()
    @MinLength(1)
    @MaxLength(WIDGET_ID_MAX_CHARS)
    widgetId!: string;

    @Transform(trim)
    @IsString()
    @MinLength(1)
    @MaxLength(WIDGET_VISITOR_ID_MAX_CHARS)
    visitorId!: string;

    @IsOptional()
    @Transform(trim)
    @IsString()
    @MaxLength(120)
    name?: string;

    @IsOptional()
    @Transform(trim)
    @IsEmail()
    @MaxLength(254)
    email?: string;

    @IsOptional()
    @Transform(trim)
    @IsString()
    @MaxLength(40)
    phone?: string;

    @IsOptional()
    @Transform(trim)
    @IsString()
    @MaxLength(2_048)
    page?: string;
}

export class RefreshWidgetSessionDto {
    @Transform(trim)
    @IsString()
    @MinLength(1)
    @MaxLength(WIDGET_TOKEN_MAX_CHARS)
    token!: string;
}

export class WidgetMessageDto {
    @Transform(trim)
    @IsString()
    @MinLength(1)
    @MaxLength(WIDGET_MESSAGE_MAX_CHARS)
    content!: string;

    @IsOptional()
    @Transform(trim)
    @IsString()
    @MaxLength(32)
    type?: string;
}
