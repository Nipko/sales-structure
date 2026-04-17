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

    getGoogleAuthUrl(tenantId: string, userId: string): string {
        const oauth2 = new google.auth.OAuth2(this.googleClientId, this.googleClientSecret, this.googleRedirectUri);
        return oauth2.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: ['https://www.googleapis.com/auth/calendar.events'],
            state: `${tenantId}:${userId}`,
        });
    }

    getMicrosoftAuthUrl(tenantId: string, userId: string): string {
        if (!this.msalClient) throw new BadRequestException('Microsoft Calendar not configured');
        const state = `${tenantId}:${userId}`;
        return `https://login.microsoftonline.com/${this.msTenantId}/oauth2/v2.0/authorize?` +
            `client_id=${this.msClientId}&response_type=code&redirect_uri=${encodeURIComponent(this.msRedirectUri)}` +
            `&scope=${encodeURIComponent('Calendars.ReadWrite offline_access')}&state=${state}&prompt=consent`;
    }

    // ── OAuth2 Callbacks ─────────────────────────────────────────

    async handleGoogleCallback(code: string, state: string): Promise<CalendarIntegration> {
        const [tenantId, userId] = state.split(':');
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

        // Upsert: one integration per user+provider
        await this.prisma.executeInTenantSchema(schemaName,
            `INSERT INTO calendar_integrations (id, user_id, provider, encrypted_refresh_token, calendar_id, account_email, connected_at, updated_at)
             VALUES ($1::uuid, $2::uuid, 'google', $3, 'primary', $4, NOW(), NOW())
             ON CONFLICT (user_id, provider) DO UPDATE SET encrypted_refresh_token = $3, account_email = $4, is_active = true, updated_at = NOW()`,
            [id, userId, encrypted, accountEmail],
        );

        this.logger.log(`Google Calendar connected for user ${userId} (${accountEmail})`);
        return this.getIntegration(schemaName, userId, 'google');
    }

    async handleMicrosoftCallback(code: string, state: string): Promise<CalendarIntegration> {
        const [tenantId, userId] = state.split(':');
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

        await this.prisma.executeInTenantSchema(schemaName,
            `INSERT INTO calendar_integrations (id, user_id, provider, encrypted_refresh_token, calendar_id, account_email, connected_at, updated_at)
             VALUES ($1::uuid, $2::uuid, 'microsoft', $3, 'primary', $4, NOW(), NOW())
             ON CONFLICT (user_id, provider) DO UPDATE SET encrypted_refresh_token = $3, account_email = $4, is_active = true, updated_at = NOW()`,
            [id, userId, encrypted, accountEmail],
        );

        this.logger.log(`Microsoft Calendar connected for user ${userId} (${accountEmail})`);
        return this.getIntegration(schemaName, userId, 'microsoft');
    }

    // ── FreeBusy queries ─────────────────────────────────────────

    async getFreeBusy(schemaName: string, userId: string, timeMin: string, timeMax: string): Promise<FreeBusySlot[]> {
        const integration = await this.getIntegrationOrNull(schemaName, userId);
        if (!integration || !integration.isActive) return [];

        try {
            if (integration.provider === 'google') {
                return this.googleFreeBusy(schemaName, userId, timeMin, timeMax);
            } else if (integration.provider === 'microsoft') {
                return this.microsoftFreeBusy(schemaName, userId, timeMin, timeMax);
            }
        } catch (error: any) {
            this.logger.warn(`FreeBusy failed for ${userId} (${integration.provider}): ${error.message}`);
        }
        return [];
    }

    private async googleFreeBusy(schemaName: string, userId: string, timeMin: string, timeMax: string): Promise<FreeBusySlot[]> {
        const client = await this.getGoogleClient(schemaName, userId);
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

    private async microsoftFreeBusy(schemaName: string, userId: string, timeMin: string, timeMax: string): Promise<FreeBusySlot[]> {
        const client = await this.getMicrosoftClient(schemaName, userId);

        const res = await client.api('/me/calendar/getSchedule').post({
            schedules: ['me'],
            startTime: { dateTime: timeMin, timeZone: 'UTC' },
            endTime: { dateTime: timeMax, timeZone: 'UTC' },
        });

        const items = res.value?.[0]?.scheduleItems || [];
        return items
            .filter((i: any) => i.status === 'busy' || i.status === 'tentative')
            .map((i: any) => ({ start: i.start?.dateTime || '', end: i.end?.dateTime || '' }));
    }

    // ── List external calendar events ──────────────────────────────

    async listExternalEvents(schemaName: string, userId: string, startDate: string, endDate: string): Promise<any[]> {
        const integration = await this.getIntegrationOrNull(schemaName, userId);
        if (!integration || !integration.isActive) return [];

        try {
            if (integration.provider === 'google') {
                return this.googleListEvents(schemaName, userId, startDate, endDate);
            } else if (integration.provider === 'microsoft') {
                return this.microsoftListEvents(schemaName, userId, startDate, endDate);
            }
        } catch (error: any) {
            this.logger.warn(`ListEvents failed for ${userId} (${integration.provider}): ${error.message}`);
        }
        return [];
    }

    private async googleListEvents(schemaName: string, userId: string, startDate: string, endDate: string): Promise<any[]> {
        const client = await this.getGoogleClient(schemaName, userId);
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

    private async microsoftListEvents(schemaName: string, userId: string, startDate: string, endDate: string): Promise<any[]> {
        const client = await this.getMicrosoftClient(schemaName, userId);

        const res = await client
            .api('/me/calendarView')
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
        }));
    }

    // ── Create calendar event ────────────────────────────────────

    async createEvent(schemaName: string, userId: string, data: {
        summary: string; startAt: string; endAt: string;
        location?: string; description?: string; attendeeEmail?: string;
    }): Promise<string | null> {
        const integration = await this.getIntegrationOrNull(schemaName, userId);
        if (!integration || !integration.isActive) return null;

        try {
            if (integration.provider === 'google') {
                const client = await this.getGoogleClient(schemaName, userId);
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

                const res = await cal.events.insert({ calendarId: 'primary', requestBody: event });
                this.logger.log(`Google event created: ${res.data.id}`);
                return res.data.id || null;

            } else if (integration.provider === 'microsoft') {
                const client = await this.getMicrosoftClient(schemaName, userId);

                const event: any = {
                    subject: data.summary,
                    start: { dateTime: data.startAt, timeZone: 'UTC' },
                    end: { dateTime: data.endAt, timeZone: 'UTC' },
                    location: data.location ? { displayName: data.location } : undefined,
                    body: data.description ? { content: data.description, contentType: 'text' } : undefined,
                };
                if (data.attendeeEmail) {
                    event.attendees = [{ emailAddress: { address: data.attendeeEmail }, type: 'required' }];
                }

                const res = await client.api('/me/events').post(event);
                this.logger.log(`Microsoft event created: ${res.id}`);
                return res.id || null;
            }
        } catch (error: any) {
            this.logger.error(`Create event failed for ${userId}: ${error.message}`);
        }
        return null;
    }

    // ── List integrations ────────────────────────────────────────

    async listIntegrations(schemaName: string, userId?: string): Promise<CalendarIntegration[]> {
        let sql = `SELECT id, user_id, provider, calendar_id, account_email, is_active, connected_at FROM calendar_integrations`;
        const params: any[] = [];
        if (userId) { sql += ` WHERE user_id = $1::uuid`; params.push(userId); }
        sql += ` ORDER BY connected_at DESC`;

        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName, sql, params);
        return (rows || []).map(r => ({
            id: r.id, userId: r.user_id, provider: r.provider,
            calendarId: r.calendar_id, accountEmail: r.account_email,
            isActive: r.is_active, connectedAt: r.connected_at,
        }));
    }

    async disconnect(schemaName: string, integrationId: string): Promise<void> {
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE calendar_integrations SET is_active = false, updated_at = NOW() WHERE id = $1::uuid`,
            [integrationId],
        );
    }

    // ── Private helpers ──────────────────────────────────────────

    private async getIntegration(schemaName: string, userId: string, provider: CalendarProvider): Promise<CalendarIntegration> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT id, user_id, provider, calendar_id, account_email, is_active, connected_at
             FROM calendar_integrations WHERE user_id = $1::uuid AND provider = $2 LIMIT 1`,
            [userId, provider],
        );
        const r = rows?.[0];
        if (!r) throw new BadRequestException('Calendar integration not found');
        return { id: r.id, userId: r.user_id, provider: r.provider, calendarId: r.calendar_id, accountEmail: r.account_email, isActive: r.is_active, connectedAt: r.connected_at };
    }

    private async getIntegrationOrNull(schemaName: string, userId: string): Promise<(CalendarIntegration & { provider: CalendarProvider }) | null> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT id, user_id, provider, calendar_id, account_email, is_active, connected_at
             FROM calendar_integrations WHERE user_id = $1::uuid AND is_active = true LIMIT 1`,
            [userId],
        );
        const r = rows?.[0];
        if (!r) return null;
        return { id: r.id, userId: r.user_id, provider: r.provider, calendarId: r.calendar_id, accountEmail: r.account_email, isActive: r.is_active, connectedAt: r.connected_at };
    }

    private async getGoogleClient(schemaName: string, userId: string) {
        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT encrypted_refresh_token FROM calendar_integrations WHERE user_id = $1::uuid AND provider = 'google' AND is_active = true LIMIT 1`,
            [userId],
        );
        if (!rows?.[0]) throw new BadRequestException('Google Calendar not connected');

        const refreshToken = this.decrypt(rows[0].encrypted_refresh_token);
        const oauth2 = new google.auth.OAuth2(this.googleClientId, this.googleClientSecret, this.googleRedirectUri);
        oauth2.setCredentials({ refresh_token: refreshToken });
        return oauth2;
    }

    private async getMicrosoftClient(schemaName: string, userId: string) {
        if (!this.msalClient) throw new BadRequestException('Microsoft not configured');

        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT encrypted_refresh_token FROM calendar_integrations WHERE user_id = $1::uuid AND provider = 'microsoft' AND is_active = true LIMIT 1`,
            [userId],
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
