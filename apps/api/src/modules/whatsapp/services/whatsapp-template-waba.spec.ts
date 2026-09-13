import { WhatsappTemplateService } from './whatsapp-template.service';

/**
 * ═══ A TEMPLATE CATALOGUE BELONGS TO A WABA, NOT TO A NUMBER ═══
 *
 * Two things followed from treating it as per-number:
 *
 *   1. A tenant with two numbers on the SAME WhatsApp Business Account
 *      submitted every seed template twice — two POSTs to Meta for one
 *      catalogue, the second answered with a duplicate-name error.
 *   2. A status webhook matched on `(name, language)` with no WABA restriction,
 *      and the names are OUR seed names, so an approval on one WABA marked the
 *      identically named template of the other as APPROVED. Meta had never
 *      approved it there, and the send failed at the provider.
 */
describe('templates are operated once per WABA', () => {
    const TENANT = '11111111-1111-4111-8111-111111111111';
    const SCHEMA = 'tenant_waba';

    const serviceWith = (channels: any[]) => {
        const queries: { sql: string; params: any[] }[] = [];
        const prisma = {
            executeInTenantSchema: jest.fn(async (_schema: string, sql: string, params: any[] = []) => {
                queries.push({ sql, params });
                if (sql.includes('seeds_submitted FROM whatsapp_channels')) return [{ seeds_submitted: false }];
                return [];
            }),
            tenant: { findUnique: jest.fn().mockResolvedValue({ language: 'es-CO' }) },
        };
        const created: { wabaId: string; name: string }[] = [];
        const connectionService = {
            getChannelStatus: jest.fn().mockResolvedValue({ status: 'connected', channel: channels[0], channels }),
            getValidAccessToken: jest.fn(async (_schema: string, phoneNumberId?: string) => {
                const channel = channels.find(entry => entry.phone_number_id === phoneNumberId) ?? channels[0];
                return {
                    accessToken: 'token', phoneNumberId: channel.phone_number_id,
                    wabaId: channel.meta_waba_id, channelId: channel.id,
                };
            }),
        };
        const service = new WhatsappTemplateService(
            prisma as any,
            { getSchemaName: jest.fn().mockResolvedValue(SCHEMA) } as any,
            {} as any,
            connectionService as any,
        );
        // The Meta call is not the subject; which WABA it is aimed at is.
        (service as any).createTemplate = jest.fn(
            async (_schema: string, _channelId: string, wabaId: string, _token: string, payload: any) => {
                created.push({ wabaId, name: payload.name });
                return { metaTemplateId: `meta-${wabaId}-${payload.name}`, status: 'PENDING', category: 'UTILITY' };
            });
        return { service, prisma, queries, created, connectionService };
    };

    const channel = (phoneNumberId: string, wabaId: string) => ({
        id: `chan-${phoneNumberId}`, phone_number_id: phoneNumberId, meta_waba_id: wabaId,
    });

    it('submits one catalogue for two numbers that share a WABA', async () => {
        const { service, created } = serviceWith([
            channel('1111', 'WABA-A'), channel('2222', 'WABA-A'),
        ]);
        await service.seedTemplates(TENANT);
        // Three seed templates, once — not six.
        expect(new Set(created.map(entry => entry.wabaId))).toEqual(new Set(['WABA-A']));
        expect(new Set(created.map(entry => entry.name)).size).toBe(created.length);
    });

    it('submits both catalogues for two numbers on different WABAs', async () => {
        const { service, created } = serviceWith([
            channel('1111', 'WABA-A'), channel('2222', 'WABA-B'),
        ]);
        await service.seedTemplates(TENANT);
        expect(new Set(created.map(entry => entry.wabaId))).toEqual(new Set(['WABA-A', 'WABA-B']));
    });

    it('keeps two numbers with no WABA id apart instead of merging them', async () => {
        // A row mid-onboarding has no WABA yet. Collapsing them onto one key
        // would seed one and silently skip the other, so they are grouped under
        // their own number instead.
        const { service, created, connectionService } = serviceWith([
            channel('1111', ''), channel('2222', ''),
        ]);
        await service.seedTemplates(TENANT);
        const asked = connectionService.getValidAccessToken.mock.calls.map(call => call[1]);
        expect(new Set(asked)).toEqual(new Set(['1111', '2222']));
        // And both were actually submitted, not merely resolved.
        expect(created.length).toBeGreaterThanOrEqual(2);
    });

    describe('a status event only touches the WABA that produced it', () => {
        const applied = async (wabaId?: string | null) => {
            const { service, queries } = serviceWith([channel('1111', 'WABA-A')]);
            await service.applyStatusUpdate(SCHEMA, {
                message_template_id: 'meta-1', message_template_name: 'appointment_reminder',
                message_template_language: 'es', event: 'APPROVED', wabaId,
            });
            const update = queries.find(entry => entry.sql.includes('UPDATE whatsapp_templates'));
            return { sql: update!.sql, params: update!.params };
        };

        it('restricts the update to the channels of that WABA', async () => {
            const { sql, params } = await applied('WABA-A');
            // Joined to the channel, and the WABA is a parameter of the match —
            // not a comment saying it should be.
            expect(sql).toContain('FROM whatsapp_channels c');
            expect(sql).toContain('c.meta_waba_id = $6');
            expect(params[5]).toBe('WABA-A');
        });

        it('drops the name+language fallback when no WABA is known', async () => {
            // `meta_template_id` is globally unique, so the update stays correct
            // — just narrower. Keeping the fallback unrestricted is what let one
            // WABA's approval mark another's template.
            const { sql, params } = await applied(undefined);
            expect(params[5]).toBe('');
            expect(sql).toContain("($6 <> '' AND t.name = $4 AND t.language = $5)");
        });
    });
});
