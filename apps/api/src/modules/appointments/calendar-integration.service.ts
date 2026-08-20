import {
    Injectable,
    Logger,
    BadRequestException,
    ConflictException,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { google, calendar_v3 } from 'googleapis';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { Client as GraphClient } from '@microsoft/microsoft-graph-client';
import * as crypto from 'crypto';
import { holdStillAliveSql } from '../../common/utils/payment-policy.util';

type CalendarProvider = 'google' | 'microsoft';
type AssignmentType = 'staff' | 'service' | 'general';

const DEFAULT_TIMEZONE = 'America/Bogota';
const CALENDAR_PROVIDER_DEADLINE_MS = 30_000;
const CALENDAR_OAUTH_STATE_TTL_SECONDS = 10 * 60;
const CALENDAR_OAUTH_STATE_PREFIX = 'oauth:calendar:state:';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface FreeBusySlot {
    start: string;
    end: string;
}

interface CalendarOAuthState {
    version: 1;
    provider: CalendarProvider;
    tenantId: string;
    userId: string;
    assignmentType: AssignmentType;
    assignmentId: string | null;
    issuedAt: string;
}

type CalendarTenantQuery = <T = any[]>(sql: string, params?: any[]) => Promise<T>;

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

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private config: ConfigService,
        private throttle: TenantThrottleService,
    ) {
        const key = config.get<string>('ENCRYPTION_KEY', '');
        if (typeof key !== 'string' || !/^[0-9a-fA-F]{64}$/.test(key)) {
            throw new Error('ENCRYPTION_KEY must be exactly 64 hexadecimal characters');
        }
        this.encryptionKey = Buffer.from(key, 'hex');

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

    }

    // ── OAuth2 URL generation ────────────────────────────────────

    async getGoogleAuthUrl(
        tenantId: string,
        userId: string,
        assignmentType?: AssignmentType,
        assignmentId?: string,
    ): Promise<string> {
        const oauth2 = new google.auth.OAuth2(this.googleClientId, this.googleClientSecret, this.googleRedirectUri);
        const state = await this.issueOAuthState('google', tenantId, userId, assignmentType, assignmentId);
        return oauth2.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: ['https://www.googleapis.com/auth/calendar'],
            state,
        });
    }

    async getMicrosoftAuthUrl(
        tenantId: string,
        userId: string,
        assignmentType?: AssignmentType,
        assignmentId?: string,
    ): Promise<string> {
        this.assertMicrosoftConfigured();
        const state = await this.issueOAuthState('microsoft', tenantId, userId, assignmentType, assignmentId);
        return `https://login.microsoftonline.com/${this.msTenantId}/oauth2/v2.0/authorize?` +
            `client_id=${this.msClientId}&response_type=code&redirect_uri=${encodeURIComponent(this.msRedirectUri)}` +
            `&scope=${encodeURIComponent('Calendars.ReadWrite offline_access')}&state=${encodeURIComponent(state)}&prompt=consent`;
    }

    private async issueOAuthState(
        provider: CalendarProvider,
        tenantId: string,
        userId: string,
        assignmentTypeInput?: AssignmentType,
        assignmentIdInput?: string,
    ): Promise<string> {
        if (!UUID_PATTERN.test(tenantId || '') || !UUID_PATTERN.test(userId || '')) {
            throw new BadRequestException('Invalid calendar OAuth tenant or user binding');
        }
        const assignmentType = assignmentTypeInput || 'general';
        if (!(['general', 'staff', 'service'] as const).includes(assignmentType)) {
            throw new BadRequestException('Invalid calendar assignment type');
        }
        const assignmentId = assignmentType === 'general' ? null : (assignmentIdInput || null);
        if (assignmentId && !UUID_PATTERN.test(assignmentId)) {
            throw new BadRequestException('Invalid calendar assignment identifier');
        }
        if (assignmentType !== 'general' && !assignmentId) {
            throw new BadRequestException('Calendar staff/service assignment requires an identifier');
        }

        const currentBinding = await this.requireCurrentOAuthBinding({
            version: 1,
            provider,
            tenantId,
            userId,
            assignmentType,
            assignmentId,
            issuedAt: new Date().toISOString(),
        });

        const payload: CalendarOAuthState = {
            version: 1,
            provider,
            tenantId,
            userId,
            assignmentType,
            assignmentId: currentBinding.assignmentId,
            issuedAt: new Date().toISOString(),
        };
        const client = this.redis.getClient();
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const nonce = crypto.randomUUID();
            const stored = await client.set(
                `${CALENDAR_OAUTH_STATE_PREFIX}${nonce}`,
                JSON.stringify(payload),
                'EX',
                CALENDAR_OAUTH_STATE_TTL_SECONDS,
                'NX',
            );
            if (stored === 'OK') return nonce;
        }
        throw new BadRequestException('Unable to issue calendar OAuth state');
    }

    private async consumeOAuthState(
        state: string,
        expectedProvider: CalendarProvider,
    ): Promise<CalendarOAuthState & { schemaName: string }> {
        if (!UUID_PATTERN.test(state || '')) {
            throw new BadRequestException('Invalid or expired calendar OAuth state');
        }
        const raw = await this.redis.getClient().eval(
            `local value = redis.call('GET', KEYS[1])
             if value then redis.call('DEL', KEYS[1]) end
             return value`,
            1,
            `${CALENDAR_OAUTH_STATE_PREFIX}${state}`,
        );
        if (typeof raw !== 'string') {
            throw new BadRequestException('Invalid or expired calendar OAuth state');
        }

        let payload: CalendarOAuthState;
        try {
            payload = JSON.parse(raw) as CalendarOAuthState;
        } catch {
            throw new BadRequestException('Invalid or expired calendar OAuth state');
        }
        if (
            payload?.version !== 1
            || payload.provider !== expectedProvider
            || !UUID_PATTERN.test(payload.tenantId || '')
            || !UUID_PATTERN.test(payload.userId || '')
            || !(['general', 'staff', 'service'] as const).includes(payload.assignmentType)
            || (payload.assignmentId !== null && !UUID_PATTERN.test(payload.assignmentId || ''))
            || (payload.assignmentType !== 'general' && !payload.assignmentId)
            || (payload.assignmentType === 'general' && payload.assignmentId !== null)
        ) {
            throw new BadRequestException('Calendar OAuth state binding mismatch');
        }
        const currentBinding = await this.requireCurrentOAuthBinding(payload);
        return {
            ...payload,
            assignmentId: currentBinding.assignmentId,
            schemaName: currentBinding.schemaName,
        };
    }

    private async requireCurrentOAuthBinding(
        binding: CalendarOAuthState,
    ): Promise<{ schemaName: string; assignmentId: string | null }> {
        const [tenant, user] = await Promise.all([
            this.prisma.tenant.findFirst({
                where: { id: binding.tenantId, isActive: true },
                select: { schemaName: true },
            }),
            this.prisma.user.findFirst({
                where: { id: binding.userId, tenantId: binding.tenantId, isActive: true },
                select: { id: true },
            }),
        ]);
        if (!tenant?.schemaName || !user) {
            throw new BadRequestException('Calendar OAuth binding is no longer authorized');
        }

        const query: CalendarTenantQuery = (sql, params = []) => (
            this.prisma.executeInTenantSchema(tenant.schemaName, sql, params)
        );
        const target = await this.resolveActiveAssignmentTarget(
            query,
            tenant.schemaName,
            binding.assignmentType,
            binding.assignmentId,
        );
        if (!target) {
            throw new BadRequestException('Calendar OAuth assignment target is no longer authorized');
        }
        return { schemaName: tenant.schemaName, assignmentId: target.assignmentId };
    }

    /** Shared target authority for OAuth state and post-connect reassignment. */
    private async resolveActiveAssignmentTarget(
        query: CalendarTenantQuery,
        schemaName: string,
        assignmentType: AssignmentType,
        assignmentId: string | null,
    ): Promise<{ assignmentId: string | null } | null> {
        if (assignmentType === 'general') {
            return assignmentId === null ? { assignmentId: null } : null;
        }
        if (!assignmentId || !UUID_PATTERN.test(assignmentId)) return null;

        if (assignmentType === 'service') {
            const services = await query<any[]>(
                `SELECT id FROM services
                 WHERE id = $1::uuid AND is_active = true
                 LIMIT 1
                FOR SHARE`,
                [assignmentId],
            );
            return services?.length ? { assignmentId: services[0].id } : null;
        }

        // Dashboard staff selectors currently send a public user UUID. Translate
        // that authority through the explicit operational binding and persist the
        // canonical staff_members UUID. Never assume both UUID namespaces match.
        const boundStaff = await query<any[]>(
            `SELECT staff.id
               FROM staff_operational_bindings binding
               JOIN staff_members staff
                 ON staff.id = binding.staff_id
                AND staff.is_active = true
              WHERE binding.user_id = $1::uuid
              LIMIT 1
              FOR SHARE OF binding, staff`,
            [assignmentId],
        );
        if (boundStaff?.length) return { assignmentId: boundStaff[0].id };

        // API callers that already hold a canonical staff profile may pass it
        // directly. This is a check in the staff namespace, not a user-ID fallback.
        const staff = await query<any[]>(
            `SELECT id FROM staff_members
             WHERE id = $1::uuid AND is_active = true
             LIMIT 1
             FOR SHARE`,
            [assignmentId],
        );
        return staff?.length ? { assignmentId: staff[0].id } : null;
    }

    private assertMicrosoftConfigured(): void {
        if (!this.msClientId || !this.msClientSecret) {
            throw new BadRequestException('Microsoft Calendar not configured');
        }
    }

    private createMicrosoftClientApplication(): ConfidentialClientApplication {
        this.assertMicrosoftConfigured();
        return new ConfidentialClientApplication({
            auth: {
                clientId: this.msClientId,
                clientSecret: this.msClientSecret,
                authority: `https://login.microsoftonline.com/${this.msTenantId}`,
            },
        });
    }

    // ── OAuth2 Callbacks ─────────────────────────────────────────

    async handleGoogleCallback(code: string, state: string): Promise<CalendarIntegration> {
        const binding = await this.consumeOAuthState(state, 'google');
        const { tenantId, userId, assignmentType, assignmentId, schemaName } = binding;

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

        const calCount = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT COUNT(*)::int AS c FROM calendar_integrations WHERE is_active = true`);
        await this.throttle.enforcePlanLimit(tenantId, 'maxCalendars', calCount?.[0]?.c || 0, 'calendarios');

        await this.prisma.executeInTenantSchema(schemaName,
            `INSERT INTO calendar_integrations (id, user_id, provider, encrypted_refresh_token, calendar_id, account_email, label, assignment_type, assignment_id, connected_at, updated_at)
             VALUES ($1::uuid, $2::uuid, 'google', $3, 'primary', $4, $5, $6, $7::uuid, NOW(), NOW())`,
            [id, userId, encrypted, accountEmail, accountEmail, assignmentType, assignmentId],
        );

        this.logger.log(`Google Calendar connected for user ${userId} (${accountEmail}) [${assignmentType}:${assignmentId || 'none'}]`);
        return this.getIntegrationById(schemaName, id);
    }

    async handleMicrosoftCallback(code: string, state: string): Promise<CalendarIntegration> {
        const binding = await this.consumeOAuthState(state, 'microsoft');
        const { tenantId, userId, assignmentType, assignmentId, schemaName } = binding;
        const msalClient = this.createMicrosoftClientApplication();

        const result = await msalClient.acquireTokenByCode({
            code,
            redirectUri: this.msRedirectUri,
            scopes: ['Calendars.ReadWrite', 'offline_access'],
        });

        const homeAccountId = result.account?.homeAccountId;
        if (!homeAccountId) {
            throw new BadRequestException('Microsoft account identity missing. Reconnect and try again.');
        }
        const accounts = await msalClient.getTokenCache().getAllAccounts();
        const account = accounts.find((candidate) => candidate.homeAccountId === homeAccountId);
        if (!account) {
            throw new BadRequestException('Microsoft account cache mismatch. Reconnect and try again.');
        }
        const accountEmail = account.username || result.account?.username || null;

        // This cache belongs to a fresh CCA and therefore to this exact account.
        // Persist the identity separately and require it again on every read.
        const cacheContent = msalClient.getTokenCache().serialize();
        const encrypted = this.encrypt(cacheContent);
        const id = crypto.randomUUID();

        const calCount = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT COUNT(*)::int AS c FROM calendar_integrations WHERE is_active = true`);
        await this.throttle.enforcePlanLimit(tenantId, 'maxCalendars', calCount?.[0]?.c || 0, 'calendarios');

        await this.prisma.executeInTenantSchema(schemaName,
            `INSERT INTO calendar_integrations
                (id, user_id, provider, encrypted_refresh_token, microsoft_home_account_id,
                 calendar_id, account_email, label, assignment_type, assignment_id, connected_at, updated_at)
             VALUES ($1::uuid, $2::uuid, 'microsoft', $3, $4, 'primary', $5, $6, $7, $8::uuid, NOW(), NOW())`,
            [id, userId, encrypted, homeAccountId, accountEmail, accountEmail, assignmentType, assignmentId],
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
                `SELECT ci.id, ci.user_id, ci.provider, ci.calendar_id, ci.account_email,
                        ci.label, ci.assignment_type, ci.assignment_id, ci.is_active, ci.connected_at
                 FROM staff_operational_bindings binding
                 JOIN staff_members staff
                   ON staff.id = binding.staff_id
                  AND staff.is_active = true
                 JOIN calendar_integrations ci
                   ON ci.is_active = true
                  AND (
                       ci.id = binding.calendar_integration_id
                       OR (ci.assignment_type = 'staff' AND ci.assignment_id = binding.staff_id)
                  )
                 WHERE binding.user_id = $1::uuid
                 ORDER BY
                   CASE WHEN ci.id = binding.calendar_integration_id THEN 0 ELSE 1 END,
                   ci.connected_at ASC, ci.id ASC`,
                [opts.staffId],
            );
            if (staffCalendars.length > 0) return staffCalendars;

            const unreconciledLegacyStaffCalendars = await this.queryIntegrations(schemaName,
                `SELECT legacy_ci.id, legacy_ci.user_id, legacy_ci.provider, legacy_ci.calendar_id,
                        legacy_ci.account_email, legacy_ci.label, legacy_ci.assignment_type,
                        legacy_ci.assignment_id, legacy_ci.is_active, legacy_ci.connected_at
                   FROM calendar_integrations legacy_ci
                  WHERE legacy_ci.is_active = true
                    AND legacy_ci.assignment_type = 'staff'
                    AND legacy_ci.assignment_id = $1::uuid
                    AND NOT EXISTS (
                        SELECT 1
                          FROM staff_operational_bindings binding
                          JOIN staff_members staff
                            ON staff.id = binding.staff_id
                           AND staff.is_active = true
                         WHERE binding.user_id = $1::uuid
                    )
                  ORDER BY legacy_ci.connected_at ASC, legacy_ci.id ASC
                  LIMIT 1`,
                [opts.staffId],
            );
            if (unreconciledLegacyStaffCalendars.length > 0) {
                throw new Error('calendar_staff_binding_reconciliation_required');
            }
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
                return await this.withReadDeadline(
                    () => this.googleFreeBusy(schemaName, integrationId, timeMin, timeMax),
                );
            } else if (integration.provider === 'microsoft') {
                return await this.withReadDeadline(
                    () => this.microsoftFreeBusy(schemaName, integrationId, timeMin, timeMax),
                );
            }
        } catch (error: any) {
            this.logger.warn(`FreeBusy failed for integration ${integrationId} (${integration.provider}): ${error.message}`);
            throw new ServiceUnavailableException('calendar_availability_unverified');
        }
        throw new ServiceUnavailableException('calendar_availability_unverified');
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
        const timezone = await this.getTimezoneFromSchema(schemaName);
        const localDate = this.requireLocalDate(date);
        const nextDate = this.addLocalDays(localDate, 1);
        const timeMin = this.localMidnightToUtc(localDate, timezone);
        const timeMax = this.localMidnightToUtc(nextDate, timezone);
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
            const busy = await this.getFreeBusy(schemaName, integration.id, timeMin, timeMax);
            allBusy.push(...busy.map((slot) => ({
                start: this.instantToLocalWallClock(slot.start, timezone),
                end: this.instantToLocalWallClock(slot.end, timezone),
            })));
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
                    const events = await this.withReadDeadline(
                        () => this.googleListEvents(schemaName, integration.id, startDate, endDate),
                    );
                    allEvents.push(...events);
                } else if (integration.provider === 'microsoft') {
                    const events = await this.withReadDeadline(
                        () => this.microsoftListEvents(schemaName, integration.id, startDate, endDate),
                    );
                    allEvents.push(...events);
                }
            } catch (error: any) {
                this.logger.warn(`ListEvents failed for integration ${integration.id} (${integration.provider}): ${error.message}`);
                throw new ServiceUnavailableException('calendar_events_unverified');
            }
        }
        return allEvents;
    }

    private async withReadDeadline<T>(operation: () => Promise<T>): Promise<T> {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
                () => reject(new Error('calendar_read_deadline_exceeded')),
                CALENDAR_PROVIDER_DEADLINE_MS,
            );
            timeout.unref?.();
        });
        try {
            // These are read-only provider operations. A late promise cannot
            // mutate domain state, while callers fail closed instead of
            // interpreting an unavailable calendar as empty/free.
            return await Promise.race([operation(), deadline]);
        } finally {
            if (timeout) clearTimeout(timeout);
        }
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
        /** Stable outbox key used for provider-native idempotency. */
        idempotencyKey?: string;
    }): Promise<{ eventId: string | null; meetingUrl?: string }> {
        const integration = await this.getIntegrationByIdOrNull(schemaName, integrationId);
        if (!integration || !integration.isActive) return { eventId: null };

        const controller = new AbortController();
        const deadline = setTimeout(() => controller.abort(), CALENDAR_PROVIDER_DEADLINE_MS);
        deadline.unref?.();
        try {
            if (integration.provider === 'google') {
                const client = await this.getGoogleClient(schemaName, integrationId);
                const cal = google.calendar({ version: 'v3', auth: client });
                const timezone = await this.getTimezoneFromSchema(schemaName);

                const event: calendar_v3.Schema$Event = {
                    // Google accepts caller-provided base32hex IDs. A stable hash
                    // makes a retry after an ambiguous network failure resolve to
                    // the same provider event instead of creating a duplicate.
                    id: data.idempotencyKey
                        ? this.googleEventId(data.idempotencyKey)
                        : undefined,
                    summary: data.summary,
                    start: { dateTime: data.startAt, timeZone: timezone },
                    end: { dateTime: data.endAt, timeZone: timezone },
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

                let res: calendar_v3.Schema$Event;
                try {
                    const inserted = await cal.events.insert({
                        calendarId: integration.calendarId || 'primary',
                        requestBody: event,
                        sendUpdates: 'all',
                        conferenceDataVersion: data.isOnline ? 1 : undefined,
                    }, { signal: controller.signal, timeout: CALENDAR_PROVIDER_DEADLINE_MS });
                    res = inserted.data;
                } catch (error: any) {
                    if (data.idempotencyKey && Number(error?.code || error?.response?.status) === 409) {
                        const existing = await cal.events.get({
                            calendarId: integration.calendarId || 'primary',
                            eventId: this.googleEventId(data.idempotencyKey),
                        }, { signal: controller.signal, timeout: CALENDAR_PROVIDER_DEADLINE_MS });
                        res = existing.data;
                    } else {
                        throw error;
                    }
                }
                const meetingUrl = res.conferenceData?.entryPoints?.find(
                    (ep) => ep.entryPointType === 'video',
                )?.uri || undefined;
                this.logger.log(`Google event created: ${res.id} (integration ${integrationId})${meetingUrl ? ` meetingUrl=${meetingUrl}` : ''}`);
                return { eventId: res.id || null, meetingUrl };

            } else if (integration.provider === 'microsoft') {
                const client = await this.getMicrosoftClient(schemaName, integrationId);
                const tz = await this.getTimezoneFromSchema(schemaName);

                const event: any = {
                    transactionId: data.idempotencyKey,
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

                const res = await client.api('/me/events')
                    .option('signal', controller.signal)
                    .post(event);
                const meetingUrl = res.onlineMeeting?.joinUrl || undefined;
                this.logger.log(`Microsoft event created: ${res.id} (integration ${integrationId})${meetingUrl ? ` meetingUrl=${meetingUrl}` : ''}`);
                return { eventId: res.id || null, meetingUrl };
            }
        } catch (error: any) {
            this.logger.error(`Create event failed for integration ${integrationId}: ${error.message}`);
        } finally {
            clearTimeout(deadline);
        }
        return { eventId: null };
    }

    /** Patch a provider event through its owning integration, never by user-ID fallback. */
    async updateEventForIntegration(schemaName: string, integrationId: string, eventId: string, data: {
        summary: string; startAt: string; endAt: string;
        location?: string; description?: string;
    }): Promise<boolean> {
        const integration = await this.getIntegrationByIdOrNull(schemaName, integrationId);
        if (!integration || !integration.isActive || !eventId) return false;
        const controller = new AbortController();
        const deadline = setTimeout(() => controller.abort(), CALENDAR_PROVIDER_DEADLINE_MS);
        deadline.unref?.();
        try {
            if (integration.provider === 'google') {
                const client = await this.getGoogleClient(schemaName, integration.id);
                const cal = google.calendar({ version: 'v3', auth: client });
                const timezone = await this.getTimezoneFromSchema(schemaName);
                await cal.events.patch({
                    calendarId: integration.calendarId || 'primary',
                    eventId,
                    requestBody: {
                        summary: data.summary,
                        start: { dateTime: data.startAt, timeZone: timezone },
                        end: { dateTime: data.endAt, timeZone: timezone },
                        location: data.location,
                        description: data.description,
                    },
                    sendUpdates: 'all',
                }, { signal: controller.signal, timeout: CALENDAR_PROVIDER_DEADLINE_MS });
                return true;
            }
            const client = await this.getMicrosoftClient(schemaName, integration.id);
            const timezone = await this.getTimezoneFromSchema(schemaName);
            await client.api(`/me/events/${encodeURIComponent(eventId)}`)
                .option('signal', controller.signal)
                .patch({
                subject: data.summary,
                start: { dateTime: data.startAt, timeZone: timezone },
                end: { dateTime: data.endAt, timeZone: timezone },
                location: data.location ? { displayName: data.location } : undefined,
                body: data.description
                    ? { content: data.description, contentType: 'text' }
                    : undefined,
                });
            return true;
        } catch (error: any) {
            this.logger.error(`Update event failed for integration ${integration.id}: ${error.message}`);
            return false;
        } finally {
            clearTimeout(deadline);
        }
    }

    /** Provider deletes are idempotent: a missing event already satisfies delete. */
    async deleteEventForIntegration(
        schemaName: string,
        integrationId: string,
        eventId: string,
    ): Promise<boolean> {
        const integration = await this.getIntegrationByIdOrNull(schemaName, integrationId);
        if (!integration || !integration.isActive || !eventId) return false;
        const controller = new AbortController();
        const deadline = setTimeout(() => controller.abort(), CALENDAR_PROVIDER_DEADLINE_MS);
        deadline.unref?.();
        try {
            if (integration.provider === 'google') {
                const client = await this.getGoogleClient(schemaName, integration.id);
                const cal = google.calendar({ version: 'v3', auth: client });
                await cal.events.delete({
                    calendarId: integration.calendarId || 'primary',
                    eventId,
                    sendUpdates: 'all',
                }, { signal: controller.signal, timeout: CALENDAR_PROVIDER_DEADLINE_MS });
            } else {
                const client = await this.getMicrosoftClient(schemaName, integration.id);
                await client.api(`/me/events/${encodeURIComponent(eventId)}`)
                    .option('signal', controller.signal)
                    .delete();
            }
            return true;
        } catch (error: any) {
            const status = Number(error?.code || error?.statusCode || error?.response?.status);
            if (status === 404 || status === 410) return true;
            this.logger.error(`Delete event failed for integration ${integration.id}: ${error.message}`);
            return false;
        } finally {
            clearTimeout(deadline);
        }
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

    /**
     * Update an existing provider event on the same deterministic calendar that
     * the legacy createEvent(userId) wrapper resolves. Rescheduling must patch
     * the original event instead of inserting a second one and leaving the old
     * time visible to staff and customers.
     */
    async updateEvent(schemaName: string, userId: string, eventId: string, data: {
        summary: string; startAt: string; endAt: string;
        location?: string; description?: string;
    }, provider?: CalendarProvider): Promise<boolean> {
        const providerFilter = provider ? ' AND provider = $2' : '';
        const params: any[] = provider ? [userId, provider] : [userId];
        const integrations = await this.queryIntegrations(schemaName,
            `SELECT id, user_id, provider, calendar_id, account_email, label, assignment_type, assignment_id, is_active, connected_at
             FROM calendar_integrations
             WHERE user_id = $1::uuid AND is_active = true${providerFilter}
             ORDER BY connected_at ASC LIMIT 1`,
            params,
        );
        if (integrations.length === 0) return false;

        const integration = integrations[0];
        try {
            if (integration.provider === 'google') {
                const client = await this.getGoogleClient(schemaName, integration.id);
                const cal = google.calendar({ version: 'v3', auth: client });
                await cal.events.patch({
                    calendarId: integration.calendarId || 'primary',
                    eventId,
                    requestBody: {
                        summary: data.summary,
                        start: { dateTime: data.startAt },
                        end: { dateTime: data.endAt },
                        location: data.location,
                        description: data.description,
                    },
                    sendUpdates: 'all',
                });
                return true;
            }

            if (integration.provider === 'microsoft') {
                const client = await this.getMicrosoftClient(schemaName, integration.id);
                const timezone = await this.getTimezoneFromSchema(schemaName);
                await client.api(`/me/events/${encodeURIComponent(eventId)}`).patch({
                    subject: data.summary,
                    start: { dateTime: data.startAt, timeZone: timezone },
                    end: { dateTime: data.endAt, timeZone: timezone },
                    location: data.location ? { displayName: data.location } : undefined,
                    body: data.description
                        ? { content: data.description, contentType: 'text' }
                        : undefined,
                });
                return true;
            }
        } catch (error: any) {
            this.logger.error(
                `Update event failed for integration ${integration.id}: ${error.message}`,
            );
        }
        return false;
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
        await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const integrationRows = await query<any[]>(
                `SELECT id FROM calendar_integrations
                 WHERE id = $1::uuid AND is_active = true
                 FOR UPDATE`,
                [integrationId],
            );
            if (!integrationRows?.length) {
                throw new BadRequestException('Calendar integration not found');
            }

            const blockers = await this.calendarDisconnectBlockers(query, integrationId);
            if (blockers.total > 0) {
                const otherCalendars = await query<any[]>(
                    `SELECT id, label, account_email, provider
                     FROM calendar_integrations
                     WHERE id <> $1::uuid AND is_active = true`,
                    [integrationId],
                );
                throw new BadRequestException({
                    error: 'calendar_owner_reconciliation_required',
                    message: 'Cannot disconnect an integration that still owns appointments, unresolved legacy events, or durable outbox work.',
                    ...blockers,
                    otherCalendars: (otherCalendars || []).map((calendar: any) => ({
                        id: calendar.id,
                        label: calendar.label || calendar.account_email,
                        provider: calendar.provider,
                    })),
                    canReassign: false,
                });
            }

            await query(
                `UPDATE calendar_integrations
                 SET is_active = false, updated_at = NOW()
                 WHERE id = $1::uuid AND is_active = true`,
                [integrationId],
            );
        });
    }

    /**
     * Reassign all future appointments from one calendar/staff to another, then disconnect.
     */
    async reassignAndDisconnect(
        schemaName: string,
        integrationId: string,
        targetIntegrationId: string,
    ): Promise<{ reassigned: number }> {
        if (integrationId === targetIntegrationId) {
            throw new BadRequestException('Target calendar must differ from source calendar');
        }
        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const source = await query<any[]>(
                `SELECT id FROM calendar_integrations
                 WHERE id = $1::uuid AND is_active = true
                 FOR UPDATE`,
                [integrationId],
            );
            if (!source?.length) throw new BadRequestException('Source calendar not found');
            const target = await query<any[]>(
                `SELECT id FROM calendar_integrations
                 WHERE id = $1::uuid AND is_active = true
                 FOR UPDATE`,
                [targetIntegrationId],
            );
            if (!target?.length) throw new BadRequestException('Target calendar not found');

            const blockers = await this.calendarDisconnectBlockers(query, integrationId);
            if (blockers.total > 0) {
                // A safe reassignment is a two-provider operation: delete the
                // exact old event, then enqueue a target-owned upsert. The
                // current endpoint has no durable two-phase state machine, so
                // it must not rewrite assigned_to or deactivate the owner.
                throw new BadRequestException({
                    error: 'calendar_reassignment_workflow_required',
                    message: 'Calendar reassignment is blocked until the durable delete/upsert reconciliation workflow is available.',
                    ...blockers,
                    targetIntegrationId,
                    applySupported: false,
                });
            }

            await query(
                `UPDATE calendar_integrations
                 SET is_active = false, updated_at = NOW()
                 WHERE id = $1::uuid AND is_active = true`,
                [integrationId],
            );
            return { reassigned: 0 };
        });
    }

    private async calendarDisconnectBlockers(
        query: <T = unknown>(sql: string, params?: unknown[]) => Promise<T>,
        integrationId: string,
    ): Promise<{
        ownedAppointments: number;
        activeOutboxItems: number;
        unresolvedLegacyEvents: number;
        total: number;
    }> {
        const rows = await query<any[]>(
            `SELECT
                (SELECT COUNT(*)::int FROM appointments
                 WHERE calendar_integration_id = $1::uuid
                   AND (
                       calendar_sync_state NOT IN ('deleted', 'not_configured')
                       OR (start_at > NOW() AND Nonestatus NOT IN ('cancelled', 'completed', 'no_show') AND ${holdStillAliveSql()})
                   )) AS owned_appointments,
                (SELECT COUNT(*)::int FROM calendar_sync_outbox
                 WHERE integration_id = $1::uuid
                   AND state IN ('pending', 'processing', 'failed')) AS active_outbox_items,
                (SELECT COUNT(*)::int FROM appointments
                 WHERE calendar_integration_id IS NULL
                   AND COALESCE(calendar_sync_state, 'not_configured') <> 'deleted'
                   AND (calendar_event_id IS NOT NULL
                        OR google_event_id IS NOT NULL
                        OR outlook_event_id IS NOT NULL)) AS unresolved_legacy_events`,
            [integrationId],
        );
        const ownedAppointments = Number(rows?.[0]?.owned_appointments || 0);
        const activeOutboxItems = Number(rows?.[0]?.active_outbox_items || 0);
        const unresolvedLegacyEvents = Number(rows?.[0]?.unresolved_legacy_events || 0);
        return {
            ownedAppointments,
            activeOutboxItems,
            unresolvedLegacyEvents,
            total: ownedAppointments + activeOutboxItems + unresolvedLegacyEvents,
        };
    }

    // ── Update assignment ───────────────────────────────────────

    async updateAssignment(
        schemaName: string,
        integrationId: string,
        data: { label?: string; assignmentType?: string; assignmentId?: string },
    ): Promise<void> {
        if (!UUID_PATTERN.test(integrationId || '')) {
            throw new NotFoundException('Calendar integration not found');
        }
        const sets: string[] = [];
        const params: any[] = [integrationId];
        let idx = 2;
        const assignmentRequested = data.assignmentType !== undefined || data.assignmentId !== undefined;
        let assignmentType: AssignmentType | null = null;
        let assignmentId: string | null = null;
        let assignmentIdParamIndex: number | null = null;

        if (data.label !== undefined) {
            sets.push(`label = $${idx}`);
            params.push(data.label);
            idx++;
        }
        if (assignmentRequested) {
            if (data.assignmentType === undefined) {
                throw new BadRequestException('Calendar assignment type is required when an identifier is provided');
            }
            if (!(['general', 'staff', 'service'] as const).includes(data.assignmentType as AssignmentType)) {
                throw new BadRequestException('Invalid calendar assignment type');
            }
            assignmentType = data.assignmentType as AssignmentType;
            if (assignmentType === 'general') {
                if (data.assignmentId != null && data.assignmentId !== '') {
                    throw new BadRequestException('General calendar assignment cannot include an identifier');
                }
            } else {
                if (!data.assignmentId) {
                    throw new BadRequestException('Calendar staff/service assignment requires an identifier');
                }
                if (!UUID_PATTERN.test(data.assignmentId)) {
                    throw new BadRequestException('Invalid calendar assignment identifier');
                }
                assignmentId = data.assignmentId;
            }
            sets.push(`assignment_type = $${idx}`);
            params.push(assignmentType);
            idx++;
            sets.push(`assignment_id = $${idx}::uuid`);
            params.push(assignmentId);
            assignmentIdParamIndex = params.length - 1;
            idx++;
        }

        if (sets.length === 0) {
            throw new BadRequestException('No calendar assignment changes provided');
        }

        sets.push('updated_at = NOW()');
        await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const integrations = await query<Array<{ id: string; is_active: boolean }>>(
                `SELECT id, is_active
                   FROM calendar_integrations
                  WHERE id = $1::uuid
                  LIMIT 1
                  FOR SHARE`,
                [integrationId],
            );
            if (!integrations[0]) throw new NotFoundException('Calendar integration not found');
            if (!integrations[0].is_active) {
                throw new ConflictException('Calendar integration is inactive');
            }

            if (assignmentRequested) {
                const target = await this.resolveActiveAssignmentTarget(
                    query,
                    schemaName,
                    assignmentType!,
                    assignmentId,
                );
                if (!target) {
                    throw new ConflictException('Calendar assignment target is not active or does not belong to this tenant');
                }
                assignmentId = target.assignmentId;
                if (assignmentIdParamIndex !== null) {
                    params[assignmentIdParamIndex] = target.assignmentId;
                }
            }

            const updated = await query<Array<{ id: string }>>(
                `UPDATE calendar_integrations
                    SET ${sets.join(', ')}
                  WHERE id = $1::uuid AND is_active = true
                  RETURNING id`,
                params,
            );
            if (!updated[0]) {
                throw new ConflictException('Calendar integration became inactive before the update completed');
            }
        });
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

    private requireLocalDate(value: string): string {
        const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) throw new BadRequestException('Invalid calendar date');
        const [, year, month, day] = match;
        const probe = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
        if (
            probe.getUTCFullYear() !== Number(year)
            || probe.getUTCMonth() !== Number(month) - 1
            || probe.getUTCDate() !== Number(day)
        ) throw new BadRequestException('Invalid calendar date');
        return value;
    }

    private addLocalDays(date: string, days: number): string {
        const [year, month, day] = date.split('-').map(Number);
        const next = new Date(Date.UTC(year, month - 1, day + days, 12));
        return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
    }

    private localMidnightToUtc(date: string, timezone: string): string {
        const [year, month, day] = date.split('-').map(Number);
        const desired = Date.UTC(year, month - 1, day, 0, 0, 0);
        let candidate = desired;
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hourCycle: 'h23',
        });
        for (let iteration = 0; iteration < 4; iteration += 1) {
            const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate))
                .filter((part) => part.type !== 'literal')
                .map((part) => [part.type, Number(part.value)]));
            const represented = Date.UTC(
                parts.year, parts.month - 1, parts.day,
                parts.hour, parts.minute, parts.second,
            );
            const correction = desired - represented;
            candidate += correction;
            if (correction === 0) break;
        }
        return new Date(candidate).toISOString();
    }

    private instantToLocalWallClock(value: string, timezone: string): string {
        if (!value) return value;
        const instant = new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);
        if (Number.isNaN(instant.getTime())) throw new Error('calendar_provider_invalid_busy_time');
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hourCycle: 'h23',
        });
        const parts = Object.fromEntries(formatter.formatToParts(instant)
            .filter((part) => part.type !== 'literal')
            .map((part) => [part.type, part.value]));
        return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
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
        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT encrypted_refresh_token, microsoft_home_account_id
             FROM calendar_integrations
             WHERE id = $1::uuid AND provider = 'microsoft' AND is_active = true
             LIMIT 1`,
            [integrationId],
        );
        if (!rows?.[0]) throw new BadRequestException('Microsoft Calendar not connected');
        const homeAccountId = rows[0].microsoft_home_account_id;
        if (!homeAccountId) {
            throw new BadRequestException('Microsoft Calendar must be reconnected to bind its account identity.');
        }

        const msalClient = this.createMicrosoftClientApplication();
        const cache = this.decrypt(rows[0].encrypted_refresh_token);
        msalClient.getTokenCache().deserialize(cache);

        const accounts = await msalClient.getTokenCache().getAllAccounts();
        const account = accounts.find((candidate) => candidate.homeAccountId === homeAccountId);
        if (!account) throw new BadRequestException('Microsoft account expired or mismatched. Reconnect.');

        const result = await msalClient.acquireTokenSilent({
            account,
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

    /** Google event IDs accept lowercase base32hex; SHA-256 hex is valid. */
    private googleEventId(idempotencyKey: string): string {
        return crypto.createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 52);
    }

    // ── Cron: renew Google watch channels ─────────────────────────

    @Cron('0 */12 * * *')
    async renewWatchChannels(): Promise<void> {
        // Future: implement Google Calendar push notifications
        // For now, availability is checked on-demand via freebusy.query()
    }
}
