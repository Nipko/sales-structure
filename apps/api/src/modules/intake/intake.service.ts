import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { createHash } from 'crypto';

interface IntakeResult {
    leadId: string;
    opportunityId: string;
    isNew: boolean;
    phone: string;
}

// Opt-out keywords detected in Spanish/English
const OPT_OUT_KEYWORDS = ['stop', 'baja', 'no quiero', 'eliminar', 'borrar', 'cancelar suscripción'];

@Injectable()
export class IntakeService {
    private readonly logger = new Logger(IntakeService.name);

    constructor(private readonly prisma: PrismaService) { }

    // ─── Main entry point ─────────────────────────────────────────────────────

    async captureFromForm(
        dto: CreateLeadDto,
        meta: { ip: string; userAgent: string; originUrl: string; tenantId: string; schemaName: string }
    ): Promise<IntakeResult> {
        if (!dto.consent) {
            throw new BadRequestException('El consentimiento es requerido para capturar el lead.');
        }

        const phone = this.normalizePhone(dto.phone);
        if (!phone) {
            throw new BadRequestException('El número de teléfono no tiene un formato válido.');
        }

        const { schemaName, tenantId } = meta;

        // 1. Detect duplicates by phone + campaign
        const existingLead = await this.findExistingLead(schemaName, phone, dto.campaignId);

        let leadId: string;
        let isNew: boolean;

        if (existingLead) {
            // Update existing lead with new opportunity-level data
            leadId = existingLead.id;
            isNew = false;
            await this.updateLead(schemaName, leadId, dto);
            this.logger.log(`[Intake] Updated existing lead ${leadId} (phone: ${phone})`);
        } else {
            // Create new lead
            leadId = await this.createLead(schemaName, phone, dto);
            isNew = true;
            this.logger.log(`[Intake] Created new lead ${leadId} (phone: ${phone})`);
        }

        // 2. Save consent record (always, even on update — new submission = new consent)
        await this.saveConsentRecord(schemaName, leadId, dto, meta);

        // 3. Create opportunity (one per form submission)
        const opportunityId = await this.createOpportunity(schemaName, leadId, dto);

        this.logger.log(`[Intake] LeadCaptured: lead=${leadId}, opp=${opportunityId}, isNew=${isNew}`);
        return { leadId, opportunityId, isNew, phone };
    }

    // ─── Phone normalization ──────────────────────────────────────────────────

    normalizePhone(raw: string): string | null {
        // Remove all non-digits
        let digits = raw.replace(/\D/g, '');

        // Colombia: 10-digit numbers starting with 3xx
        if (digits.length === 10 && digits.startsWith('3')) {
            return `+57${digits}`;
        }
        // Already has country code for Colombia (57)
        if (digits.length === 12 && digits.startsWith('57')) {
            return `+${digits}`;
        }
        // E.164 equivalent (e.g., +573001234567)
        if (digits.length >= 7 && digits.length <= 15) {
            return `+${digits}`;
        }
        return null;
    }

    // ─── Duplicate detection ─────────────────────────────────────────────────

    private async findExistingLead(schemaName: string, phone: string, campaignId?: string): Promise<{ id: string } | null> {
        const rows = await this.prisma.executeInTenantSchema<Array<{ id: string }>>(
            schemaName,
            `SELECT id FROM leads WHERE phone = $1 ${campaignId ? 'AND campaign_id = $2' : ''} LIMIT 1`,
            campaignId ? [phone, campaignId] : [phone]
        );
        return rows[0] ?? null;
    }

    // ─── Lead CRUD ────────────────────────────────────────────────────────────

