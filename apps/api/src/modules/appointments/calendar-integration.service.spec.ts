import { google } from 'googleapis';
import { CalendarIntegrationService } from './calendar-integration.service';

describe('CalendarIntegrationService.updateEvent', () => {
    const schemaName = 'tenant_calendar_patch';
    const userId = '11111111-1111-4111-8111-111111111111';
    const integrationId = '22222222-2222-4222-8222-222222222222';
    const data = {
        summary: 'Consulta — Reprogramado',
        startAt: '2026-08-12T11:00:00',
        endAt: '2026-08-12T11:30:00',
    };

    function createService() {
        const prisma = {
            executeInTenantSchema: jest.fn(),
            tenant: {
                findFirst: jest.fn(),
            },
        };
        const config = {
            get: jest.fn((_key: string, fallback?: unknown) => fallback),
        };
        const service = new CalendarIntegrationService(
            prisma as any,
            {} as any,
            config as any,
            {} as any,
        );
        return { service, prisma };
    }

    function integration(provider: 'google' | 'microsoft') {
        return {
            id: integrationId,
            userId,
            provider,
            calendarId: provider === 'google' ? 'team-calendar' : 'primary',
            accountEmail: null,
            label: null,
            assignmentType: 'general',
            assignmentId: null,
            isActive: true,
            connectedAt: '2026-08-01T00:00:00.000Z',
        };
    }

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('PATCHes the original Google event and never inserts a replacement', async () => {
        const { service } = createService();
        const patch = jest.fn().mockResolvedValue({ data: { id: 'google-event-1' } });
        const insert = jest.fn();
        const calendarSpy = jest.spyOn(google as any, 'calendar').mockReturnValue({
            events: { patch, insert },
        });
        jest.spyOn(service as any, 'queryIntegrations').mockResolvedValue([integration('google')]);
        jest.spyOn(service as any, 'getGoogleClient').mockResolvedValue({ oauth: true });

        const result = await service.updateEvent(
            schemaName,
            userId,
            'google-event-1',
            data,
            'google',
        );

        expect(result).toBe(true);
        expect(calendarSpy).toHaveBeenCalledTimes(1);
        expect(patch).toHaveBeenCalledWith({
            calendarId: 'team-calendar',
            eventId: 'google-event-1',
            requestBody: {
                summary: data.summary,
                start: { dateTime: data.startAt },
                end: { dateTime: data.endAt },
                location: undefined,
                description: undefined,
            },
            sendUpdates: 'all',
        });
        expect(insert).not.toHaveBeenCalled();
        expect((service as any).queryIntegrations).toHaveBeenCalledWith(
            schemaName,
            expect.stringContaining('provider = $2'),
            [userId, 'google'],
        );
    });

    it('PATCHes the original Microsoft event URL and never posts a replacement', async () => {
        const { service } = createService();
        const patch = jest.fn().mockResolvedValue({ id: 'outlook-event/1' });
        const post = jest.fn();
        const api = jest.fn().mockReturnValue({ patch, post });
        jest.spyOn(service as any, 'queryIntegrations').mockResolvedValue([integration('microsoft')]);
        jest.spyOn(service as any, 'getMicrosoftClient').mockResolvedValue({ api });
        jest.spyOn(service as any, 'getTimezoneFromSchema').mockResolvedValue('America/Bogota');

        const result = await service.updateEvent(
            schemaName,
            userId,
            'outlook-event/1',
            data,
            'microsoft',
        );

        expect(result).toBe(true);
        expect(api).toHaveBeenCalledWith('/me/events/outlook-event%2F1');
        expect(patch).toHaveBeenCalledWith({
            subject: data.summary,
            start: { dateTime: data.startAt, timeZone: 'America/Bogota' },
            end: { dateTime: data.endAt, timeZone: 'America/Bogota' },
            location: undefined,
            body: undefined,
        });
        expect(post).not.toHaveBeenCalled();
        expect((service as any).queryIntegrations).toHaveBeenCalledWith(
            schemaName,
            expect.stringContaining('provider = $2'),
            [userId, 'microsoft'],
        );
    });
});
