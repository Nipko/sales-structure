import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
    assertOptionalContactId,
    requireTenantContact,
} from '../../common/utils/tenant-contact.util';

/**
 * Insurance vertical service — plan catalog, quote pipeline, policies,
 * claims. The plan catalog is what the AI agent shows; quotes are
 * provisional offers attached to a contact; policies are sold contracts;
 * claims are post-policy events.
 *
 * The premium calculation in this service is intentionally simple: a
 * linear interpolation between min and max premium based on age bucket.
 * Real underwriting belongs in the carrier's system. This is just enough
 * for a sales agent to show a ballpark in chat.
 */
@Injectable()
export class InsuranceService {
    private readonly logger = new Logger(InsuranceService.name);

    constructor(private readonly prisma: PrismaService) {}

    // ── Plans ─────────────────────────────────────────────────────

    async listPlans(schemaName: string, opts: { type?: string; coverageLevel?: string; includeInactive?: boolean } = {}): Promise<any[]> {
        const where: string[] = [];
        const params: any[] = [];
        let i = 1;
        if (!opts.includeInactive) where.push('is_active = true');
        if (opts.type) { where.push(`insurance_type = $${i++}`); params.push(opts.type); }
        if (opts.coverageLevel) { where.push(`coverage_level = $${i++}`); params.push(opts.coverageLevel); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM insurance_plans ${whereSql} ORDER BY insurance_type, coverage_level`,
            params,
        );
    }

    async getPlanById(schemaName: string, id: string): Promise<any> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName, `SELECT * FROM insurance_plans WHERE id = $1::uuid`, [id],
        );
        return rows[0] || null;
    }

    async createPlan(schemaName: string, data: any): Promise<any> {
        if (!data.name || !data.insuranceType) {
            throw new BadRequestException('name and insuranceType are required');
        }
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO insurance_plans (
                name, description, insurance_type, coverage_level,
                monthly_premium_min, monthly_premium_max, deductible, max_coverage,
                currency, covers, excludes, min_age, max_age
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13)
             RETURNING *`,
            [
                data.name, data.description || null, data.insuranceType,
                data.coverageLevel || null,
                data.monthlyPremiumMin ?? null, data.monthlyPremiumMax ?? null,
                data.deductible ?? null, data.maxCoverage ?? null,
                data.currency || 'COP',
                JSON.stringify(data.covers || []), JSON.stringify(data.excludes || []),
                data.minAge ?? null, data.maxAge ?? null,
            ],
        );
        return rows[0];
    }

