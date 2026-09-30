import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { audienceWhere, CommunicationDraft, Language, LocalizedContent, normalizeEmail, renderContent } from './platform-communications.validation';

@Injectable()
export class PlatformCommunicationsProcessor {
    private readonly logger = new Logger(PlatformCommunicationsProcessor.name);
    private running = false;
    constructor(private readonly prisma: PrismaService, private readonly email: EmailService) {}

    @Cron('*/15 * * * * *')
    async processBatch() {
        if (this.running) return;
        this.running = true;
        try {
            // A crash may happen after SMTP acceptance but before persistence.
            // Preserve uncertainty for manual review; never requeue these rows.
            await this.prisma.platformCommunicationRecipient.updateMany({
                where: { status: 'processing', claimedAt: { lt: new Date(Date.now() - 15 * 60 * 1000) } },
                data: { status: 'unknown', errorCode: 'SMTP_OUTCOME_UNKNOWN' },
            });
            for (let index = 0; index < 5; index++) {
                const claimed = await this.claimNext();
                if (!claimed) break;
                await this.processRecipient(claimed.id, claimed.claimToken);
            }
            await this.finishCampaigns();
        } catch {
            // Avoid logging recipient addresses, content or SMTP credentials.
            this.logger.error('Platform communication batch interrupted; durable recipient state retained');
        } finally {
            this.running = false;
        }
    }

    async claimNext(): Promise<{ id: string; claimToken: string } | null> {
        const token = randomUUID();
        const rows = await this.prisma.$queryRawUnsafe(`
            WITH candidate AS (
                SELECT r.id
                FROM public.platform_communication_recipients r
                JOIN public.platform_communications c ON c.id = r.campaign_id
                WHERE r.status = 'pending' AND r.attempts < 3 AND c.status IN ('queued', 'sending')
                ORDER BY c.started_at, r.created_at, r.id
                LIMIT 1 FOR UPDATE OF r SKIP LOCKED
            )
            UPDATE public.platform_communication_recipients r
            SET status = 'processing', attempts = attempts + 1, claimed_at = NOW(),
                claim_token = $1::uuid, updated_at = NOW()
            FROM candidate WHERE r.id = candidate.id
            RETURNING r.id, r.claim_token AS "claimToken"
        `, token) as Array<{ id: string; claimToken: string }>;
        return rows[0] || null;
    }

    async processRecipient(id: string, claimToken: string) {
        const recipient = await this.prisma.platformCommunicationRecipient.findUnique({ where: { id }, include: { campaign: true } });
        if (!recipient || recipient.status !== 'processing' || recipient.claimToken !== claimToken) return;
        const { campaign } = recipient;
        await this.prisma.platformCommunication.updateMany({ where: { id: campaign.id, status: 'queued' }, data: { status: 'sending' } });
        // Eligibility may shrink after preview, but may never add recipients or
        // change a destination: use the frozen user, tenant and email together.
        const eligible = await this.prisma.user.findFirst({ where: {
            ...audienceWhere(campaign as unknown as CommunicationDraft), id: recipient.userId, tenantId: recipient.tenantId,
        }, select: { email: true } });
        if (!eligible || normalizeEmail(eligible.email) !== recipient.email) {
            await this.finishRecipient(id, claimToken, 'skipped', 'RECIPIENT_NO_LONGER_ELIGIBLE');
            return;
        }
        const content = campaign.content as unknown as LocalizedContent;
        const language = recipient.language as Language;
        let outcome: 'accepted' | 'failed' | 'unknown';
        try {
            outcome = (await this.email.sendWithOutcome({ to: recipient.email, ...renderContent(content[language] || content.es, language) })).status;
        } catch {
            // This includes unexpected transport implementations; we cannot
            // prove whether the server accepted the message.
            outcome = 'unknown';
        }
        await this.finishRecipient(id, claimToken, outcome, outcome === 'accepted' ? null : outcome === 'failed' ? 'SMTP_NOT_ACCEPTED' : 'SMTP_OUTCOME_UNKNOWN');
    }

    private async finishRecipient(id: string, claimToken: string, status: string, errorCode: string | null) {
        await this.prisma.platformCommunicationRecipient.updateMany({ where: { id, claimToken, status: 'processing' }, data: {
            status, errorCode, ...(status === 'accepted' ? { acceptedAt: new Date() } : {}),
        } });
    }

    private async finishCampaigns() {
        const campaigns = await this.prisma.platformCommunication.findMany({ where: {
            status: { in: ['queued', 'sending'] }, recipients: { none: { status: { in: ['pending', 'processing'] } } },
        }, select: { id: true }, take: 100, orderBy: { startedAt: 'asc' } });
        for (const { id } of campaigns) {
            await this.prisma.$transaction(async (tx) => {
                await tx.$queryRawUnsafe('SELECT id FROM public.platform_communications WHERE id = $1::uuid FOR UPDATE', id);
                const outstanding = await tx.platformCommunicationRecipient.count({ where: { campaignId: id, status: { in: ['pending', 'processing'] } } });
                if (!outstanding) await tx.platformCommunication.updateMany({ where: { id, status: { in: ['queued', 'sending'] } }, data: { status: 'completed', completedAt: new Date() } });
            });
        }
    }
}
