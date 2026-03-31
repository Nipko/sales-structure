import { IsString, IsNotEmpty, IsEnum, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OnboardingMode } from '../../../common/enums/onboarding-status.enum';

export class StartOnboardingDto {
  @ApiProperty({ description: 'ID del tenant/cliente interno' })
  @IsString()
  @IsNotEmpty()
  tenantId: string;

  @ApiProperty({ description: 'Config ID del Facebook Login for Business' })
  @IsString()
  @IsNotEmpty()
  configId: string;

  @ApiProperty({ description: 'Código OAuth devuelto por FB.login()' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ enum: OnboardingMode, description: 'Modo de onboarding' })
  @IsEnum(OnboardingMode)
  mode: OnboardingMode;

  @ApiPropertyOptional({ description: 'Fuente desde donde se inició el signup' })
  @IsString()
  @IsOptional()
  source?: string = 'embedded_signup';

  @ApiPropertyOptional({ description: 'Si el usuario reconoce el modo coexistencia' })
  @IsBoolean()
  @IsOptional()
  coexistenceAcknowledged?: boolean = false;

  @ApiPropertyOptional({ description: 'Phone Number ID from Embedded Signup session info' })
  @IsString()
  @IsOptional()
  phoneNumberId?: string;

  @ApiPropertyOptional({ description: 'WABA ID from Embedded Signup session info' })
  @IsString()
  @IsOptional()
  wabaId?: string;
}
