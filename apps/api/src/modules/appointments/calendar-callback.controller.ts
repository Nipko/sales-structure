import { Controller, Get, Query, Res, Logger } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CalendarIntegrationService } from './calendar-integration.service';
import { ConfigService } from '@nestjs/config';

@ApiTags('calendar')
@Controller('calendar')
export class CalendarCallbackController {
    private readonly logger = new Logger(CalendarCallbackController.name);

    constructor(
        private calendarService: CalendarIntegrationService,
        private config: ConfigService,
    ) {}

    @Get('google/callback')
    async googleCallback(
        @Query('code') code: string,
        @Query('state') state: string,
        @Res() res: Response,
    ) {
        const dashboardUrl = this.config.get('DASHBOARD_URL', 'https://admin.parallly-chat.cloud');
        try {
            await this.calendarService.handleGoogleCallback(code, state);
            this.logger.log(`Google Calendar connected via callback (state: ${state})`);
            return res.redirect(`${dashboardUrl}/admin/appointments?calendar=connected`);
        } catch (error: any) {
            this.logger.error(`Google callback failed: ${error.message}`);
            return res.redirect(`${dashboardUrl}/admin/appointments?calendar=error&message=${encodeURIComponent(error.message)}`);
        }
    }

    @Get('microsoft/callback')
    async microsoftCallback(
        @Query('code') code: string,
        @Query('state') state: string,
        @Res() res: Response,
    ) {
        const dashboardUrl = this.config.get('DASHBOARD_URL', 'https://admin.parallly-chat.cloud');
        try {
            await this.calendarService.handleMicrosoftCallback(code, state);
            this.logger.log(`Microsoft Calendar connected via callback (state: ${state})`);
            return res.redirect(`${dashboardUrl}/admin/appointments?calendar=connected`);
        } catch (error: any) {
            this.logger.error(`Microsoft callback failed: ${error.message}`);
            return res.redirect(`${dashboardUrl}/admin/appointments?calendar=error&message=${encodeURIComponent(error.message)}`);
        }
    }
}
