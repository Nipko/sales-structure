import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveNativeEvidenceOpportunity } from '../../common/utils/native-evidence-opportunity.util';

export const REPAIR_ORDER_STATUSES = [
    'intake',
    'estimating',
    'awaiting_approval',
    'approved',
    'in_progress',
    'ready',
    'delivered',
    'rejected',
    'cancelled',
] as const;

export type RepairOrderStatus = typeof REPAIR_ORDER_STATUSES[number];

const TERMINAL_STATUSES = new Set<RepairOrderStatus>(['delivered', 'cancelled']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TRANSITIONS = {
    intake: ['estimating', 'cancelled'],
    estimating: ['awaiting_approval', 'cancelled'],
    awaiting_approval: ['approved', 'rejected', 'cancelled'],
    rejected: ['estimating', 'cancelled'],
    approved: ['in_progress', 'cancelled'],
    in_progress: ['ready', 'cancelled'],
    ready: ['in_progress', 'delivered'],
    delivered: [],
    cancelled: [],
} as const satisfies Readonly<Record<RepairOrderStatus, readonly RepairOrderStatus[]>>;

export function isRepairOrderTransitionAllowed(
    from: RepairOrderStatus,
    to: RepairOrderStatus,
): boolean {
    return (TRANSITIONS[from] as readonly RepairOrderStatus[]).includes(to);
}

export interface RepairOrderVehicleInput {
    id?: string;
    make?: string;
    model?: string;
    year?: number;
    vin?: string;
    licensePlate?: string;
    color?: string;
    mileageKm?: number;
}

export interface CreateRepairOrderInput {
    contactId: string;
    vehicle: RepairOrderVehicleInput;
    customerConcern: string;
    reportedSymptoms?: string[];
    appointmentId?: string;
    opportunityId?: string;
    conversationId?: string;
    idempotencyKey?: string;
}

export interface RepairLineItem {
    description: string;
    quantity: number;
    unitAmountCents: number;
}

export interface RepairOrderSummary {
    open: number;
    awaitingApproval: number;
    readyForDelivery: number;
    deliveredLast30Days: number;
}

type TenantQuery = <T = any[]>(sql: string, params?: any[]) => Promise<T>;

function cleanText(value: unknown, max: number): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().replace(/\s+/g, ' ');
    return normalized ? normalized.slice(0, max) : null;
}

function assertUuid(value: unknown, field: string, optional = false): string | null {
    if ((value === null || value === undefined || value === '') && optional) return null;
    if (typeof value !== 'string' || !UUID_RE.test(value)) {
        throw new BadRequestException(`${field} must be a UUID`);
    }
    return value;
}

function normalizeCurrency(value: unknown): string {
    const currency = cleanText(value, 3)?.toUpperCase();
    if (!currency) throw new BadRequestException('currency is required');
    if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException('currency must be ISO 4217');
    return currency;
}

function normalizeLineItems(value: unknown): RepairLineItem[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 100) {
        throw new BadRequestException('lineItems must be an array with at most 100 items');
    }
    return value.map((raw, index) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new BadRequestException(`lineItems[${index}] is invalid`);
        }
        const item = raw as Record<string, unknown>;
        const description = cleanText(item.description, 500);
        const quantity = Number(item.quantity ?? 1);
        const unitAmountCents = Number(item.unitAmountCents);
        if (!description || !Number.isInteger(quantity) || quantity < 1 || quantity > 10_000
            || !Number.isSafeInteger(unitAmountCents) || unitAmountCents < 0) {
            throw new BadRequestException(`lineItems[${index}] is invalid`);
        }
        return { description, quantity, unitAmountCents };
    });
}

function lineItemTotal(items: readonly RepairLineItem[]): number {
    const total = items.reduce((sum, item) => {
        const extended = item.quantity * item.unitAmountCents;
        if (!Number.isSafeInteger(extended) || !Number.isSafeInteger(sum + extended)) {
            throw new BadRequestException('lineItems total exceeds the supported amount');
        }
        return sum + extended;
    }, 0);
    return total;
}

@Injectable()
export class RepairOrdersService {
    constructor(private readonly prisma: PrismaService) {}