    private async createLead(schemaName: string, phone: string, dto: CreateLeadDto): Promise<string> {
        const rows = await this.prisma.executeInTenantSchema<Array<{ id: string }>>(
            schemaName,
            `INSERT INTO leads (
                first_name, last_name, phone, email,
                course_id, campaign_id, preferred_contact,
                utm_source, utm_medium, utm_campaign, utm_content,
                referrer_url, gclid, fbclid,
                stage, score
            ) VALUES (
                $1, $2, $3, $4,
                $5, $6, $7,
                $8, $9, $10, $11,
                $12, $13, $14,
                'nuevo', 0
            ) RETURNING id`,
            [
                dto.firstName, dto.lastName, phone, dto.email ?? null,
                dto.courseId ?? null, dto.campaignId ?? null, dto.preferredContact ?? 'whatsapp',
                dto.utmSource ?? null, dto.utmMedium ?? null, dto.utmCampaign ?? null, dto.utmContent ?? null,
                dto.referrerUrl ?? null, dto.gclid ?? null, dto.fbclid ?? null,
            ]
        );
        return rows[0].id;
    }

    private async updateLead(schemaName: string, leadId: string, dto: CreateLeadDto): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE leads SET
                first_name = COALESCE($2, first_name),
                last_name  = COALESCE($3, last_name),
                email      = COALESCE($4, email),
                updated_at = NOW()
             WHERE id = $1`,
            [leadId, dto.firstName ?? null, dto.lastName ?? null, dto.email ?? null]
        );
    }

    // ─── Opportunity creation ─────────────────────────────────────────────────

    private async createOpportunity(schemaName: string, leadId: string, dto: CreateLeadDto): Promise<string> {
        const rows = await this.prisma.executeInTenantSchema<Array<{ id: string }>>(
            schemaName,
            `INSERT INTO opportunities (lead_id, course_id, campaign_id, stage, score)
             VALUES ($1, $2, $3, 'nuevo', 0)
             RETURNING id`,
            [leadId, dto.courseId ?? null, dto.campaignId ?? null]
        );
        return rows[0].id;
    }

    // ─── Consent record ───────────────────────────────────────────────────────

    private async saveConsentRecord(
        schemaName: string,
        leadId: string,
        dto: CreateLeadDto,
        meta: { ip: string; userAgent: string; originUrl: string }
    ): Promise<void> {
        const legalVersion = dto.legalVersion ?? 'v1.0';
        const legalTextHash = createHash('sha256')
            .update(`${legalVersion}:${meta.originUrl}`)
            .digest('hex');

        await this.prisma.executeInTenantSchema(
            schemaName,
            `INSERT INTO consent_records
                (lead_id, channel, legal_version, legal_text_hash, ip_address, user_agent, origin_url)
             VALUES ($1, 'web_form', $2, $3, $4, $5, $6)`,
            [leadId, legalVersion, legalTextHash, meta.ip, meta.userAgent, meta.originUrl]
        );
    }

    // ─── Opt-out detection (used by channels service) ─────────────────────────

    async checkAndRecordOptOut(
        schemaName: string,
        phone: string,
        message: string
    ): Promise<boolean> {
        const lower = message.toLowerCase().trim();
        const isOptOut = OPT_OUT_KEYWORDS.some(kw => lower.includes(kw));
        if (!isOptOut) return false;

        // Find lead by phone
        const leads = await this.prisma.executeInTenantSchema<Array<{ id: string }>>(
            schemaName,
            `SELECT id FROM leads WHERE phone = $1 LIMIT 1`,
            [phone]
        );
        const leadId = leads[0]?.id ?? null;

        // Record opt-out
        await this.prisma.executeInTenantSchema(
            schemaName,
            `INSERT INTO opt_out_records (lead_id, phone, channel, trigger_msg)
             VALUES ($1, $2, 'whatsapp', $3)`,
            [leadId, phone, message]
        );

        // Flag lead as opted out
        if (leadId) {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE leads SET opted_out = true, opted_out_at = NOW(), updated_at = NOW() WHERE id = $1`,
                [leadId]
            );
        }

        this.logger.log(`[Intake] Opt-out recorded for phone ${phone}`);
        return true;
    }
}
