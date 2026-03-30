import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
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

    constructor(
        private readonly prisma: PrismaService,
        private readonly eventEmitter: EventEmitter2
    ) { }

    // ─── Internal Landing Admin ──────────────────────────────────────────────────

    async createLandingPage(schemaName: string, payload: any): Promise<any> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO landing_pages (slug, course_id, campaign_id, title, subtitle, status)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
             [
                 payload.slug,
                 payload.courseId || null,
                 payload.campaignId || null,
                 payload.title,
                 payload.subtitle || null,
                 payload.status || 'draft'
             ]
        );
        return rows[0];
    }

    async findLandingPages(schemaName: string): Promise<any[]> {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT lp.*, c.name as course_name, camp.name as campaign_name
             FROM landing_pages lp
             LEFT JOIN courses c ON lp.course_id = c.id
             LEFT JOIN campaigns camp ON lp.campaign_id = camp.id
             ORDER BY lp.created_at DESC`
        );
    }

    // ─── Public Landing Pages ──────────────────────────────────────────────────

    async getLandingPageBySlug(schemaName: string, slug: string): Promise<any> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT lp.*,
                    c.name as course_name,
                    c.description as course_description,
                    c.price as course_price,
                    c.currency as course_currency,
                    camp.name as campaign_name,
                    (
                        SELECT row_to_json(fd)
                        FROM form_definitions fd
                        WHERE fd.landing_page_id = lp.id AND fd.active = true
                        ORDER BY fd.version DESC LIMIT 1
                    ) as form_definition
             FROM landing_pages lp
             LEFT JOIN courses c ON lp.course_id = c.id
             LEFT JOIN campaigns camp ON lp.campaign_id = camp.id
             WHERE lp.slug = $1 AND lp.status = 'published'`,
            [slug]
        );

        if (!rows.length) return null;
        return rows[0];
    }

    // ─── Main entry point for dynamic forms ────────────────────────────────────

    async processFormSubmission(
        formDefinitionId: string,
        payload: any,
        meta: { ip: string; userAgent: string; originUrl: string; tenantId: string; schemaName: string }
    ): Promise<IntakeResult> {
        const { schemaName } = meta;

        // 1. Get form definition to know campaign/course info
        const definitionRows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT fd.*, lp.campaign_id, lp.course_id, lp.id as landing_page_id
             FROM form_definitions fd
             LEFT JOIN landing_pages lp ON fd.landing_page_id = lp.id
             WHERE fd.id = $1`,
            [formDefinitionId]
        );

        const formDef = definitionRows[0];
        if (!formDef) {
            throw new NotFoundException('Definición de formulario no encontrada.');
        }

        // 2. Validate payload vs field definitions (basic validation here, could be extended)
        if (!payload.phone || !payload.email || !payload.first_name) {
            throw new BadRequestException('Faltan campos requeridos (nombre, email, teléfono).');
        }
        if (!payload.consent) {
            throw new BadRequestException('El consentimiento es requerido para capturar el lead.');
        }

        const phone = this.normalizePhone(payload.phone);
        if (!phone) {
            throw new BadRequestException('El número de teléfono no tiene un formato válido.');
        }

        const dto: CreateLeadDto = {
            firstName: payload.first_name,
            lastName: payload.last_name || '',
            email: payload.email,
            phone: phone,
            campaignId: formDef.campaign_id,
            courseId: formDef.course_id,
            consent: true,
            legalVersion: formDef.consent_text_version || 'v1.0',
            utmSource: payload.utm_source,
            utmMedium: payload.utm_medium,
            utmCampaign: payload.utm_campaign,
            utmContent: payload.utm_content,
            referrerUrl: meta.originUrl
        };

        // 3. Process lead capture logic (deduplication, opportunity creation)
        const result = await this.processLeadUpsert(dto, meta);

        // 4. Save raw form submission explicitly
        await this.prisma.executeInTenantSchema(
            schemaName,
            `INSERT INTO form_submissions (
                landing_page_id, form_definition_id,
                campaign_id, course_id, lead_id,
                raw_payload_json, source_url, referrer,
                utm_json, ip_address, user_agent
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
                formDef.landing_page_id, formDefinitionId,
                formDef.campaign_id, formDef.course_id, result.leadId,
                payload, dto.referrerUrl, meta.originUrl,
                { source: dto.utmSource, medium: dto.utmMedium, campaign: dto.utmCampaign },
                meta.ip, meta.userAgent
            ]
        );

        return result;
    }

    // ─── Original simple entry point ──────────────────────────────────────────

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

        // Pass normalized phone back
        dto.phone = phone;

        return this.processLeadUpsert(dto, meta);
    }

    // ─── Lead logic abstraction ───────────────────────────────────────────────

    private async processLeadUpsert(
        dto: CreateLeadDto,
        meta: { ip: string; userAgent: string; originUrl: string; tenantId: string; schemaName: string }
    ): Promise<IntakeResult> {
        const { schemaName } = meta;
        const phone = dto.phone; // Assuming normalized early

        // 1. Detect duplicates by phone + campaign
        const existingLead = await this.findExistingLead(schemaName, phone, dto.campaignId);

        let leadId: string;
        let isNew: boolean;

        if (existingLead) {
            leadId = existingLead.id;
            isNew = false;
            await this.updateLead(schemaName, leadId, dto);
            this.logger.log(`[Intake] Updated existing lead ${leadId} (phone: ${phone})`);
        } else {
            leadId = await this.createLead(schemaName, phone, dto);
            isNew = true;
            this.logger.log(`[Intake] Created new lead ${leadId} (phone: ${phone})`);
        }

        // 2. Save consent record
        await this.saveConsentRecord(schemaName, leadId, dto, meta);

        // 3. Create opportunity
        const opportunityId = await this.createOpportunity(schemaName, leadId, dto);

        this.logger.log(`[Intake] LeadCaptured: lead=${leadId}, opp=${opportunityId}, isNew=${isNew}`);

        // 4. Emit event for decoupling (e.g. Workflow module handles template sending)
        this.eventEmitter.emit('lead.captured', {
            tenantId: meta.tenantId,
            schemaName: meta.schemaName,
            leadId,
            opportunityId,
            campaignId: dto.campaignId,
            courseId: dto.courseId,
            isNew,
            phone
        });

        return { leadId, opportunityId, isNew, phone };
    }

    // ─── Phone normalization ──────────────────────────────────────────────────

    normalizePhone(raw: string): string | null {
        // Remove all non-digits
        const digits = raw.replace(/\D/g, '');

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