    async list(schemaName: string, filters: {
        status?: string;
        contactId?: string;
        vehicleId?: string;
        search?: string;
        limit?: number;
        offset?: number;
    } = {}): Promise<{ items: any[]; total: number }> {
        const statuses = filters.status
            ? filters.status.split(',').map(value => value.trim()).filter(Boolean)
            : [];
        if (statuses.some(value => !REPAIR_ORDER_STATUSES.includes(value as RepairOrderStatus))) {
            throw new BadRequestException('Invalid repair order status');
        }
        const limit = filters.limit === undefined ? 50 : Number(filters.limit);
        const offset = filters.offset === undefined ? 0 : Number(filters.offset);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
            throw new BadRequestException('limit must be between 1 and 100');
        }
        if (!Number.isInteger(offset) || offset < 0) {
            throw new BadRequestException('offset must be a non-negative integer');
        }

        const conditions: string[] = [];
        const params: unknown[] = [];
        const add = (value: unknown): number => {
            params.push(value);
            return params.length;
        };
        if (statuses.length) conditions.push(`ro.status = ANY($${add(statuses)}::text[])`);
        if (filters.contactId) conditions.push(`ro.contact_id = $${add(assertUuid(filters.contactId, 'contactId'))}::uuid`);
        if (filters.vehicleId) conditions.push(`ro.vehicle_id = $${add(assertUuid(filters.vehicleId, 'vehicleId'))}::uuid`);
        const search = cleanText(filters.search, 200);
        if (search) {
            conditions.push(`(
                ro.customer_concern ILIKE $${add(`%${search}%`)}
                OR cv.make ILIKE $${params.length}
                OR cv.model ILIKE $${params.length}
                OR COALESCE(cv.license_plate, '') ILIKE $${params.length}
                OR COALESCE(cv.vin, '') ILIKE $${params.length}
            )`);
        }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const countRows = await this.prisma.executeInTenantSchema<Array<{ total: number }>>(
            schemaName,
            `SELECT COUNT(*)::int AS total
               FROM repair_orders ro
               JOIN customer_vehicles cv ON cv.id = ro.vehicle_id
               ${where}`,
            params,
        );
        const itemParams = [...params, limit, offset];
        const items = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT ro.*, cv.make, cv.model, cv.year, cv.vin, cv.license_plate,
                    cv.color, cv.mileage_km AS vehicle_mileage_km,
                    c.name AS contact_name, c.phone AS contact_phone,
                    staff.name AS assigned_technician_name
               FROM repair_orders ro
               JOIN customer_vehicles cv ON cv.id = ro.vehicle_id
               JOIN contacts c ON c.id = ro.contact_id
               LEFT JOIN staff_members staff ON staff.id = ro.assigned_technician_id
               ${where}
              ORDER BY ro.updated_at DESC, ro.id DESC
              LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            itemParams,
        );
        return { items, total: countRows[0]?.total || 0 };
    }

    async summary(schemaName: string): Promise<RepairOrderSummary> {
        const rows = await this.prisma.executeInTenantSchema<Array<{
            open: number;
            awaiting_approval: number;
            ready_for_delivery: number;
            delivered_last_30_days: number;
        }>>(
            schemaName,
            `SELECT
                COUNT(*) FILTER (WHERE status NOT IN ('delivered', 'cancelled'))::int AS open,
                COUNT(*) FILTER (WHERE status = 'awaiting_approval')::int AS awaiting_approval,
                COUNT(*) FILTER (WHERE status = 'ready')::int AS ready_for_delivery,
                COUNT(*) FILTER (
                    WHERE status = 'delivered'
                      AND updated_at >= NOW() - INTERVAL '30 days'
                )::int AS delivered_last_30_days
               FROM repair_orders`,
        );
        const row = rows[0];
        return {
            open: row?.open || 0,
            awaitingApproval: row?.awaiting_approval || 0,
            readyForDelivery: row?.ready_for_delivery || 0,
            deliveredLast30Days: row?.delivered_last_30_days || 0,
        };
    }

    async get(schemaName: string, repairOrderId: string, contactId?: string): Promise<any> {
        assertUuid(repairOrderId, 'repairOrderId');
        const params: unknown[] = [repairOrderId];
        const ownerClause = contactId
            ? `AND ro.contact_id = $2::uuid`
            : '';
        if (contactId) params.push(assertUuid(contactId, 'contactId'));
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT ro.*, cv.make, cv.model, cv.year, cv.vin, cv.license_plate,
                    cv.color, cv.mileage_km AS vehicle_mileage_km,
                    c.name AS contact_name, c.phone AS contact_phone,
                    staff.name AS assigned_technician_name
               FROM repair_orders ro
               JOIN customer_vehicles cv ON cv.id = ro.vehicle_id
               JOIN contacts c ON c.id = ro.contact_id
               LEFT JOIN staff_members staff ON staff.id = ro.assigned_technician_id
              WHERE ro.id = $1::uuid ${ownerClause}`,
            params,
        );
        if (!rows.length) throw new NotFoundException('Repair order not found');
        const events = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, event_type, from_status, to_status, actor_id, actor_type, payload, created_at
               FROM repair_order_events
              WHERE repair_order_id = $1::uuid
              ORDER BY created_at DESC, id DESC
              LIMIT 100`,
            [repairOrderId],
        );
        return { ...rows[0], events };
    }

    async create(
        schemaName: string,
        input: CreateRepairOrderInput,
        actor: { id?: string | null; type: 'tenant_user' | 'agent' | 'system' },
    ): Promise<any> {
        const contactId = assertUuid(input.contactId, 'contactId')!;
        const customerConcern = cleanText(input.customerConcern, 4_000);
        if (!customerConcern) throw new BadRequestException('customerConcern is required');
        const reportedSymptoms = Array.isArray(input.reportedSymptoms)
            ? input.reportedSymptoms.map(value => cleanText(value, 500)).filter((value): value is string => !!value).slice(0, 30)
            : [];
        const appointmentId = assertUuid(input.appointmentId, 'appointmentId', true);
        const opportunityId = assertUuid(input.opportunityId, 'opportunityId', true);
        const conversationId = assertUuid(input.conversationId, 'conversationId', true);
        const idempotencyKey = cleanText(input.idempotencyKey, 255);
        const actorId = assertUuid(actor.id, 'actorId', true);

        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            // Replay before touching the vehicle. Resolving/updating mileage on
            // an already-completed request would make an idempotent retry have
            // a second business effect.
            if (idempotencyKey) {
                const replay = await query<any[]>(
                    `SELECT ro.*, cv.make, cv.model, cv.year, cv.vin, cv.license_plate,
                            cv.color, cv.mileage_km
                       FROM repair_orders ro
                       JOIN customer_vehicles cv ON cv.id = ro.vehicle_id
                      WHERE ro.idempotency_key = $1
                      LIMIT 1
                      FOR UPDATE OF ro`,
                    [idempotencyKey],
                );
                if (replay.length) {
                    if (replay[0].contact_id !== contactId) {
                        throw new ConflictException('Repair order idempotency conflict');
                    }
                    return {
                        ...replay[0],
                        vehicle: {
                            id: replay[0].vehicle_id,
                            make: replay[0].make,
                            model: replay[0].model,
                            year: replay[0].year,
                            vin: replay[0].vin,
                            license_plate: replay[0].license_plate,
                            color: replay[0].color,
                            mileage_km: replay[0].mileage_km,
                        },
                        idempotentReplay: true,
                    };
                }
            }
            const contacts = await query<Array<{ id: string }>>(
                `SELECT id FROM contacts WHERE id = $1::uuid LIMIT 1`,
                [contactId],
            );
            if (!contacts.length) throw new NotFoundException('Contact not found');
            const vehicle = await this.resolveVehicle(query, contactId, input.vehicle);
            const resolvedOpportunityId = await resolveNativeEvidenceOpportunity(query, {
                contactId,
                conversationId,
                trustedOpportunityId: opportunityId,
            });
            const inserted = await query<any[]>(
                `INSERT INTO repair_orders (
                    contact_id, vehicle_id, appointment_id, opportunity_id, conversation_id,
                    customer_concern, reported_symptoms, idempotency_key, created_by
                 ) VALUES (
                    $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
                    $6, $7::jsonb, $8, $9::uuid
                 )
                 ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
                 RETURNING *`,
                [
                    contactId, vehicle.id, appointmentId, resolvedOpportunityId, conversationId,
                    customerConcern, JSON.stringify(reportedSymptoms), idempotencyKey, actorId,
                ],
            );
            let row = inserted[0];
            if (!row && idempotencyKey) {
                const existing = await query<any[]>(
                    `SELECT * FROM repair_orders WHERE idempotency_key = $1 LIMIT 1`,
                    [idempotencyKey],
                );
                row = existing[0];
                if (!row || row.contact_id !== contactId) {
                    throw new ConflictException('Repair order idempotency conflict');
                }
                return { ...row, vehicle, idempotentReplay: true };
            }
            if (!row) throw new ConflictException('Repair order could not be created');
            await this.insertEvent(query, row.id, 'created', null, row.status, actorId, actor.type, {
                customerConcern,
                reportedSymptoms,
            });
            return { ...row, vehicle, idempotentReplay: false };
        });
    }

    async updateEstimate(schemaName: string, repairOrderId: string, input: {
        expectedVersion: number;
        lineItems?: RepairLineItem[];
        amountCents?: number;
        currency?: string;
        notes?: string;
    }, actorId?: string | null): Promise<any> {
        const id = assertUuid(repairOrderId, 'repairOrderId')!;
        const actor = assertUuid(actorId, 'actorId', true);
        const expectedVersion = Number(input.expectedVersion);
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
            throw new BadRequestException('expectedVersion is required');
        }
        const items = normalizeLineItems(input.lineItems);
        const suppliedAmount = input.amountCents === undefined ? undefined : Number(input.amountCents);
        if (suppliedAmount !== undefined && (!Number.isSafeInteger(suppliedAmount) || suppliedAmount < 0)) {
            throw new BadRequestException('amountCents must be a non-negative integer');
        }
        const derivedAmount = items.length ? lineItemTotal(items) : suppliedAmount;
        if (derivedAmount === undefined) throw new BadRequestException('An estimate amount is required');
        if (items.length && suppliedAmount !== undefined && suppliedAmount !== derivedAmount) {
            throw new BadRequestException('amountCents does not match lineItems');
        }
        const currency = normalizeCurrency(input.currency);
        const notes = cleanText(input.notes, 4_000);
        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const current = await this.lockOrder(query, id);
            if (TERMINAL_STATUSES.has(current.status)) throw new ConflictException('Repair order is closed');
            if (current.version !== expectedVersion) throw new ConflictException('Repair order version conflict');
            if (!['intake', 'estimating', 'rejected', 'awaiting_approval'].includes(current.status)) {
                throw new ConflictException('Estimate cannot be changed in the current state');
            }
            const rows = await query<any[]>(
                `UPDATE repair_orders
                    SET estimate_line_items = $2::jsonb,
                        estimate_amount_cents = $3,
                        currency = $4,
                        status = 'awaiting_approval',
                        approval_status = 'pending',
                        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('estimateNotes', $5::text),
                        version = version + 1,
                        updated_at = NOW()
                  WHERE id = $1::uuid AND version = $6
                  RETURNING *`,
                [id, JSON.stringify(items), derivedAmount, currency, notes, expectedVersion],
            );
            if (!rows.length) throw new ConflictException('Repair order version conflict');
            await this.insertEvent(query, id, 'estimate_requested', current.status, 'awaiting_approval', actor, 'tenant_user', {
                amountCents: derivedAmount,
                currency,
                lineItems: items,
            });
            return rows[0];
        });
    }

    async decideEstimate(
        schemaName: string,
        repairOrderId: string,
        contactId: string | null,
        accepted: boolean,
        actorType: 'agent' | 'tenant_user' = 'agent',
        actorId?: string | null,
        evidence?: string,
    ): Promise<any> {
        const id = assertUuid(repairOrderId, 'repairOrderId')!;
        if (typeof accepted !== 'boolean') {
            throw new BadRequestException('accepted must be a boolean');
        }
        const owner = contactId ? assertUuid(contactId, 'contactId')! : null;
        const actor = assertUuid(actorId, 'actorId', true);
        const decisionEvidence = cleanText(evidence, 1_000);
        if (!owner && actorType !== 'tenant_user') {
            throw new BadRequestException('Customer ownership is required for agent decisions');
        }
        if (actorType === 'tenant_user' && (!actor || !decisionEvidence)) {
            throw new BadRequestException('Staff decisions require actorId and evidence');
        }
        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const params = owner ? [id, owner] : [id];
            const rows = await query<any[]>(
                `SELECT * FROM repair_orders
                  WHERE id = $1::uuid ${owner ? 'AND contact_id = $2::uuid' : ''}
                  FOR UPDATE`,
                params,
            );
            const current = rows[0];
            if (!current) throw new NotFoundException('Repair order not found');
            const target: RepairOrderStatus = accepted ? 'approved' : 'rejected';
            if (current.status === target && current.approval_status === target) {
                return { ...current, idempotentReplay: true };
            }
            if (current.status !== 'awaiting_approval' || current.approval_status !== 'pending'
                || current.estimate_amount_cents === null) {
                throw new ConflictException('Repair estimate is not awaiting a decision');
            }
            const updated = await query<any[]>(
                `UPDATE repair_orders
                    SET status = $2,
                        approval_status = $2,
                        version = version + 1,
                        updated_at = NOW()
                  WHERE id = $1::uuid
                  RETURNING *`,
                [id, target],
            );
            await this.insertEvent(query, id, accepted ? 'estimate_approved' : 'estimate_rejected',
                current.status, target, actor, actorType, {
                    estimateAmountCents: Number(current.estimate_amount_cents),
                    currency: current.currency,
                    evidence: decisionEvidence,
                });
            return { ...updated[0], idempotentReplay: false };
        });
    }

    async updateOperationalDetails(schemaName: string, repairOrderId: string, input: {
        expectedVersion: number;
        inspection?: Record<string, unknown>;
        diagnosisSummary?: string | null;
        finalLineItems?: RepairLineItem[];
        finalAmountCents?: number | null;
        assignedTechnicianId?: string | null;
        promisedAt?: string | null;
        mileageKm?: number | null;
    }, actorId?: string | null): Promise<any> {
        const id = assertUuid(repairOrderId, 'repairOrderId')!;
        const actor = assertUuid(actorId, 'actorId', true);
        const expectedVersion = Number(input.expectedVersion);
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
            throw new BadRequestException('expectedVersion is required');
        }
        const finalItems = normalizeLineItems(input.finalLineItems);
        const finalAmount = input.finalAmountCents === undefined || input.finalAmountCents === null
            ? (finalItems.length ? lineItemTotal(finalItems) : null)
            : Number(input.finalAmountCents);
        if (finalAmount !== null && (!Number.isSafeInteger(finalAmount) || finalAmount < 0)) {
            throw new BadRequestException('finalAmountCents must be a non-negative integer');
        }
        if (finalItems.length && input.finalAmountCents !== undefined && input.finalAmountCents !== null
            && finalAmount !== lineItemTotal(finalItems)) {
            throw new BadRequestException('finalAmountCents does not match finalLineItems');
        }
        const technicianId = assertUuid(input.assignedTechnicianId, 'assignedTechnicianId', true);
        const diagnosis = input.diagnosisSummary === null ? null : cleanText(input.diagnosisSummary, 4_000);
        const promisedAt = input.promisedAt === null || input.promisedAt === undefined
            ? null
            : new Date(input.promisedAt);
        if (promisedAt && Number.isNaN(promisedAt.getTime())) throw new BadRequestException('promisedAt is invalid');
        const mileageKm = input.mileageKm === null || input.mileageKm === undefined
            ? null
            : Number(input.mileageKm);
        if (mileageKm !== null && (!Number.isInteger(mileageKm) || mileageKm < 0)) {
            throw new BadRequestException('mileageKm must be a non-negative integer');
        }
        const inspection = input.inspection && typeof input.inspection === 'object' && !Array.isArray(input.inspection)
            ? input.inspection
            : {};
        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const current = await this.lockOrder(query, id);
            if (TERMINAL_STATUSES.has(current.status)) throw new ConflictException('Repair order is closed');
            if (current.version !== expectedVersion) throw new ConflictException('Repair order version conflict');
            if (technicianId) {
                const staff = await query<Array<{ id: string }>>(
                    `SELECT id FROM staff_members WHERE id = $1::uuid AND is_active = true LIMIT 1`,
                    [technicianId],
                );
                if (!staff.length) throw new BadRequestException('assignedTechnicianId must identify active staff');
            }
            const updated = await query<any[]>(
                `UPDATE repair_orders
                    SET inspection = CASE WHEN $2::jsonb = '{}'::jsonb THEN inspection ELSE $2::jsonb END,
                        diagnosis_summary = COALESCE($3, diagnosis_summary),
                        final_line_items = CASE WHEN $4::jsonb = '[]'::jsonb THEN final_line_items ELSE $4::jsonb END,
                        final_amount_cents = COALESCE($5, final_amount_cents),
                        assigned_technician_id = COALESCE($6::uuid, assigned_technician_id),
                        promised_at = COALESCE($7::timestamptz, promised_at),
                        version = version + 1,
                        updated_at = NOW()
                  WHERE id = $1::uuid AND version = $8
                  RETURNING *`,
                [id, JSON.stringify(inspection), diagnosis, JSON.stringify(finalItems), finalAmount,
                    technicianId, promisedAt?.toISOString() || null, expectedVersion],
            );
            if (!updated.length) throw new ConflictException('Repair order version conflict');
            if (mileageKm !== null) {
                const vehicleRows = await query<Array<{ mileage_km: number | null }>>(
                    `SELECT mileage_km FROM customer_vehicles WHERE id = $1::uuid FOR UPDATE`,
                    [current.vehicle_id],
                );
                const priorMileage = vehicleRows[0]?.mileage_km;
                if (priorMileage !== null && priorMileage !== undefined && mileageKm < priorMileage) {
                    throw new ConflictException('Vehicle mileage cannot move backwards');
                }
                await query(
                    `UPDATE customer_vehicles SET mileage_km = $2, updated_at = NOW() WHERE id = $1::uuid`,
                    [current.vehicle_id, mileageKm],
                );
            }
            await this.insertEvent(query, id, 'details_updated', current.status, current.status,
                actor, 'tenant_user', { inspection, diagnosisSummary: diagnosis, finalAmountCents: finalAmount, mileageKm });
            return updated[0];
        });
    }

    async transition(schemaName: string, repairOrderId: string, input: {
        status: string;
        expectedVersion: number;
        reason?: string;
    }, actorId?: string | null): Promise<any> {
        const id = assertUuid(repairOrderId, 'repairOrderId')!;
        const target = input.status as RepairOrderStatus;
        if (!REPAIR_ORDER_STATUSES.includes(target)) throw new BadRequestException('Invalid repair order status');
        if (target === 'approved' || target === 'rejected') {
            throw new BadRequestException('Estimate decisions require the dedicated evidence path');
        }
        const expectedVersion = Number(input.expectedVersion);
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
            throw new BadRequestException('expectedVersion is required');
        }
        const actor = assertUuid(actorId, 'actorId', true);
        const reason = cleanText(input.reason, 1_000);
        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const current = await this.lockOrder(query, id);
            if (current.version !== expectedVersion) throw new ConflictException('Repair order version conflict');
            if (current.status === target) return { ...current, idempotentReplay: true };
            if (!isRepairOrderTransitionAllowed(current.status, target)) {
                throw new ConflictException(`Invalid repair order transition: ${current.status} -> ${target}`);
            }
            if (target === 'awaiting_approval' && current.estimate_amount_cents === null) {
                throw new ConflictException('An estimate is required before requesting approval');
            }
            if (target === 'delivered' && current.final_amount_cents === null) {
                throw new ConflictException('A final amount is required before delivery');
            }
            const approvalStatus = target === 'awaiting_approval'
                ? 'pending'
                : current.approval_status;
            const updated = await query<any[]>(
                `UPDATE repair_orders
                    SET status = $2,
                        approval_status = $3,
                        version = version + 1,
                        updated_at = NOW()
                  WHERE id = $1::uuid AND version = $4
                  RETURNING *`,
                [id, target, approvalStatus, expectedVersion],
            );
            if (!updated.length) throw new ConflictException('Repair order version conflict');
            await this.insertEvent(query, id, 'status_changed', current.status, target,
                actor, 'tenant_user', { reason });
            return { ...updated[0], idempotentReplay: false };
        });
    }

    async cancelOwned(
        schemaName: string,
        repairOrderId: string,
        contactId: string,
        reason?: string,
    ): Promise<any> {
        const id = assertUuid(repairOrderId, 'repairOrderId')!;
        const owner = assertUuid(contactId, 'contactId')!;
        const cleanReason = cleanText(reason, 1_000);
        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const rows = await query<any[]>(
                `SELECT * FROM repair_orders WHERE id = $1::uuid AND contact_id = $2::uuid FOR UPDATE`,
                [id, owner],
            );
            const current = rows[0];
            if (!current) throw new NotFoundException('Repair order not found');
            if (current.status === 'cancelled') return { ...current, idempotentReplay: true };
            if (!['intake', 'estimating', 'awaiting_approval', 'rejected', 'approved'].includes(current.status)) {
                throw new ConflictException('Repair order can no longer be cancelled by the customer');
            }
            const updated = await query<any[]>(
                `UPDATE repair_orders
                    SET status = 'cancelled', version = version + 1, updated_at = NOW()
                  WHERE id = $1::uuid
                  RETURNING *`,
                [id],
            );
            await this.insertEvent(query, id, 'cancelled_by_customer', current.status, 'cancelled',
                null, 'agent', { reason: cleanReason });
            return { ...updated[0], idempotentReplay: false };
        });
    }

    private async resolveVehicle(
        query: TenantQuery,
        contactId: string,
        input: RepairOrderVehicleInput,
    ): Promise<any> {
        if (input?.id) {
            const id = assertUuid(input.id, 'vehicle.id')!;
            const rows = await query<any[]>(
                `SELECT * FROM customer_vehicles WHERE id = $1::uuid AND contact_id = $2::uuid FOR UPDATE`,
                [id, contactId],
            );
            if (!rows.length) throw new NotFoundException('Customer vehicle not found');
            return rows[0];
        }
        const make = cleanText(input?.make, 120);
        const model = cleanText(input?.model, 120);
        const vin = cleanText(input?.vin, 80)?.toUpperCase() || null;
        const licensePlate = cleanText(input?.licensePlate, 40)?.toUpperCase() || null;
        const color = cleanText(input?.color, 80);
        const year = input?.year === undefined || input?.year === null ? null : Number(input.year);
        const mileageKm = input?.mileageKm === undefined || input?.mileageKm === null
            ? null
            : Number(input.mileageKm);
        if (!make || !model) throw new BadRequestException('vehicle make and model are required');
        if (!vin && !licensePlate) throw new BadRequestException('vehicle VIN or license plate is required');
        if (year !== null && (!Number.isInteger(year) || year < 1886 || year > 2200)) {
            throw new BadRequestException('vehicle year is invalid');
        }
        if (mileageKm !== null && (!Number.isInteger(mileageKm) || mileageKm < 0)) {
            throw new BadRequestException('vehicle mileageKm is invalid');
        }
        const existing = await query<any[]>(
            `SELECT * FROM customer_vehicles
              WHERE contact_id = $1::uuid
                AND (($2::text IS NOT NULL AND LOWER(vin) = LOWER($2))
                  OR ($3::text IS NOT NULL AND LOWER(license_plate) = LOWER($3)))
              ORDER BY updated_at DESC
              LIMIT 1
              FOR UPDATE`,
            [contactId, vin, licensePlate],
        );
        if (existing.length) {
            const current = existing[0];
            if (mileageKm !== null && current.mileage_km !== null && mileageKm < current.mileage_km) {
                throw new ConflictException('Vehicle mileage cannot move backwards');
            }
            const updated = await query<any[]>(
                `UPDATE customer_vehicles
                    SET make = $2, model = $3,
                        year = COALESCE($4, year), vin = COALESCE($5, vin),
                        license_plate = COALESCE($6, license_plate), color = COALESCE($7, color),
                        mileage_km = COALESCE($8, mileage_km), updated_at = NOW()
                  WHERE id = $1::uuid
                  RETURNING *`,
                [current.id, make, model, year, vin, licensePlate, color, mileageKm],
            );
            return updated[0];
        }
        const inserted = await query<any[]>(
            `INSERT INTO customer_vehicles
                (contact_id, make, model, year, vin, license_plate, color, mileage_km)
             VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [contactId, make, model, year, vin, licensePlate, color, mileageKm],
        );
        return inserted[0];
    }

    private async lockOrder(query: TenantQuery, repairOrderId: string): Promise<any> {
        const rows = await query<any[]>(
            `SELECT * FROM repair_orders WHERE id = $1::uuid FOR UPDATE`,
            [repairOrderId],
        );
        if (!rows.length) throw new NotFoundException('Repair order not found');
        return rows[0];
    }

    private async insertEvent(
        query: TenantQuery,
        repairOrderId: string,
        eventType: string,
        fromStatus: string | null,
        toStatus: string | null,
        actorId: string | null,
        actorType: 'tenant_user' | 'agent' | 'system',
        payload: Record<string, unknown>,
    ): Promise<void> {
        await query(
            `INSERT INTO repair_order_events
                (repair_order_id, event_type, from_status, to_status, actor_id, actor_type, payload)
             VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6, $7::jsonb)`,
            [repairOrderId, eventType, fromStatus, toStatus, actorId, actorType, JSON.stringify(payload)],
        );
    }
}
