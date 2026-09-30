import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PlatformCommunicationsService } from './platform-communications.service';
import { audienceWhere, normalizeEmail, parseDraft, renderContent } from './platform-communications.validation';

const adminId = randomUUID();
const tenantId = randomUUID();
const draft = () => ({ name: 'Notice', audience: 'all', recipientRole: 'admins', tenantIds: [], content: { es: { subject: 'Aviso', body: 'Texto' } } });

function setup() {
    const campaign: any = { ...draft(), id: randomUUID(), status: 'draft', revision: 1, previewVersion: null, totalCount: 0 };
    const db: any = {
        $queryRawUnsafe: jest.fn().mockResolvedValue([]),
        platformCommunication: {
            create: jest.fn(async ({ data }) => { Object.assign(campaign, data); return campaign; }),
            findUnique: jest.fn(async () => ({ ...campaign })),
            update: jest.fn(async ({ data }) => {
                const increment = data.revision?.increment;
                Object.assign(campaign, { ...data, revision: increment ? campaign.revision + increment : campaign.revision });
                return { ...campaign };
            }),
            delete: jest.fn(),
        },
        platformCommunicationRecipient: {
            deleteMany: jest.fn(), createMany: jest.fn(), groupBy: jest.fn().mockResolvedValue([]),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        tenant: { count: jest.fn().mockResolvedValue(1) },
        user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    // Model the row lock's serialization while exercising the real mutation
    // state machine. PostgreSQL claim syntax is separately checked below.
    let tail = Promise.resolve();
    db.$transaction = jest.fn((callback) => {
        const result = tail.then(() => callback(db));
        tail = result.then(() => undefined, () => undefined);
        return result;
    });
    const email = { sendWithOutcome: jest.fn().mockResolvedValue({ status: 'accepted' }) };
    const service = new PlatformCommunicationsService(db, email as any);
    return { campaign, db, email, service };
}

describe('Platform communication validation and audience', () => {
    it('limits every audience to active tenant users and active tenants', () => {
        expect(audienceWhere({ audience: 'all', recipientRole: 'all', tenantIds: [] })).toEqual({
            isActive: true, role: { in: ['tenant_admin', 'tenant_supervisor', 'tenant_agent'] }, tenant: { is: { isActive: true } },
        });
        expect(audienceWhere({ audience: 'whatsapp_connected', recipientRole: 'admins', tenantIds: [tenantId] })).toEqual({
            isActive: true, role: 'tenant_admin', tenant: { is: { isActive: true, id: { in: [tenantId] }, channelAccounts: { some: { channelType: 'whatsapp', isActive: true } } } },
        });
    });

    it('rejects malformed audience IDs and CTA URLs instead of widening audience', () => {
        expect(() => parseDraft({ ...draft(), tenantIds: ['bad'] })).toThrow(BadRequestException);
        expect(() => parseDraft({ ...draft(), content: { es: { subject: 'x', body: 'x', ctaLabel: 'x', ctaUrl: 'javascript:alert(1)' } } })).toThrow(BadRequestException);
        expect(() => parseDraft({ ...draft(), content: { es: { subject: 'x\r\nBcc: y@example.com', body: 'x' } } })).toThrow(BadRequestException);
        expect(normalizeEmail('person\nBcc: elsewhere@example.com')).toBeNull();
    });

    it('escapes all authored HTML while preserving paragraph breaks', () => {
        const rendered = renderContent({ subject: '<img>', body: '<script>alert(1)</script>\n\nHello', ctaLabel: '<b>Open</b>', ctaUrl: 'https://example.com/?x="test"' }, 'en');
        expect(rendered.html).toContain('&lt;script&gt;');
        expect(rendered.html).not.toContain('<script>');
        expect(rendered.html).toContain('&quot;test&quot;');
        expect(rendered.text).toContain('<script>');
    });
});

describe('PlatformCommunicationsService', () => {
    it('rejects unknown or inactive explicit tenants', async () => {
        const { service, db } = setup();
        db.tenant.count.mockResolvedValue(0);
        await expect(service.create({ ...draft(), tenantIds: [tenantId] }, adminId)).rejects.toThrow(BadRequestException);
        expect(db.platformCommunication.create).not.toHaveBeenCalled();
    });

    it('freezes a deduplicated, valid audience with explicit Spanish fallback', async () => {
        const { service, db, campaign, email } = setup();
        db.user.findMany.mockResolvedValue([
            { id: '1', email: ' SAME@Example.com ', firstName: 'One', lastName: '', tenant: { id: tenantId, name: 'One', language: 'en-US' } },
            { id: '2', email: 'same@example.com', firstName: 'Two', lastName: '', tenant: { id: tenantId, name: 'Two', language: 'pt-BR' } },
            { id: '3', email: 'invalid', firstName: '', lastName: '', tenant: { id: tenantId, name: 'Three', language: 'es' } },
        ]);
        const result = await service.preview(campaign.id, 1, adminId);
        expect(db.platformCommunicationRecipient.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ email: 'same@example.com', language: 'es', userId: '1', tenantId })] });
        expect(result.totalCount).toBe(1);
        expect(result.previewVersion).toMatch(/^[0-9a-f-]{36}$/);
        expect(result.revision).toBe(1);
        expect(email.sendWithOutcome).not.toHaveBeenCalled();
    });

    it('concurrent/repeated sends queue once with the exact frozen preview', async () => {
        const { service, db, campaign, email } = setup();
        Object.assign(campaign, { status: 'ready', previewVersion: randomUUID(), totalCount: 2 });
        const input = { expectedRevision: 1, previewVersion: campaign.previewVersion };
        await Promise.all([service.send(campaign.id, input, adminId), service.send(campaign.id, input, adminId)]);
        expect(db.platformCommunication.update).toHaveBeenCalledTimes(1);
        expect(campaign).toMatchObject({ status: 'queued', revision: 2, sentBy: adminId });
        expect(db.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), campaign.id);
        expect(email.sendWithOutcome).not.toHaveBeenCalled();
    });

    it('rejects stale previews and prevents editing after send', async () => {
        const { service, campaign } = setup();
        Object.assign(campaign, { status: 'ready', previewVersion: randomUUID(), totalCount: 2 });
        await expect(service.send(campaign.id, { expectedRevision: 1, previewVersion: randomUUID() }, adminId)).rejects.toThrow(ConflictException);
        await service.send(campaign.id, { expectedRevision: 1, previewVersion: campaign.previewVersion }, adminId);
        await expect(service.update(campaign.id, { ...draft(), expectedRevision: 2 }, adminId)).rejects.toThrow(ConflictException);
        await expect(service.preview(campaign.id, 2, adminId)).rejects.toThrow(ConflictException);
    });

    it('editing a ready draft deletes the snapshot and invalidates confirmation', async () => {
        const { service, db, campaign } = setup();
        Object.assign(campaign, { status: 'ready', previewVersion: randomUUID(), totalCount: 2 });
        const oldPreview = campaign.previewVersion;
        await service.update(campaign.id, { ...draft(), expectedRevision: 1 }, adminId);
        expect(campaign).toMatchObject({ status: 'draft', revision: 2, previewVersion: null, totalCount: 0 });
        expect(db.platformCommunicationRecipient.deleteMany).toHaveBeenCalledWith({ where: { campaignId: campaign.id } });
        await expect(service.send(campaign.id, { expectedRevision: 1, previewVersion: oldPreview }, adminId)).rejects.toThrow(ConflictException);
    });

    it('test sends to authenticated admin only and surfaces SMTP failure', async () => {
        const { service, db, campaign, email } = setup();
        await service.test(campaign.id, 'en', 'Admin@Example.com');
        expect(email.sendWithOutcome).toHaveBeenCalledWith(expect.objectContaining({ to: 'admin@example.com', subject: 'Aviso' }));
        expect(db.platformCommunication.update).not.toHaveBeenCalled();
        email.sendWithOutcome.mockResolvedValue({ status: 'failed' });
        await expect(service.test(campaign.id, 'es', 'admin@example.com')).rejects.toThrow(ServiceUnavailableException);
    });

    it('explicit retry selects failed recipients with fewer than three attempts only', async () => {
        const { service, db, campaign } = setup();
        campaign.status = 'completed';
        await service.retry(campaign.id, 1, adminId);
        expect(db.platformCommunicationRecipient.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { campaignId: campaign.id, status: 'failed', attempts: { lt: 3 } } }));
    });
});
