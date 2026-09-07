import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveNativeEvidenceOpportunity } from '../../common/utils/native-evidence-opportunity.util';
import { RepairOrderTerms, RepairTermsChangedError, repairOrderTerms, repairRequestHash } from './repair-order-terms';

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
export interface RepairDecisionOptions { expectedVersion: number; expectedTermsHash?: string; }

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
    const currency = typeof value === 'string' ? value.trim().toUpperCase() : null;
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

    private transaction<T>(schema: string, work: (query: TenantQuery) => Promise<T>): Promise<T> {
        return this.prisma.transactionInTenantSchema(schema, async query => {
            // The erasure owner takes this same lock exclusively. A writer can
            // never publish customer-derived data across that boundary.
            await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text', [`agent-privacy:${schema}`]);
            return work(query);
        });
    }

    private async assertContactAvailable(query: TenantQuery, contactId: string): Promise<void> {
        const tables = await query<any[]>("SELECT to_regclass('customer_memory_erasure')::text AS erasure");
        if (!tables[0]?.erasure) return;
        // Erasure materializes a tombstone for every contact in the identity
        // family before unlinking profiles; the stable contact ID is authority.
        const rows = await query<any[]>('SELECT contact_id FROM customer_memory_erasure WHERE contact_id=$1::uuid', [contactId]);
        if (rows.length) throw new ConflictException('contact_erased');
    }

    async getActionTerms(schema: string, id: string, contactId: string, action: RepairOrderTerms['action']): Promise<RepairOrderTerms> {
        return this.transaction(schema, async query => {
            await this.assertContactAvailable(query, assertUuid(contactId, 'contactId')!);
            const row = await this.lockOrder(query, assertUuid(id, 'repairOrderId')!);
            if (row.contact_id !== contactId) throw new NotFoundException('Repair order not found');
            if (action === 'estimate_decision' && row.metadata?.repairDecision?.terms && row.approval_status !== 'pending') {
                return row.metadata.repairDecision.terms;
            }
            if (action === 'cancel' && row.status === 'cancelled' && row.metadata?.repairCancellation?.terms) return row.metadata.repairCancellation.terms;
            if (action === 'cancel' && !['intake','estimating','awaiting_approval','rejected','approved'].includes(row.status)) {
                throw new ConflictException('Repair order can no longer be cancelled by the customer');
            }
            return this.currentTerms(query, row, action);
        });
    }

    private async currentTerms(query: TenantQuery, row: any, action: RepairOrderTerms['action']): Promise<RepairOrderTerms> {
        const vehicles = await query<any[]>('SELECT make,model,vin,license_plate FROM customer_vehicles WHERE id=$1::uuid FOR SHARE', [row.vehicle_id]);
        return repairOrderTerms({ ...row, ...vehicles[0] }, action);
    }

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
        return this.transaction(schemaName, async query => {
        if (filters.contactId) await this.assertContactAvailable(query, filters.contactId);
        const countRows = await query<Array<{ total: number }>>(
            `SELECT COUNT(*)::int AS total
               FROM repair_orders ro
               JOIN customer_vehicles cv ON cv.id = ro.vehicle_id
               ${where}`,
            params,
        );
        const itemParams = [...params, limit, offset];
        const items = await query<any[]>(
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
        });
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
        return this.transaction(schemaName, async query => {
        if (contactId) await this.assertContactAvailable(query, contactId);
        const rows = await query<any[]>(
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
        const events = await query<any[]>(
            `SELECT id, event_type, from_status, to_status, actor_id, actor_type, payload, created_at
               FROM repair_order_events
              WHERE repair_order_id = $1::uuid
              ORDER BY created_at DESC, id DESC
              LIMIT 100`,
            [repairOrderId],
        );
        return { ...rows[0], events };
        });
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
        const requestHash = repairRequestHash({ contactId, customerConcern, reportedSymptoms, appointmentId, opportunityId, conversationId,
            vehicle: { id: input.vehicle?.id || null, make: cleanText(input.vehicle?.make,120), model: cleanText(input.vehicle?.model,120),
                vin: cleanText(input.vehicle?.vin,80)?.toUpperCase() || null, licensePlate: cleanText(input.vehicle?.licensePlate,40)?.toUpperCase() || null,
                year: input.vehicle?.year ?? null, color: cleanText(input.vehicle?.color,80), mileageKm: input.vehicle?.mileageKm ?? null } });

        return this.transaction(schemaName, async (query) => {
            await this.assertContactAvailable(query, contactId);
            // Serialize before ANY vehicle mutation, including requests with
            // different keys for the same customer's vehicle.
            if (idempotencyKey) await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text', [`repair-request:${schemaName}:${idempotencyKey}`]);
            await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text', [`repair-vehicle:${schemaName}:${contactId}`]);
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
                    if (replay[0].contact_id !== contactId || replay[0].metadata?.intakeRequestHash !== requestHash) {
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
            if (appointmentId) {
                const owned = await query<any[]>(`SELECT id FROM appointments WHERE id=$1::uuid AND contact_id=$2::uuid
                    AND status IN ('confirmed','completed') FOR SHARE`, [appointmentId, contactId]);
                if (owned.length !== 1) throw new BadRequestException('appointment must belong to this contact and be confirmed or completed');
            }
            if (conversationId) {
                const owned = await query<any[]>('SELECT id FROM conversations WHERE id=$1::uuid AND contact_id=$2::uuid FOR SHARE', [conversationId, contactId]);
                if (owned.length !== 1) throw new BadRequestException('conversation must belong to this contact');
            }
            const vehicle = await this.resolveVehicle(query, contactId, input.vehicle);
            const resolvedOpportunityId = await resolveNativeEvidenceOpportunity(query, {
                contactId,
                conversationId,
                trustedOpportunityId: opportunityId,
            });
            const inserted = await query<any[]>(
                `INSERT INTO repair_orders (
                    contact_id, vehicle_id, appointment_id, opportunity_id, conversation_id,
                    customer_concern, reported_symptoms, idempotency_key, created_by, metadata
                 ) VALUES (
                    $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
                    $6, $7::jsonb, $8, $9::uuid, $10::jsonb
                 )
                 ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
                 RETURNING *`,
                [
                    contactId, vehicle.id, appointmentId, resolvedOpportunityId, conversationId,
                    customerConcern, JSON.stringify(reportedSymptoms), idempotencyKey, actorId, JSON.stringify({ intakeRequestHash: requestHash }),
                ],
            );
            let row = inserted[0];
            if (!row && idempotencyKey) {
                const existing = await query<any[]>(
                    `SELECT * FROM repair_orders WHERE idempotency_key = $1 LIMIT 1`,
                    [idempotencyKey],
                );
                row = existing[0];
                if (!row || row.contact_id !== contactId || row.metadata?.intakeRequestHash !== requestHash) {
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
        return this.transaction(schemaName, async (query) => {
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
                        metadata = (COALESCE(metadata, '{}'::jsonb) - 'repairDecision') || jsonb_build_object('estimateNotes', $5::text),
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
        options?: RepairDecisionOptions,
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
        if (!Number.isInteger(options?.expectedVersion) || options!.expectedVersion < 1) throw new BadRequestException('expectedVersion is required');
        return this.transaction(schemaName, async (query) => {
            const params = owner ? [id, owner] : [id];
            const rows = await query<any[]>(
                `SELECT * FROM repair_orders
                  WHERE id = $1::uuid ${owner ? 'AND contact_id = $2::uuid' : ''}
                  FOR UPDATE`,
                params,
            );
            const current = rows[0];
            if (!current) throw new NotFoundException('Repair order not found');
            await this.assertContactAvailable(query, current.contact_id);
            const target: RepairOrderStatus = accepted ? 'approved' : 'rejected';
            const previous = current.metadata?.repairDecision;
            if (previous?.accepted === accepted && previous.terms?.orderVersion === options!.expectedVersion
                && (!options?.expectedTermsHash || previous.termsHash === options.expectedTermsHash) && current.approval_status === target) {
                return { ...current, idempotentReplay: true };
            }
            const terms = await this.currentTerms(query, current, 'estimate_decision');
            const termsHash = repairRequestHash(terms);
            if (current.version !== options!.expectedVersion || (options?.expectedTermsHash && options.expectedTermsHash !== termsHash)) {
                throw new RepairTermsChangedError(terms);
            }
            if (actorType === 'agent' && !options?.expectedTermsHash) throw new BadRequestException('repair terms hash is required for agent decisions');
            if (current.status !== 'awaiting_approval' || current.approval_status !== 'pending'
                || current.estimate_amount_cents === null) {
                throw new ConflictException('Repair estimate is not awaiting a decision');
            }
            const updated = await query<any[]>(
                `UPDATE repair_orders
                    SET status = $2,
                        approval_status = $2,
                        metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('repairDecision',$3::jsonb),
                        version = version + 1,
                        updated_at = NOW()
                  WHERE id = $1::uuid
                  RETURNING *`,
                [id, target, JSON.stringify({ accepted, terms, termsHash })],
            );
            await this.insertEvent(query, id, accepted ? 'estimate_approved' : 'estimate_rejected',
                current.status, target, actor, actorType, {
                    estimateAmountCents: Number(current.estimate_amount_cents),
                    currency: current.currency,
                    evidence: decisionEvidence,
                    terms, termsHash,
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
        return this.transaction(schemaName, async (query) => {
            const current = await this.lockOrder(query, id);
            if (TERMINAL_STATUSES.has(current.status)) throw new ConflictException('Repair order is closed');
            if (current.version !== expectedVersion) throw new ConflictException('Repair order version conflict');
            if (technicianId) {
                const staff = await query<Array<{ id: string }>>(
                    `SELECT id FROM staff_members WHERE id = $1::uuid AND is_active = true LIMIT 1 FOR SHARE`,
                    [technicianId],
                );
                if (!staff.length) throw new BadRequestException('assignedTechnicianId must identify active staff');
            }
            const updated = await query<any[]>(
                `UPDATE repair_orders
                    SET inspection = CASE WHEN $9::boolean THEN $2::jsonb ELSE inspection END,
                        diagnosis_summary = CASE WHEN $10::boolean THEN $3::text ELSE diagnosis_summary END,
                        final_line_items = CASE WHEN $11::boolean THEN $4::jsonb ELSE final_line_items END,
                        final_amount_cents = CASE WHEN $12::boolean THEN $5::bigint ELSE final_amount_cents END,
                        assigned_technician_id = CASE WHEN $13::boolean THEN $6::uuid ELSE assigned_technician_id END,
                        promised_at = CASE WHEN $14::boolean THEN $7::timestamptz ELSE promised_at END,
                        version = version + 1,
                        updated_at = NOW()
                  WHERE id = $1::uuid AND version = $8
                  RETURNING *`,
                [id, JSON.stringify(inspection), diagnosis, JSON.stringify(finalItems), finalAmount,
                    technicianId, promisedAt?.toISOString() || null, expectedVersion,
                    input.inspection !== undefined,input.diagnosisSummary !== undefined,input.finalLineItems !== undefined,
                    input.finalAmountCents !== undefined || input.finalLineItems !== undefined,input.assignedTechnicianId !== undefined,input.promisedAt !== undefined],
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
                actor, 'tenant_user', { inspection, diagnosisSummary: diagnosis, finalAmountCents: finalAmount, mileageKm,
                    assignedTechnicianId:technicianId,promisedAt:promisedAt?.toISOString() || null,
                    changedFields:Object.keys(input).filter(key=>key!=='expectedVersion') });
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
        return this.transaction(schemaName, async (query) => {
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
        options?: RepairDecisionOptions,
    ): Promise<any> {
        const id = assertUuid(repairOrderId, 'repairOrderId')!;
        const owner = assertUuid(contactId, 'contactId')!;
        const cleanReason = cleanText(reason, 1_000);
        if (!Number.isInteger(options?.expectedVersion) || options!.expectedVersion < 1) throw new BadRequestException('expectedVersion is required');
        return this.transaction(schemaName, async (query) => {
            const rows = await query<any[]>(
                `SELECT * FROM repair_orders WHERE id = $1::uuid AND contact_id = $2::uuid FOR UPDATE`,
                [id, owner],
            );
            const current = rows[0];
            if (!current) throw new NotFoundException('Repair order not found');
            await this.assertContactAvailable(query, current.contact_id);
            if (current.status === 'cancelled' && current.metadata?.repairCancellation?.termsHash === options?.expectedTermsHash) return { ...current, idempotentReplay: true };
            const terms = await this.currentTerms(query, current, 'cancel');
            if (current.version !== options!.expectedVersion || !options?.expectedTermsHash || repairRequestHash(terms) !== options.expectedTermsHash) {
                throw new RepairTermsChangedError(terms);
            }
            if (!['intake', 'estimating', 'awaiting_approval', 'rejected', 'approved'].includes(current.status)) {
                throw new ConflictException('Repair order can no longer be cancelled by the customer');
            }
            const updated = await query<any[]>(
                `UPDATE repair_orders
                    SET status = 'cancelled', version = version + 1, updated_at = NOW(),
                        metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('repairCancellation',$2::jsonb)
                  WHERE id = $1::uuid
                  RETURNING *`,
                [id, JSON.stringify({terms,termsHash:repairRequestHash(terms)})],
            );
            await this.insertEvent(query, id, 'cancelled_by_customer', current.status, 'cancelled',
                null, 'agent', { reason: cleanReason, terms, termsHash: repairRequestHash(terms) });
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
              LIMIT 2
              FOR UPDATE`,
            [contactId, vin, licensePlate],
        );
        if (existing.length) {
            if (existing.length > 1) throw new ConflictException('Vehicle identity is ambiguous');
            const current = existing[0];
            if ((vin && current.vin && vin !== current.vin.toUpperCase())
                || (licensePlate && current.license_plate && licensePlate !== current.license_plate.toUpperCase())
                || current.make.toLowerCase() !== make.toLowerCase() || current.model.toLowerCase() !== model.toLowerCase()) {
                throw new ConflictException('Vehicle identity conflicts with the registered vehicle');
            }
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
        await this.assertContactAvailable(query, rows[0].contact_id);
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
