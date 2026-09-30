import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, PlatformCommunication } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { audienceWhere, CommunicationDraft, contentLanguage, invalid, LANGUAGES, Language, LocalizedContent, normalizeEmail, pagination, parseDraft, renderContent, revision, uuid } from './platform-communications.validation';

const EDITABLE = ['draft', 'ready'];
const conflict = (code = 'COMMUNICATION_REVISION_CONFLICT'): never => { throw new ConflictException({ error: code, message: code }); };

@Injectable()
export class PlatformCommunicationsService {
    constructor(private readonly prisma: PrismaService, private readonly email: EmailService) {}

    private async lock(tx: Prisma.TransactionClient, id: string): Promise<PlatformCommunication> {
        uuid(id);
        // Serialize edits, preview, send and retry across API replicas.
        await tx.$queryRawUnsafe('SELECT id FROM public.platform_communications WHERE id = $1::uuid FOR UPDATE', id);
        const campaign = await tx.platformCommunication.findUnique({ where: { id } });
        if (!campaign) throw new NotFoundException({ error: 'COMMUNICATION_NOT_FOUND', message: 'COMMUNICATION_NOT_FOUND' });
        return campaign;
    }

    private assertEditable(campaign: PlatformCommunication, expectedRevision: number) {
        if (!EDITABLE.includes(campaign.status)) conflict('COMMUNICATION_ALREADY_STARTED');
        if (campaign.revision !== expectedRevision) conflict();
    }

    private async validateTenants(tx: Prisma.TransactionClient, tenantIds: string[]) {
        if (!tenantIds.length) return;
        const count = await tx.tenant.count({ where: { id: { in: tenantIds }, isActive: true } });
        if (count !== tenantIds.length) invalid('COMMUNICATION_INVALID_TENANTS');
    }

    async create(input: unknown, creatorId: string) {
        const draft = parseDraft(input);
        const campaign = await this.prisma.$transaction(async (tx) => {
            await this.validateTenants(tx, draft.tenantIds);
            return tx.platformCommunication.create({ data: { ...draft, content: draft.content as unknown as Prisma.InputJsonValue, createdBy: creatorId, updatedBy: creatorId } });
        });
        return this.detail(campaign.id);
    }

    async update(id: string, input: Record<string, unknown>, actorId: string) {
        const draft = parseDraft(input);
        const expected = revision(input.expectedRevision);
        await this.prisma.$transaction(async (tx) => {
            const campaign = await this.lock(tx, id);
            this.assertEditable(campaign, expected);
            await this.validateTenants(tx, draft.tenantIds);
            await tx.platformCommunicationRecipient.deleteMany({ where: { campaignId: id } });
            await tx.platformCommunication.update({ where: { id }, data: {
                ...draft, content: draft.content as unknown as Prisma.InputJsonValue,
                revision: { increment: 1 }, status: 'draft', previewVersion: null, previewedAt: null, totalCount: 0,
                updatedBy: actorId,
            } });
        });
        return this.detail(id);
    }

    async remove(id: string, expectedRevision: number) {
        await this.prisma.$transaction(async (tx) => {
            const campaign = await this.lock(tx, id);
            this.assertEditable(campaign, revision(expectedRevision));
            await tx.platformCommunication.delete({ where: { id } });
        });
        return { deleted: true };
    }

    async list(page?: string, pageSize?: string) {
        const args = pagination(page, pageSize);
        const [items, total] = await Promise.all([
            this.prisma.platformCommunication.findMany({ skip: args.skip, take: args.pageSize, orderBy: { createdAt: 'desc' } }),
            this.prisma.platformCommunication.count(),
        ]);
        return { items: await Promise.all(items.map((item) => this.withCounters(item))), total, page: args.page, pageSize: args.pageSize };
    }

    async tenants(search?: string, page?: string, pageSize?: string) {
        const args = pagination(page, pageSize);
        const where: Prisma.TenantWhereInput = { isActive: true, ...(search ? { name: { contains: search.slice(0, 100), mode: 'insensitive' } } : {}) };
        const [items, total] = await Promise.all([
            this.prisma.tenant.findMany({ where, select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: args.skip, take: args.pageSize }),
            this.prisma.tenant.count({ where }),
        ]);
        return { items, total, page: args.page, pageSize: args.pageSize };
    }

    async detail(id: string) {
        const campaign = await this.prisma.platformCommunication.findUnique({ where: { id: uuid(id) } });
        if (!campaign) throw new NotFoundException({ error: 'COMMUNICATION_NOT_FOUND', message: 'COMMUNICATION_NOT_FOUND' });
        return this.withCounters(campaign);
    }

    private async withCounters(campaign: PlatformCommunication) {
        const counts = await this.prisma.platformCommunicationRecipient.groupBy({ by: ['status'], where: { campaignId: campaign.id }, _count: { _all: true } });
        // Counts derive from durable recipient records, avoiding counter drift on crashes.
        const counters: Record<string, number> = { total: campaign.totalCount, pending: 0, processing: 0, accepted: 0, failed: 0, unknown: 0, skipped: 0 };
        for (const count of counts) counters[count.status] = count._count._all;
        return { ...campaign, counters };
    }

