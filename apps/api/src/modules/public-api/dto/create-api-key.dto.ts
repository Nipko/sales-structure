import { IsString, IsArray, IsOptional, IsDateString, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateApiKeyDto {
    @ApiProperty({ description: 'Human-friendly key name' })
    @IsString()
    name: string;

    @ApiProperty({ type: [String], description: 'Permission scopes' })
    @IsArray()
    @ArrayMinSize(1)
    @IsString({ each: true })
    scopes: string[];

    @ApiProperty({ required: false, description: 'Key expiration date (ISO 8601)' })
    @IsOptional()
    @IsDateString()
    expiresAt?: string;
}