    async updatePlan(schemaName: string, id: string, data: any): Promise<any> {
        const fields: string[] = [];
        const values: any[] = [];
        let i = 1;
        const map: Record<string, { col: string; cast?: string }> = {
            name: { col: 'name' }, description: { col: 'description' },
            insuranceType: { col: 'insurance_type' }, coverageLevel: { col: 'coverage_level' },
            monthlyPremiumMin: { col: 'monthly_premium_min' },
            monthlyPremiumMax: { col: 'monthly_premium_max' },
            deductible: { col: 'deductible' }, maxCoverage: { col: 'max_coverage' },
            currency: { col: 'currency' },
            covers: { col: 'covers', cast: '::jsonb' },
            excludes: { col: 'excludes', cast: '::jsonb' },
            minAge: { col: 'min_age' }, maxAge: { col: 'max_age' },
            isActive: { col: 'is_active' },
        };
        for (const [k, def] of Object.entries(map)) {
            if (k in data) {
                let v = data[k];
                if (def.cast === '::jsonb') v = JSON.stringify(v || []);
                fields.push(`${def.col} = $${i}${def.cast || ''}`);
                values.push(v);
                i++;
            }
        }
        if (!fields.length) return this.getPlanById(schemaName, id);
        fields.push(`updated_at = NOW()`);
        values.push(id);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE insurance_plans SET ${fields.join(', ')} WHERE id = $${i}::uuid RETURNING *`,
            values,
        );
        if (!rows.length) throw new NotFoundException('Plan not found');
        return rows[0];
    }

    async deletePlan(schemaName: string, id: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE insurance_plans SET is_active = false, updated_at = NOW() WHERE id = $1::uuid`,
            [id],
        );
    }

    // ── Quotes ────────────────────────────────────────────────────

    /**
     * Quick quote calculation — linear interpolation by age within the
     * plan's age range. Real pricing requires the carrier's underwriting
     * engine; this is a sales-friendly estimate the AI can show in chat.
     */
    private calculatePremium(plan: any, age?: number): { monthly: number; annual: number } {
        const min = Number(plan.monthly_premium_min || 0);
        const max = Number(plan.monthly_premium_max || min);
        if (max === min) return { monthly: min, annual: min * 12 };

        const minAge = plan.min_age || 18;
        const maxAge = plan.max_age || 75;
        const a = age ?? minAge;
        const clamped = Math.max(minAge, Math.min(maxAge, a));
        const t = (clamped - minAge) / Math.max(1, maxAge - minAge);
        const monthly = Math.round(min + t * (max - min));
        return { monthly, annual: monthly * 12 };
    }

    async createQuote(schemaName: string, data: {
        contactId?: string;
        planId: string;
        applicantName?: string;
        applicantAge?: number;
        applicantEmail?: string;
        applicantPhone?: string;
        applicantData?: any;
        validDays?: number;
    }): Promise<any> {
        if (!data.planId) throw new BadRequestException('planId is required');
        const contactId = assertOptionalContactId(data.contactId);
        const plan = await this.getPlanById(schemaName, data.planId);
        if (!plan) throw new BadRequestException('Plan not found');

        const premium = this.calculatePremium(plan, data.applicantAge);
        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + (data.validDays || 30));

        const rows = await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            await requireTenantContact(query, contactId);
            return query<any[]>(`INSERT INTO insurance_quotes (
                contact_id, plan_id, applicant_name, applicant_age,
                applicant_email, applicant_phone, applicant_data,
                monthly_premium, annual_premium, currency, valid_until, status
             ) VALUES (
                $1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb,
                $8, $9, $10, $11::date, 'sent'
             ) RETURNING *`,
            [
                contactId, data.planId,
                data.applicantName || null, data.applicantAge ?? null,
                data.applicantEmail || null, data.applicantPhone || null,
                JSON.stringify(data.applicantData || {}),
                premium.monthly, premium.annual, plan.currency,
                validUntil.toISOString().slice(0, 10),
            ]);
        });
        return { ...rows[0], plan_name: plan.name, plan_type: plan.insurance_type };
    }

    async listQuotes(schemaName: string, opts: { contactId?: string; status?: string } = {}): Promise<any[]> {
        const where: string[] = [];
        const params: any[] = [];
        let i = 1;
        if (opts.contactId) { where.push(`q.contact_id = $${i++}::uuid`); params.push(opts.contactId); }
        if (opts.status) { where.push(`q.status = $${i++}`); params.push(opts.status); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT q.*, p.name as plan_name, p.insurance_type
             FROM insurance_quotes q
             LEFT JOIN insurance_plans p ON p.id = q.plan_id
             ${whereSql} ORDER BY q.created_at DESC LIMIT 200`,
            params,
        );
    }

    async updateQuoteStatus(schemaName: string, id: string, status: string): Promise<any> {
        const valid = ['draft', 'sent', 'accepted', 'rejected', 'expired'];
        if (!valid.includes(status)) throw new BadRequestException('invalid status');
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE insurance_quotes SET status = $1, updated_at = NOW() WHERE id = $2::uuid RETURNING *`,
            [status, id],
        );
        return rows[0];
    }

    // ── Policies ──────────────────────────────────────────────────

    async listPolicies(schemaName: string, opts: { contactId?: string; status?: string } = {}): Promise<any[]> {
        const where: string[] = [];
        const params: any[] = [];
        let i = 1;
        if (opts.contactId) { where.push(`contact_id = $${i++}::uuid`); params.push(opts.contactId); }
        if (opts.status) { where.push(`status = $${i++}`); params.push(opts.status); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM insurance_policies ${whereSql} ORDER BY created_at DESC LIMIT 200`,
            params,
        );
    }

    async getPolicyByNumber(schemaName: string, policyNumber: string): Promise<any> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM insurance_policies WHERE policy_number = $1`,
            [policyNumber],
        );
        return rows[0] || null;
    }

    async createPolicy(schemaName: string, data: {
        policyNumber: string;
        contactId?: string;
        planId?: string;
        quoteId?: string;
        policyholderName: string;
        monthlyPremium: number;
        currency?: string;
        startsAt: string;
        endsAt?: string;
    }): Promise<any> {
        if (!data.policyNumber || !data.policyholderName || !data.monthlyPremium || !data.startsAt) {
            throw new BadRequestException('policyNumber, policyholderName, monthlyPremium and startsAt are required');
        }
        const contactId = assertOptionalContactId(data.contactId);
        const nextPayment = new Date(data.startsAt);
        nextPayment.setMonth(nextPayment.getMonth() + 1);
        const rows = await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            await requireTenantContact(query, contactId);
            return query<any[]>(`INSERT INTO insurance_policies (
                policy_number, contact_id, plan_id, quote_id,
                policyholder_name, monthly_premium, currency,
                starts_at, ends_at, next_payment_at
             ) VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8::date, $9::date, $10::date)
             RETURNING *`,
            [
                data.policyNumber, contactId,
                data.planId || null, data.quoteId || null,
                data.policyholderName, data.monthlyPremium, data.currency || 'COP',
                data.startsAt, data.endsAt || null,
                nextPayment.toISOString().slice(0, 10),
            ]);
        });
        return rows[0];
    }

    // ── Claims ────────────────────────────────────────────────────

    async listClaims(schemaName: string, opts: { policyId?: string; status?: string } = {}): Promise<any[]> {
        const where: string[] = [];
        const params: any[] = [];
        let i = 1;
        if (opts.policyId) { where.push(`policy_id = $${i++}::uuid`); params.push(opts.policyId); }
        if (opts.status) { where.push(`status = $${i++}`); params.push(opts.status); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM insurance_claims ${whereSql} ORDER BY created_at DESC LIMIT 200`,
            params,
        );
    }

    async fileClaim(schemaName: string, data: {
        policyId: string;
        incidentType?: string;
        incidentAt?: string;
        description?: string;
        claimedAmount?: number;
    }): Promise<any> {
        if (!data.policyId) throw new BadRequestException('policyId is required');
        const claimNumber = `C-${Date.now().toString(36).toUpperCase()}`;
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO insurance_claims (
                policy_id, claim_number, incident_type, incident_at,
                description, claimed_amount, status
             ) VALUES ($1::uuid, $2, $3, $4::date, $5, $6, 'submitted')
             RETURNING *`,
            [
                data.policyId, claimNumber,
                data.incidentType || null, data.incidentAt || null,
                data.description || null, data.claimedAmount ?? null,
            ],
        );
        return rows[0];
    }
}