    async recipients(id: string, page?: string, pageSize?: string) {
        await this.detail(id);
        const args = pagination(page, pageSize);
        const [items, total] = await Promise.all([
            this.prisma.platformCommunicationRecipient.findMany({ where: { campaignId: id }, skip: args.skip, take: args.pageSize, orderBy: [{ email: 'asc' }, { id: 'asc' }],
                select: { id: true, tenantId: true, tenantName: true, email: true, name: true, language: true, status: true, errorCode: true, attempts: true, acceptedAt: true } }),
            this.prisma.platformCommunicationRecipient.count({ where: { campaignId: id } }),
        ]);
        return { items, total, page: args.page, pageSize: args.pageSize };
    }

    async preview(id: string, expectedRevision: number, actorId: string) {
        await this.prisma.$transaction(async (tx) => {
            const campaign = await this.lock(tx, id);
            this.assertEditable(campaign, revision(expectedRevision));
            const draft = campaign as unknown as CommunicationDraft;
            await this.validateTenants(tx, campaign.tenantIds);
            const users = await tx.user.findMany({
                where: audienceWhere(draft), orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                select: { id: true, email: true, firstName: true, lastName: true, tenant: { select: { id: true, name: true, language: true } } },
            });
            const seen = new Set<string>();
            const recipients: Prisma.PlatformCommunicationRecipientCreateManyInput[] = [];
            for (const user of users) {
                const email = normalizeEmail(user.email);
                if (!email || seen.has(email) || !user.tenant) continue;
                seen.add(email);
                recipients.push({ campaignId: id, userId: user.id, tenantId: user.tenant.id, tenantName: user.tenant.name,
                    name: `${user.firstName} ${user.lastName}`.trim(), email,
                    language: contentLanguage(user.tenant.language, draft.content),
                });
            }
            await tx.platformCommunicationRecipient.deleteMany({ where: { campaignId: id } });
            for (let i = 0; i < recipients.length; i += 500) {
                await tx.platformCommunicationRecipient.createMany({ data: recipients.slice(i, i + 500) });
            }
            await tx.platformCommunication.update({ where: { id }, data: { status: 'ready', previewVersion: randomUUID(), previewedAt: new Date(), totalCount: recipients.length, updatedBy: actorId } });
        }, { timeout: 60000 });
        return this.detail(id);
    }

    async send(id: string, input: { expectedRevision: number; previewVersion: string }, actorId: string) {
        const expected = revision(input?.expectedRevision);
        const version = uuid(input?.previewVersion);
        await this.prisma.$transaction(async (tx) => {
            const campaign = await this.lock(tx, id);
            // Retried HTTP requests cannot queue a recipient twice.
            if (['queued', 'sending', 'completed'].includes(campaign.status) && campaign.previewVersion === version && campaign.revision === expected + 1) return;
            if (campaign.revision !== expected || campaign.previewVersion !== version || campaign.status !== 'ready') conflict('COMMUNICATION_PREVIEW_REQUIRED');
            if (!campaign.totalCount) invalid('COMMUNICATION_EMPTY_AUDIENCE');
            await tx.platformCommunication.update({ where: { id }, data: { status: 'queued', revision: { increment: 1 }, startedAt: new Date(), completedAt: null, sentBy: actorId, updatedBy: actorId } });
        });
        return this.detail(id);
    }

    async retry(id: string, expectedRevision: number, actorId: string) {
        await this.prisma.$transaction(async (tx) => {
            const campaign = await this.lock(tx, id);
            if (campaign.revision !== revision(expectedRevision)) conflict();
            if (campaign.status !== 'completed') conflict('COMMUNICATION_NOT_COMPLETED');
            const result = await tx.platformCommunicationRecipient.updateMany({ where: { campaignId: id, status: 'failed', attempts: { lt: 3 } },
                data: { status: 'pending', errorCode: null, claimedAt: null, claimToken: null } });
            if (!result.count) invalid('COMMUNICATION_NO_RETRYABLE_RECIPIENTS');
            await tx.platformCommunication.update({ where: { id }, data: { status: 'queued', revision: { increment: 1 }, completedAt: null, updatedBy: actorId } });
        });
        return this.detail(id);
    }

    async test(id: string, language: unknown, authenticatedEmail: string) {
        if (!LANGUAGES.includes(language as Language)) invalid();
        const to = normalizeEmail(authenticatedEmail);
        if (!to) invalid('COMMUNICATION_INVALID_TEST_RECIPIENT');
        const campaign = await this.detail(id);
        const content = campaign.content as unknown as LocalizedContent;
        const lang = contentLanguage(language as string, content);
        const result = await this.email.sendWithOutcome({ to, ...renderContent(content[lang]!, lang) });
        if (result.status !== 'accepted') throw new ServiceUnavailableException({ error: result.status === 'unknown' ? 'COMMUNICATION_SMTP_UNKNOWN' : 'COMMUNICATION_SMTP_FAILED', message: 'COMMUNICATION_TEST_NOT_ACCEPTED' });
        return { status: 'accepted', language: lang };
    }
}
