import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { google, calendar_v3 } from 'googleapis';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { Client as GraphClient } from '@microsoft/microsoft-graph-client';
import * as crypto from 'crypto';

type CalendarProvider = 'google' | 'microsoft';
type AssignmentType = 'staff' | 'service' | 'general';

const DEFAULT_TIMEZONE = 'America/Bogota';

interface FreeBusySlot {
    start: string;
    end: string;
}

export interface CalendarIntegration {
    id: string;
    userId: string;
    provider: CalendarProvider;
    calendarId: string;
    accountEmail: string | null;
    label: string | null;
    assignmentType: AssignmentType;
    assignmentId: string | null;
    isActive: boolean;
    connectedAt: string;
}

@Injectable()
export class CalendarIntegrationService {
    private readonly logger = new Logger(CalendarIntegrationService.name);
    private readonly encryptionKey: Buffer;
    private readonly googleClientId: string;
    private readonly googleClientSecret: string;
    private readonly googleRedirectUri: string;
    private readonly msClientId: string;
    private readonly msClientSecret: string;
    private readonly msTenantId: string;
    private readonly msRedirectUri: string;
    private msalClient: ConfidentialClientApplication | null = null;

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private config: ConfigService,
    ) {
        const key = config.get<string>('ENCRYPTION_KEY', '');
        this.encryptionKey = Buffer.from(key.padEnd(64, '0').slice(0, 64), 'hex');

        // Google OAuth2
        this.googleClientId = config.get('GOOGLE_OAUTH_CLIENT_ID', '');
        this.googleClientSecret = config.get('GOOGLE_OAUTH_CLIENT_SECRET', '');
        this.googleRedirectUri = config.get('GOOGLE_CALENDAR_REDIRECT_URI',
            `${config.get('DASHBOARD_URL', 'https://api.parallly-chat.cloud')}/api/v1/calendar/google/callback`);

        // Microsoft OAuth2
        this.msClientId = config.get('MS_CLIENT_ID', '');
        this.msClientSecret = config.get('MS_CLIENT_SECRET', '');
        this.msTenantId = config.get('MS_TENANT_ID', 'common');
        this.msRedirectUri = config.get('MS_CALENDAR_REDIRECT_URI',
            `${config.get('DASHBOARD_URL', 'https://api.parallly-chat.cloud')}/api/v1/calendar/microsoft/callback`);

        if (this.msClientId && this.msClientSecret) {
            this.msalClient = new ConfidentialClientApplication({
                auth: {
                    clientId: this.msClientId,
                    clientSecret: this.msClientSecret,
                    authority: `https://login.microsoftonline.com/${this.msTenantId}`,
                },
            });
        }
    }

    // ── OAuth2 URL generation ────────────────────────────────────

    getGoogleAuthUrl(tenantId: string, userId: string, assignmentType?: AssignmentType, assignmentId?: string): string {
        const oauth2 = new google.auth.OAuth2(this.googleClientId, this.googleClientSecret, this.googleRedirectUri);
        const state = `${tenantId}:${userId}:${assignmentType || 'general'}:${assignmentId || ''}`;
        return oauth2.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: ['https://www.googleapis.com/auth/calendar'],
            state,
        });
    }

    getMicrosoftAuthUrl(tenantId: string, userId: string, assignmentType?: AssignmentType, assignmentId?: string): string {
        if (!this.msalClient) throw new BadRequestException('Microsoft Calendar not configured');
        const state = `${tenantId}:${userId}:${assignmentType || 'general'}:${assignmentId || ''}`;
        return `https://login.microsoftonline.com/${this.msTenantId}/oauth2/v2.0/authorize?` +
            `client_id=${this.msClientId}&response_type=code&redirect_uri=${encodeURIComponent(this.msRedirectUri)}` +
            `&scope=${encodeURIComponent('Calendars.ReadWrite offline_access')}&state=${state}&prompt=consent`;
    }

    // ── OAuth2 Callbacks ─────────────────────────────────────────

    async handleGoogleCallback(code: string, state: string): Promise<CalendarIntegration> {
        const parts = state.split(':');
        const tenantId = parts[0];
        const userId = parts[1];
        const assignmentType: AssignmentType = (parts[2] as AssignmentType) || 'general';
        const assignmentId = parts[3] || null;
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);

        const oauth2 = new google.auth.OAuth2(this.googleClientId, this.googleClientSecret, this.googleRedirectUri);
        const { tokens } = await oauth2.getToken(code);

        if (!tokens.refresh_token) {
            throw new BadRequestException('No refresh token received. Please revoke access and try again.');
        }

        // Get user email
        oauth2.setCredentials(tokens);
        const cal = google.calendar({ version: 'v3', auth: oauth2 });
        const calList = await cal.calendarList.get({ calendarId: 'primary' });
        const accountEmail = calList.data.summary || null;

        const encrypted = this.encrypt(tokens.refresh_token);
        const id = crypto.randomUUID();

        // Insert new integration (multi-calendar: no upsert)
        await this.prisma.executeInTenantSchema(schemaName,
            `INSERT INTO calendar_integrations (id, user_id, provider, encrypted_refresh_token, calendar_id, account_email, label, assignment_type, assignment_id, connected_at, updated_at)
             VALUES ($1::uuid, $2::uuid, 'google', $3, 'primary', $4, $5, $6, $7, NOW(), NOW())`,
            [id, userId, encrypted, accountEmail, accountEmail, assignmentType, assignmentId],
        );

        this.logger.log(`Google Calendar connected for user ${userId} (${accountEmail}) [${assignmentType}:${assignmentId || 'none'}]`);
        return this.getIntegrationById(schemaName, id);
    }

    async handleMicrosoftCallback(code: string, state: string): Promise<CalendarIntegration> {
        const parts = state.split(':');
        const tenantId = parts[0];
        const userId = parts[1];
        const assignmentType: AssignmentType = (parts[2] as AssignmentType) || 'general';
        const assignmentId = parts[3] || null;
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);

        if (!this.msalClient) throw new BadRequestException('Microsoft not configured');

        const result = await this.msalClient.acquireTokenByCode({
            code,
            redirectUri: this.msRedirectUri,
            scopes: ['Calendars.ReadWrite', 'offline_access'],
        });

        // Get refresh token from MSAL cache
        const accounts = await this.msalClient.getTokenCache().getAllAccounts();
        const account = accounts[0];
        const accountEmail = account?.username || result.account?.username || null;

        // Store the serialized cache as "refresh token" equivalent
        const cacheContent = this.msalClient.getTokenCache().serialize();
        const encrypted = this.encrypt(cacheContent);
        const id = crypto.randomUUID();

        // Insert new integration (multi-calendar: no upsert)
        await this.prisma.executeInTenantSchema(schemaName,
            `INSERT INTO calendar_integrations (id, user_id, provider, encrypted_refresh_token, calendar_id, account_email, label, assignment_type, assignment_id, connected_at, updated_at)
             VALUES ($1::uuid, $2::uuid, 'microsoft', $3, 'primary', $4, $5, $6, $7, NOW(), NOW())`,
            [id, userId, encrypted, accountEmail, accountEmail, assignmentType, assignmentId],
        );

        this.logger.log(`Microsoft Calendar connected for user ${userId} (${accountEmail}) [${assignmentType}:${assignmentId || 'none'}]`);
        return this.getIntegrationById(schemaName, id);
    }

    // ── Multi-calendar resolution ────────────────────────────────

    /**
     * Resolve the best calendar integration(s) for a given context.
     * Priority: service-assigned → staff-assigned → general fallback.
     */
    async resolveCalendarsForContext(
        schemaName: string,
        opts: { serviceId?: string; staffId?: string },
    ): Promise<CalendarIntegration[]> {
        // 1. Try service-specific calendars
        if (opts.serviceId) {
            const serviceCalendars = await this.queryIntegrations(schemaName,
                `SELECT id, user_id, provider, calendar_id, account_email, label, assignment_type, assignment_id, is_active, connected_at
                 FROM calendar_integrations
                 WHERE is_active = true AND assignment_type = 'service' AND assignment_id = $1::uuid
                 ORDER BY connected_at ASC`,
                [opts.serviceId],
            );
            if (serviceCalendars.length > 0) return serviceCalendars;
        }

        // 2. Try staff-specific calendars
        if (opts.staffId) {
            const staffCalendars = await this.queryIntegrations(schemaName,
                `SELECT id, user_id, provider, calendar_id, account_email, label, assignment_type, assignment_id, is_active, connected_at
                 FROM calendar_integrations
                 WHERE is_active = true AND assignment_type = 'staff' AND assignment_id = $1::uuid
                 ORDER BY connected_at ASC`,
                [opts.staffId],
            );
            if (staffCalendars.length > 0) return staffCalendars;
        }

        // 3. Fallback to general calendars
        const generalCalendars = await this.queryIntegrations(schemaName,
            `SELECT id, user_id, provider, calendar_id, account_email, label, assignment_type, assignment_id, is_active, connected_at
             FROM calendar_integrations
             WHERE is_active = true AND assignment_type = 'general'
             ORDER BY connected_at ASC`,
            [],
        );
        return generalCalendars;
    }

    /**
     * Create a calendar event on the best-matching calendar for the context.
     * Uses resolveCalendarsForContext to pick the first available integration.
     */
    async createEventOnBestCalendar(
        schemaName: string,
        opts: { serviceId?: string; staffId?: string },
        eventData: { summary: string; startAt: string; endAt: string; attendeeEmail?: string; description?: string; isOnline?: boolean },
    ): Promise<{ eventId: string | null; meetingUrl?: string }> {
        const calendars = await this.resolveCalendarsForContext(schemaName, opts);
        if (calendars.length === 0) return { eventId: null };

        const integration = calendars[0];
        return this.createEventForIntegration(schemaName, integration.id, {
            summary: eventData.summary,
            startAt: eventData.startAt,
            endAt: eventData.endAt,
            attendeeEmail: eventData.attendeeEmail,
            description: eventData.description,
            isOnline: eventData.isOnline,
        });
    }

    // ── FreeBusy queries ─────────────────────────────────────────

    async getFreeBusy(schemaName: string, integrationId: string, timeMin: string, timeMax: string): Promise<FreeBusySlot[]> {
        const integration = await this.getIntegrationByIdOrNull(schemaName, integrationId);
        if (!integration || !integration.isActive) return [];

        try {
            if (integration.provider === 'google') {
                return this.googleFreeBusy(schemaName, integrationId, timeMin, timeMax);
            } else if (integration.provider === 'microsoft') {
                return this.microsoftFreeBusy(schemaName, integrationId, timeMin, timeMax);
            }
        } catch (error: any) {
            this.logger.warn(`FreeBusy failed for integration ${integrationId} (${integration.provider}): ${error.message}`);
        }
        return [];
    }

    private async googleFreeBusy(schemaName: string, integrationId: string, timeMin: string, timeMax: string): Promise<FreeBusySlot[]> {
        const client = await this.getGoogleClient(schemaName, integrationId);
        const cal = google.calendar({ version: 'v3', auth: client });

        const res = await cal.freebusy.query({
            requestBody: {
                timeMin, timeMax,
                items: [{ id: 'primary' }],
            },
        });

        const busy = res.data.calendars?.primary?.busy || [];
        return busy.map(b => ({ start: b.start || '', end: b.end || '' }));
    }

    private async microsoftFreeBusy(schemaName: string, integrationId: string, timeMin: string, timeMax: string): Promise<FreeBusySlot[]> {
        const client = await this.getMicrosoftClient(schemaName, integrationId);
        const tz = await this.getTimezoneFromSchema(schemaName);

        const res = await client.api('/me/calendar/getSchedule').post({
            schedules: ['me'],
            startTime: { dateTime: timeMin, timeZone: tz },
            endTime: { dateTime: timeMax, timeZone: tz },
        });

        const items = res.value?.[0]?.scheduleItems || [];
        return items
            .filter((i: any) => i.status === 'busy' || i.status === 'tentative')
            .map((i: any) => ({ start: i.start?.dateTime || '', end: i.end?.dateTime || '' }));
    }

    /**
     * Get all busy slots for a given date across matching calendar integrations.
     * Uses resolveCalendarsForContext for context-aware resolution.
     * Falls back to all active integrations if no context provided.
     */
    async getFreeBusyForDate(
        schemaName: string,
        date: string,
        opts?: { serviceId?: string; staffId?: string },
    ): Promise<FreeBusySlot[]> {
        const timeMin = `${date}T00:00:00Z`;
        const timeMax = `${date}T23:59:59Z`;
        const allBusy: FreeBusySlot[] = [];

        let integrations: CalendarIntegration[];

        if (opts?.serviceId || opts?.staffId) {
            integrations = await this.resolveCalendarsForContext(schemaName, opts);
        } else {
            // No context: query all active integrations
            integrations = await this.queryIntegrations(schemaName,
                `SELECT id, user_id, provider, calendar_id, account_email, label, assignment_type, assignment_id, is_active, connected_at
                 FROM calendar_integrations WHERE is_active = true`,
                [],
            );
        }

        for (const integration of integrations) {
            try {
                const busy = await this.getFreeBusy(schemaName, integration.id, timeMin, timeMax);
                allBusy.push(...busy);
            } catch (e: any) {
                this.logger.warn(`FreeBusy check failed for integration ${integration.id}: ${e.message}`);
            }
        }

        return allBusy;
    }

    // ── List external calendar events ──────────────────────────────

    async listExternalEvents(schemaName: string, userId: string, startDate: string, endDate: string): Promise<any[]> {
        // List events from all active integrations for this user
        const integrations = await this.queryIntegrations(schemaName,
            `SELECT id, user_id, provider, calendar_id, account_email, label, assignment_type, assignment_id, is_active, connected_at
             FROM calendar_integrations WHERE user_id = $1::uuid AND is_active = true`,
            [userId],
        );

        const allEvents: any[] = [];
        for (const integration of integrations) {
            try {
                if (integration.provider === 'google') {
                    const events = await this.googleListEvents(schemaName, integration.id, startDate, endDate);
                    allEvents.push(...events);
                } else if (integration.provider === 'microsoft') {
                    const events = await this.microsoftListEvents(schemaName, integration.id, startDate, endDate);
                    allEvents.push(...events);
                }
            } catch (error: any) {
                this.logger.warn(`ListEvents failed for integration ${integration.id} (${integration.provider}): ${error.message}`);
            }
        }
        return allEvents;
    }

    private async googleListEvents(schemaName: string, integrationId: string, startDate: string, endDate: string): Promise<any[]> {
        const client = await this.getGoogleClient(schemaName, integrationId);
        const cal = google.calendar({ version: 'v3', auth: client });

        const res = await cal.events.list({
            calendarId: 'primary',
            timeMin: new Date(startDate).toISOString(),
            timeMax: new Date(endDate + 'T23:59:59').toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 100,
        });

        return (res.data.items || []).map(e => ({
            id: e.id,
            title: e.summary || '(Sin título)',
            start: e.start?.dateTime || e.start?.date || '',
            end: e.end?.dateTime || e.end?.date || '',
            allDay: !!e.start?.date && !e.start?.dateTime,
            location: e.location || '',
            provider: 'google',
            status: e.status || 'confirmed',
            htmlLink: e.htmlLink || '',
        }));
    }

    private async microsoftListEvents(schemaName: string, integrationId: string, startDate: string, endDate: string): Promise<any[]> {
        const client = await this.getMicrosoftClient(schemaName, integrationId);

        // Use Prefer header to get times in tenant's timezone (not UTC)
        const tz = await this.getTimezoneFromSchema(schemaName);
        const res = await client
            .api('/me/calendarView')
            .header('Prefer', `outlook.timezone="${tz}"`)
            .query({
                startDateTime: new Date(startDate).toISOString(),
                endDateTime: new Date(endDate + 'T23:59:59').toISOString(),
            })
            .top(100)
            .orderby('start/dateTime')
            .select('id,subject,start,end,location,isAllDay,webLink,showAs')
            .get();

        return (res.value || []).map((e: any) => ({
            id: e.id,
            title: e.subject || '(Sin título)',
            start: e.start?.dateTime || '',
            end: e.end?.dateTime || '',
            allDay: e.isAllDay || false,
            location: e.location?.displayName || '',
            provider: 'microsoft',
            status: e.showAs || 'busy',
            htmlLink: e.webLink || '',
            timezone: e.start?.timeZone || tz,
        }));
    }

    // ── Create calendar event ────────────────────────────────────

    /**
     * Create event on a specific integration by ID.
     */
    async createEventForIntegration(schemaName: string, integrationId: string, data: {
        summary: string; startAt: string; endAt: string;
        location?: string; description?: string; attendeeEmail?: string;
        isOnline?: boolean;
    }): Promise<{ eventId: string | null; meetingUrl?: string }> {
        const integration = await this.getIntegrationByIdOrNull(schemaName, integrationId);
        if (!integration || !integration.isActive) return { eventId: null };

        try {
            if (integration.provider === 'google') {
                const client = await this.getGoogleClient(schemaName, integrationId);
                const cal = google.calendar({ version: 'v3', auth: client });

                const event: calendar_v3.Schema$Event = {
                    summary: data.summary,
                    start: { dateTime: data.startAt },
                    end: { dateTime: data.endAt },
                    location: data.location,
                    description: data.description,
                };
                if (data.attendeeEmail) {
                    event.attendees = [{ email: data.attendeeEmail }];
                }
                if (data.isOnline) {
                    event.conferenceData = {
                        createRequest: {
                            requestId: crypto.randomUUID(),
                            conferenceSolutionKey: { type: 'hangoutsMeet' },
                        },
                    };
                }

                const res = await cal.events.insert({
                    calendarId: 'primary',
                    requestBody: event,
                    sendUpdates: 'all',
                    conferenceDataVersion: data.isOnline ? 1 : undefined,
                });
                const meetingUrl = res.data.conferenceData?.entryPoints?.find(
                    (ep) => ep.entryPointType === 'video',
                )?.uri || undefined;
                this.logger.log(`Google event created: ${res.data.id} (integration ${integrationId})${meetingUrl ? ` meetingUrl=${meetingUrl}` : ''}`);
                return { eventId: res.data.id || null, meetingUrl };

            } else if (integration.provider === 'microsoft') {
                const client = await this.getMicrosoftClient(schemaName, integrationId);
                const tz = await this.getTimezoneFromSchema(schemaName);

                const event: any = {
                    subject: data.summary,
                    start: { dateTime: data.startAt, timeZone: tz },
                    end: { dateTime: data.endAt, timeZone: tz },
                    location: data.location ? { displayName: data.location } : undefined,
                    body: data.description ? { content: data.description, contentType: 'text' } : undefined,
                };
                if (data.attendeeEmail) {
                    event.attendees = [{ emailAddress: { address: data.attendeeEmail }, type: 'required' }];
                }
                if (data.isOnline) {
                    event.isOnlineMeeting = true;
                    event.onlineMeetingProvider = 'teamsForBusiness';
                }

                const res = await client.api('/me/events').post(event);
                const meetingUrl = res.onlineMeeting?.joinUrl || undefined;
                this.logger.log(`Microsoft event created: ${res.id} (integration ${integrationId})${meetingUrl ? ` meetingUrl=${meetingUrl}` : ''}`);
                return { eventId: res.id || null, meetingUrl };
            }
        } catch (error: any) {
            this.logger.error(`Create event failed for integration ${integrationId}: ${error.message}`);
        }
        return { eventId: null };
    }

    /**
     * Legacy wrapper: create event by userId. Finds the first active integration for that user.
     * Kept for backward compatibility with ai-tool-executor and other callers.
     */
    async createEvent(schemaName: string, userId: string, data: {
        summary: string; startAt: string; endAt: string;
        location?: string; description?: string; attendeeEmail?: string;
        isOnline?: boolean;
    }): Promise<{ eventId: string | null; meetingUrl?: string }> {
        const integrations = await this.queryIntegrations(schemaName,
            `SELECT id, user_id, provider, calendar_id, account_email, label, assignment_type, assignment_id, is_active, connected_at
             FROM calendar_integrations WHERE user_id = $1::uuid AND is_active = true ORDER BY connected_at ASC LIMIT 1`,
            [userId],
        );
        if (integrations.length === 0) return { eventId: null };
        return this.createEventForIntegration(schemaName, integrations[0].id, data);
    }

    // ── List integrations ────────────────────────────────────────

    async listIntegrations(schemaName: string, userId?: string): Promise<CalendarIntegration[]> {
        let sql = `SELECT id, user_id, provider, calendar_id, account_email, label, assignment_type, assignment_id, is_active, connected_at FROM calendar_integrations WHERE is_active = true`;
        const params: any[] = [];
        if (userId) { sql += ` AND user_id = $1::uuid`; params.push(userId); }
        sql += ` ORDER BY connected_at DESC`;

        return this.queryIntegrations(schemaName, sql, params);
    }

    // ── Disconnect ──────────────────────────────────────────────

    async disconnect(schemaName: string, integrationId: string): Promise<void> {
        // Get the integration details
        const integrationRows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT user_id, assignment_type, assignment_id FROM calendar_integrations WHERE id = $1::uuid`,
            [integrationId],
        );

        if (!integrationRows?.length) {
            throw new BadRequestException('Calendar integration not found');
        }

        const { user_id: userId, assignment_type: assignmentType, assignment_id: assignmentId } = integrationRows[0];

        // Check for future appointments based on assignment type
        let futureCount = 0;

        if (assignmentType === 'staff' && assignmentId) {
            // Staff-assigned: check appointments assigned to that staff member
            const countRows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT COUNT(*) AS count FROM appointments
                 WHERE assigned_to = $1::uuid
                   AND start_at > NOW()
                   AND status NOT IN ('cancelled', 'completed', 'no_show')`,
                [assignmentId],
            );
            futureCount = Number(countRows?.[0]?.count ?? 0);
        } else if (assignmentType === 'service' && assignmentId) {
            // Service-assigned: check appointments for that service
            const countRows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT COUNT(*) AS count FROM appointments
                 WHERE service_id = $1::uuid
                   AND start_at > NOW()
                   AND status NOT IN ('cancelled', 'completed', 'no_show')`,
                [assignmentId],
            );
            futureCount = Number(countRows?.[0]?.count ?? 0);
        } else {
            // General: check appointments assigned to the integration owner
            const countRows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT COUNT(*) AS count FROM appointments
                 WHERE assigned_to = $1::uuid
                   AND start_at > NOW()
                   AND status NOT IN ('cancelled', 'completed', 'no_show')`,
                [userId],
            );
            futureCount = Number(countRows?.[0]?.count ?? 0);
        }

        if (futureCount > 0) {
            // Check if there are other active calendars to reassign to
            const otherCalendars = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT id, label, account_email, provider FROM calendar_integrations WHERE id != $1::uuid AND is_active = true`,
                [integrationId],
            );

            throw new BadRequestException({
                message: `Cannot disconnect: ${futureCount} future appointment${futureCount > 1 ? 's' : ''} must be reassigned or cancelled first`,
                futureCount,
                otherCalendars: (otherCalendars || []).map((c: any) => ({
                    id: c.id,
                    label: c.label || c.account_email,
                    provider: c.provider,
                })),
                canReassign: (otherCalendars || []).length > 0,
            });
        }

        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE calendar_integrations SET is_active = false, updated_at = NOW() WHERE id = $1::uuid`,
            [integrationId],
        );
    }

    /**
     * Reassign all future appointments from one calendar/staff to another, then disconnect.
     */
    async reassignAndDisconnect(
        schemaName: string,
        integrationId: string,
        targetIntegrationId: string,
    ): Promise<{ reassigned: number }> {
        // Get source integration
        const source = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT user_id, assignment_type, assignment_id FROM calendar_integrations WHERE id = $1::uuid`,
            [integrationId],
        );
        if (!source?.length) throw new BadRequestException('Source calendar not found');

        // Get target integration
        const target = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT user_id, assignment_type, assignment_id FROM calendar_integrations WHERE id = $1::uuid AND is_active = true`,
            [targetIntegrationId],
        );
        if (!target?.length) throw new BadRequestException('Target calendar not found');

        const src = source[0];
        const tgt = target[0];

        // Reassign future appointments
        let reassigned = 0;
        if (src.assignment_type === 'staff' && src.assignment_id) {
            const result = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `UPDATE appointments SET assigned_to = $1::uuid, updated_at = NOW()
                 WHERE assigned_to = $2::uuid AND start_at > NOW()
                 AND status NOT IN ('cancelled', 'completed', 'no_show') RETURNING id`,
                [tgt.assignment_id || tgt.user_id, src.assignment_id],
            );
            reassigned = result?.length || 0;
        } else {
            const result = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `UPDATE appointments SET assigned_to = $1::uuid, updated_at = NOW()
                 WHERE assigned_to = $2::uuid AND start_at > NOW()
                 AND status NOT IN ('cancelled', 'completed', 'no_show') RETURNING id`,
                [tgt.user_id, src.user_id],
            );
            reassigned = result?.length || 0;
        }

        // Now disconnect
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE calendar_integrations SET is_active = false, updated_at = NOW() WHERE id = $1::uuid`,
            [integrationId],
        );

        return { reassigned };
    }

    // ── Update assignment ───────────────────────────────────────

    async updateAssignment(
        schemaName: string,
        integrationId: string,
        data: { label?: string; assignmentType?: string; assignmentId?: string },
    ): Promise<void> {
        const sets: string[] = [];
        const params: any[] = [integrationId];
        let idx = 2;

        if (data.label !== undefined) {
            sets.push(`label = $${idx}`);
            params.push(data.label);
            idx++;
        }
        if (data.assignmentType !== undefined) {
            sets.push(`assignment_type = $${idx}`);
            params.push(data.assignmentType);
            idx++;
        }
        if (data.assignmentId !== undefined) {
            sets.push(`assignment_id = $${idx}::uuid`);
            params.push(data.assignmentId || null);
            idx++;
        }

        if (sets.length === 0) return;

        sets.push('updated_at = NOW()');

        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE calendar_integrations SET ${sets.join(', ')} WHERE id = $1::uuid`,
            params,
        );
    }

    // ── Private helpers ──────────────────────────────────────────

    /**
     * Query integrations and map rows to CalendarIntegration objects.
     */
    private async queryIntegrations(schemaName: string, sql: string, params: any[]): Promise<CalendarIntegration[]> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName, sql, params);
        return (rows || []).map(r => ({
            id: r.id,
            userId: r.user_id,
            provider: r.provider,
            calendarId: r.calendar_id,
            accountEmail: r.account_email,
            label: r.label || null,
            assignmentType: r.assignment_type || 'general',
            assignmentId: r.assignment_id || null,
            isActive: r.is_active,
            connectedAt: r.connected_at,
        }));
    }

    private async getIntegrationById(schemaName: string, integrationId: string): Promise<CalendarIntegration> {
        const rows = await this.queryIntegrations(schemaName,
            `SELECT id, user_id, provider, calendar_id, account_email, label, assignment_type, assignment_id, is_active, connected_at
             FROM calendar_integrations WHERE id = $1::uuid LIMIT 1`,
            [integrationId],
        );
        if (!rows.length) throw new BadRequestException('Calendar integration not found');
        return rows[0];
    }

    private async getIntegrationByIdOrNull(schemaName: string, integrationId: string): Promise<CalendarIntegration | null> {
        const rows = await this.queryIntegrations(schemaName,
            `SELECT id, user_id, provider, calendar_id, account_email, label, assignment_type, assignment_id, is_active, connected_at
             FROM calendar_integrations WHERE id = $1::uuid LIMIT 1`,
            [integrationId],
        );
        return rows[0] || null;
    }

    private async getIntegration(schemaName: string, userId: string, provider: CalendarProvider): Promise<CalendarIntegration> {
        const rows = await this.queryIntegrations(schemaName,
            `SELECT id, user_id, provider, calendar_id, account_email, label, assignment_type, assignment_id, is_active, connected_at
             FROM calendar_integrations WHERE user_id = $1::uuid AND provider = $2 LIMIT 1`,
            [userId, provider],
        );
        if (!rows.length) throw new BadRequestException('Calendar integration not found');
        return rows[0];
    }

    /**
     * Resolve the tenant timezone from settings.
     * Falls back to DEFAULT_TIMEZONE if not configured.
     */
    async getTenantTimezone(tenantId: string): Promise<string> {
        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { settings: true },
            });
            const settings = (tenant?.settings as any) || {};
            return settings.timezone || DEFAULT_TIMEZONE;
        } catch {
            return DEFAULT_TIMEZONE;
        }
    }

    /**
     * Resolve timezone from schema name (looks up tenant by schema).
     */
    private async getTimezoneFromSchema(schemaName: string): Promise<string> {
        try {
            const tenant = await this.prisma.tenant.findFirst({
                where: { schemaName },
                select: { settings: true },
            });
            const settings = (tenant?.settings as any) || {};
            return settings.timezone || DEFAULT_TIMEZONE;
        } catch {
            return DEFAULT_TIMEZONE;
        }
    }

    private async getIntegrationOrNull(schemaName: string, userId: string): Promise<CalendarIntegration | null> {
        const rows = await this.queryIntegrations(schemaName,
            `SELECT id, user_id, provider, calendar_id, account_email, label, assignment_type, assignment_id, is_active, connected_at
             FROM calendar_integrations WHERE user_id = $1::uuid AND is_active = true LIMIT 1`,
            [userId],
        );
        return rows[0] || null;
    }

    private async getGoogleClient(schemaName: string, integrationId: string) {
        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT encrypted_refresh_token FROM calendar_integrations WHERE id = $1::uuid AND provider = 'google' AND is_active = true LIMIT 1`,
            [integrationId],
        );
        if (!rows?.[0]) throw new BadRequestException('Google Calendar not connected');

        const refreshToken = this.decrypt(rows[0].encrypted_refresh_token);
        const oauth2 = new google.auth.OAuth2(this.googleClientId, this.googleClientSecret, this.googleRedirectUri);
        oauth2.setCredentials({ refresh_token: refreshToken });
        return oauth2;
    }

    private async getMicrosoftClient(schemaName: string, integrationId: string) {
        if (!this.msalClient) throw new BadRequestException('Microsoft not configured');

        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT encrypted_refresh_token FROM calendar_integrations WHERE id = $1::uuid AND provider = 'microsoft' AND is_active = true LIMIT 1`,
            [integrationId],
        );
        if (!rows?.[0]) throw new BadRequestException('Microsoft Calendar not connected');

        const cache = this.decrypt(rows[0].encrypted_refresh_token);
        this.msalClient.getTokenCache().deserialize(cache);

        const accounts = await this.msalClient.getTokenCache().getAllAccounts();
        if (!accounts[0]) throw new BadRequestException('Microsoft account expired. Reconnect.');

        const result = await this.msalClient.acquireTokenSilent({
            account: accounts[0],
            scopes: ['Calendars.ReadWrite'],
        });

        return GraphClient.init({
            authProvider: (done) => done(null, result.accessToken),
        });
    }

    // ── Encryption (same pattern as ChannelTokenService) ─────────

    private encrypt(text: string): string {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const tag = cipher.getAuthTag().toString('hex');
        return `${iv.toString('hex')}:${tag}:${encrypted}`;
    }

    private decrypt(encryptedText: string): string {
        const [ivHex, tagHex, encrypted] = encryptedText.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }

    // ── Cron: renew Google watch channels ─────────────────────────

    @Cron('0 */12 * * *')
    async renewWatchChannels(): Promise<void> {
        // Future: implement Google Calendar push notifications
        // For now, availability is checked on-demand via freebusy.query()
    }
}
