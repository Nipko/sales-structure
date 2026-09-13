import { IsEmail, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class ScheduleTestDriveDto {
    @IsUUID() vehicleId!: string;
    @IsUUID() contactId!: string;
    @IsUUID() serviceId!: string;
    @IsUUID() staffId!: string;
    @IsUUID() requestKey!: string;
    @IsOptional() @IsUUID() conversationId?: string;
    @IsString() @MinLength(1) @MaxLength(200) contactName!: string;
    @IsOptional() @IsString() @MaxLength(50) contactPhone?: string;
    @IsOptional() @IsEmail() contactEmail?: string;
    @Matches(/^\d{4}-\d{2}-\d{2}$/) scheduledDate!: string;
    @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/) scheduledTime!: string;
    @IsOptional() @IsString() @MaxLength(4000) notes?: string;
}
