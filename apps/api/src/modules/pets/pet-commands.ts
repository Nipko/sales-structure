import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantQuery } from '../../common/utils/tenant-contact.util';
import { assertServedAgentAuthority, type ServedAgentAuthority } from '../persona/served-agent-authority';
import { revisionHash } from '../evaluation-revision/evaluation-revision';

export interface PetCommandOptions {
    /** Trusted runtime identity; never derived from the model's pet fields. */
    contactId?: string;
    conversationId?: string;
    idempotencyKey?: string;
    requireIdempotency?: boolean;
    operationalScope?: ServedAgentAuthority;
}
export interface PetCreateInput {
    contactId: string; name: string; species: string; breed?: string; sex?: string;
    isNeutered?: boolean; birthDate?: string; weightKg?: number; color?: string;
    microchipId?: string; allergies?: string; chronicConditions?: string;
    currentMedications?: string; photoUrl?: string;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const PET_SPECIES = ['dog', 'cat', 'bird', 'rabbit', 'reptile', 'rodent', 'fish', 'other'] as const;
const FIELDS: Readonly<Record<string, string>> = Object.freeze({
    name: 'name', species: 'species', breed: 'breed', sex: 'sex', isNeutered: 'is_neutered', birthDate: 'birth_date',
    weightKg: 'weight_kg', color: 'color', microchipId: 'microchip_id', allergies: 'allergies',
    chronicConditions: 'chronic_conditions', currentMedications: 'current_medications', photoUrl: 'photo_url', isActive: 'is_active',
});
const TEXT_LIMITS: Readonly<Record<string, number>> = { name: 255, breed: 255, color: 100, microchipId: 100,
    allergies: 5000, chronicConditions: 5000, currentMedications: 5000, photoUrl: 500 };
const valueParameter = (column: string, position: number): string => `$${position}${column === 'birth_date' ? '::date' : ''}`;
export const PET_COMMAND_RECEIPT_DDL = `CREATE TABLE IF NOT EXISTS pet_command_receipts (
    command_key TEXT PRIMARY KEY,contact_id UUID NOT NULL,pet_id UUID NOT NULL,
    command_kind TEXT NOT NULL CHECK(command_kind IN ('create','update')),
    request_hash TEXT NOT NULL,response_row JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;

function petId(value: unknown): string {
    if (typeof value !== 'string' || !UUID.test(value)) throw new BadRequestException('pet_reference_invalid');
    return value.toLowerCase();
}
function fields(data: unknown, create: boolean): Record<string, unknown> {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BadRequestException('pet_fields_invalid');
    const input = data as Record<string, unknown>, result: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(FIELDS)) {
        if (!Object.hasOwn(input, key) || input[key] === undefined) continue;
        let value = input[key];
        if (key === 'species') {
            if (typeof value !== 'string' || !PET_SPECIES.includes(value as any)) throw new BadRequestException('pet_species_required');
        } else if (key === 'sex') {
            if (value !== null && !['male', 'female', 'unknown'].includes(value as string)) throw new BadRequestException('pet_sex_invalid');
        } else if (key === 'isNeutered' || key === 'isActive') {
            if (!(typeof value === 'boolean' || (key === 'isNeutered' && value === null))) throw new BadRequestException('pet_boolean_invalid');
        } else if (key === 'weightKg') {
            if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 9999.99
                || Math.abs(Math.round(value * 100) - value * 100) > 1e-7)) throw new BadRequestException('pet_weight_invalid');
        } else if (key === 'birthDate') {
            if (value !== null && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
                || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value
                || value > new Date().toISOString().slice(0, 10))) throw new BadRequestException('pet_birth_date_invalid');
        } else {
            if (value !== null && (typeof value !== 'string' || value.length > TEXT_LIMITS[key])) throw new BadRequestException('pet_text_invalid');
            value = typeof value === 'string' ? value.trim() || null : value;
            if (key === 'name' && !value) throw new BadRequestException('pet_name_required');
        }
        result[column] = value;
    }
    if (create && !result.name) throw new BadRequestException('pet_name_required');
    if (create && !result.species) throw new BadRequestException('pet_species_required');
    if (!Object.keys(result).length) throw new BadRequestException('pet_update_empty');
    return result;
}

/** Every pet mutation uses one tenant transaction. Receipts commit with the pet,
 * so a retry after a lost response cannot create or reapply an older update. */
export class PetCommands {
    private readonly ready = new Set<string>();
    constructor(private readonly prisma: PrismaService) {}

    private async ensure(schema: string): Promise<void> {
        if (this.ready.has(schema)) return;
        await this.prisma.transactionInTenantSchema(schema, async query => {
            await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text', [`pet-schema:${schema}`]);
            await query(PET_COMMAND_RECEIPT_DDL);
        });
        this.ready.add(schema);
    }
    private async contact(query: TenantQuery, schema: string, contactId: string, conversationId?: string): Promise<void> {
        const contacts = await query<any[]>('SELECT id FROM contacts WHERE id=$1::uuid FOR SHARE', [contactId]);
        if (!contacts.length) throw new BadRequestException('pet_contact_unavailable');
        const [table] = await query<any[]>('SELECT to_regclass($1)::text AS name', [`${schema}.customer_memory_erasure`]);
        if (table?.name && (await query<any[]>('SELECT contact_id FROM customer_memory_erasure WHERE contact_id=$1::uuid', [contactId])).length)
            throw new ConflictException('contact_erased');
        if (conversationId && !(await query<any[]>('SELECT id FROM conversations WHERE id=$1::uuid AND contact_id=$2::uuid FOR SHARE', [petId(conversationId), contactId])).length)
            throw new BadRequestException('pet_conversation_unavailable');
    }
    async create(schema: string, data: PetCreateInput, options: PetCommandOptions = {}): Promise<any> {
        const contactId = petId(data?.contactId);
        if (options.contactId && petId(options.contactId) !== contactId) throw new BadRequestException('pet_contact_unavailable');
        return this.execute(schema, 'create', contactId, undefined, fields(data, true), options);
    }
    async update(schema: string, id: string, data: unknown, options: PetCommandOptions = {}): Promise<any> {
        return this.execute(schema, 'update', options.contactId ? petId(options.contactId) : undefined, petId(id), fields(data, false), options);
    }
    private async execute(schema: string, kind: 'create' | 'update', suppliedContact: string | undefined, id: string | undefined,
        values: Record<string, unknown>, options: PetCommandOptions): Promise<any> {
        const key = options.idempotencyKey;
        if ((key !== undefined && (typeof key !== 'string' || !key.trim() || key.length > 200))
            || (options.requireIdempotency && !key)) throw new BadRequestException('pet_command_key_required');
        await this.ensure(schema);
        return this.prisma.transactionInTenantSchema(schema, async query => {
            await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text', [`agent-privacy:${schema}`]);
            await assertServedAgentAuthority(query, schema, options.operationalScope);
            // Serialize retries before the object lock, consistently for creates and updates.
            if (key) await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text', [`pet-command:${schema}:${key}`]);
            let contactId = suppliedContact, row: any;
            if (!contactId && id) {
                const [owner] = await query<any[]>('SELECT contact_id FROM pets WHERE id=$1::uuid', [id]);
                if (!owner) throw new NotFoundException('pet_unavailable');
                contactId = petId(owner.contact_id);
            }
            if (!contactId) throw new BadRequestException('pet_contact_unavailable');
            await this.contact(query, schema, contactId, options.conversationId);
            if (id) {
                [row] = await query<any[]>('SELECT * FROM pets WHERE id=$1::uuid AND contact_id=$2::uuid FOR UPDATE', [id, contactId]);
                if (!row || (options.requireIdempotency && row.is_active !== true)) throw new NotFoundException('pet_unavailable');
            }
            const hash = revisionHash({ kind, contactId, petId: id || null, values, conversationId: options.conversationId || null });
            if (key) {
                const [receipt] = await query<any[]>('SELECT * FROM pet_command_receipts WHERE command_key=$1', [key]);
                if (receipt) {
                    if (receipt.contact_id !== contactId || receipt.request_hash !== hash) throw new ConflictException('pet_command_changed');
                    return { ...receipt.response_row, idempotentReplay: true };
                }
            }
            const columns = Object.keys(values), parameters = Object.values(values);
            if (kind === 'create') {
                [row] = await query<any[]>(`INSERT INTO pets(id,contact_id,${columns.join(',')})
                    VALUES(gen_random_uuid(),$1::uuid,${columns.map((column, i) => valueParameter(column, i + 2)).join(',')}) RETURNING *`, [contactId, ...parameters]);
            } else {
                [row] = await query<any[]>(`UPDATE pets SET ${columns.map((column, i) => `${column}=${valueParameter(column, i + 1)}`).join(',')},updated_at=clock_timestamp()
                    WHERE id=$${columns.length + 1}::uuid AND contact_id=$${columns.length + 2}::uuid RETURNING *`, [...parameters, id, contactId]);
            }
            if (!row?.id) throw new Error('pet_command_write_failed');
            if (key) await query(`INSERT INTO pet_command_receipts(command_key,contact_id,pet_id,command_kind,request_hash,response_row)
                VALUES($1,$2::uuid,$3::uuid,$4,$5,$6::jsonb)`, [key, contactId, row.id, kind, hash, JSON.stringify(row)]);
            return row;
        });
    }
}
