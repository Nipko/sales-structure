import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PetCommands, type PetCommandOptions, type PetCreateInput } from './pet-commands';

/**
 * Pets — veterinary clinic data model. The "patient" in vet workflows is
 * the pet, not the contact. A contact (the tutor / owner) can have many
 * pets; appointments and treatment notes are tied to a specific pet via
 * appointment.metadata.pet_id (we don't add an FK column to appointments
 * so this stays clean for non-veterinaria tenants).
 *
 * Vaccinations are tracked per pet with a next_due_at date so the AI
 * agent can answer "when is Toby's next rabies shot?" without needing
 * the human team to look it up.
 */
@Injectable()
export class PetsService {
    private readonly logger = new Logger(PetsService.name);

    private readonly commands: PetCommands;
    constructor(private readonly prisma: PrismaService) { this.commands = new PetCommands(prisma); }

    // ── Pets CRUD ─────────────────────────────────────────────────

    /** Global list across all tutors — used by /admin/pets page. */
    async listAll(
        schemaName: string,
        filters: { species?: string; search?: string; limit?: number; offset?: number } = {},
    ): Promise<{ items: any[]; total: number; limit: number; offset: number; hasMore: boolean }> {
        const where: string[] = ['p.is_active = true'];
        const params: any[] = [];
        let idx = 1;
        if (filters.species && filters.species !== 'all') {
            where.push(`p.species = $${idx}`);
            params.push(filters.species);
            idx++;
        }
        if (filters.search) {
            where.push(`(p.name ILIKE $${idx} OR c.name ILIKE $${idx} OR c.phone ILIKE $${idx})`);
            params.push(`%${filters.search}%`);
            idx++;
        }
        const requestedLimit = filters.limit ?? 50;
        const requestedOffset = filters.offset ?? 0;
        if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
            throw new BadRequestException('limit must be a positive integer');
        }
        if (!Number.isInteger(requestedOffset) || requestedOffset < 0) {
            throw new BadRequestException('offset must be a non-negative integer');
        }
        const limit = Math.min(requestedLimit, 100);
        const offset = requestedOffset;
        const countRows = await this.prisma.executeInTenantSchema<Array<{ total: number }>>(
            schemaName,
            `SELECT COUNT(*)::int AS total
               FROM pets p
               LEFT JOIN contacts c ON c.id = p.contact_id
              WHERE ${where.join(' AND ')}`,
            params,
        );
        const total = Number(countRows?.[0]?.total || 0);
        const limitParam = idx++;
        const offsetParam = idx++;
        const items = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT
                p.*,
                c.name AS contact_name,
                c.phone AS contact_phone,
                (SELECT COUNT(*)::int FROM pet_vaccinations v WHERE v.pet_id = p.id) AS vaccinations_count,
                (SELECT MAX(created_at) FROM appointments a
                    WHERE (a.metadata->>'pet_id')::uuid = p.id) AS last_visit
             FROM pets p
             LEFT JOIN contacts c ON c.id = p.contact_id
             WHERE ${where.join(' AND ')}
             ORDER BY p.created_at DESC, p.id DESC
             LIMIT $${limitParam} OFFSET $${offsetParam}`,
            [...params, limit, offset],
        );
        return { items, total, limit, offset, hasMore: offset + items.length < total };
    }

    async listForContact(schemaName: string, contactId: string, includeInactive = false): Promise<any[]> {
        const where = includeInactive ? '' : 'AND is_active = true';
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM pets WHERE contact_id = $1::uuid ${where} ORDER BY created_at DESC`,
            [contactId],
        );
    }

    async getById(schemaName: string, petId: string): Promise<any | null> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM pets WHERE id = $1::uuid`,
            [petId],
        );
        return rows?.[0] || null;
    }

    async getByMicrochip(schemaName: string, microchipId: string): Promise<any | null> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM pets WHERE microchip_id = $1`,
            [microchipId],
        );
        return rows?.[0] || null;
    }

    async create(schemaName: string, data: PetCreateInput, options?: PetCommandOptions): Promise<any> {
        return this.commands.create(schemaName, data, options);
    }

    async update(schemaName: string, petId: string, data: any, options?: PetCommandOptions): Promise<any> {
        return this.commands.update(schemaName, petId, data, options);
    }

    async delete(schemaName: string, petId: string): Promise<void> {
        // Soft delete — preserve appointment / vaccination history.
        await this.commands.update(schemaName, petId, { isActive: false });
    }

    // ── Vaccinations ──────────────────────────────────────────────

    async listVaccinations(schemaName: string, petId: string): Promise<any[]> {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM pet_vaccinations WHERE pet_id = $1::uuid
             ORDER BY applied_at DESC`,
            [petId],
        );
    }

    async addVaccination(schemaName: string, petId: string, data: {
        vaccineName: string;
        appliedAt: string;
        nextDueAt?: string;
        lotNumber?: string;
        vetName?: string;
        notes?: string;
    }): Promise<any> {
        if (!data.vaccineName || !data.appliedAt) {
            throw new BadRequestException('vaccineName and appliedAt are required');
        }
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO pet_vaccinations (
                pet_id, vaccine_name, applied_at, next_due_at,
                lot_number, vet_name, notes
             ) VALUES (
                $1::uuid, $2, $3::date, $4::date, $5, $6, $7
             ) RETURNING *`,
            [
                petId, data.vaccineName, data.appliedAt,
                data.nextDueAt || null, data.lotNumber || null,
                data.vetName || null, data.notes || null,
            ],
        );
        return rows?.[0];
    }

    async deleteVaccination(schemaName: string, vaccinationId: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `DELETE FROM pet_vaccinations WHERE id = $1::uuid`,
            [vaccinationId],
        );
    }

    /**
     * Convenience used by AI tools — returns pets + their upcoming
     * vaccinations (next 90 days) in a single shape ready for the LLM.
     */
    async summaryForContact(schemaName: string, contactId: string): Promise<any> {
        const pets = await this.listForContact(schemaName, contactId, false);
        if (!pets.length) return { pets: [], totalPets: 0 };

        const enriched = await Promise.all(pets.map(async (p) => {
            const vaccinations = await this.listVaccinations(schemaName, p.id);
            const lastByVaccine: Record<string, any> = {};
            for (const v of vaccinations) {
                if (!lastByVaccine[v.vaccine_name] ||
                    new Date(v.applied_at) > new Date(lastByVaccine[v.vaccine_name].applied_at)) {
                    lastByVaccine[v.vaccine_name] = v;
                }
            }
            const upcoming = Object.values(lastByVaccine)
                .filter((v: any) => v.next_due_at && new Date(v.next_due_at) >= new Date())
                .sort((a: any, b: any) =>
                    new Date(a.next_due_at).getTime() - new Date(b.next_due_at).getTime(),
                );
            const overdue = Object.values(lastByVaccine)
                .filter((v: any) => v.next_due_at && new Date(v.next_due_at) < new Date());
            return {
                id: p.id,
                name: p.name,
                species: p.species,
                breed: p.breed,
                ageYears: p.birth_date
                    ? Math.floor((Date.now() - new Date(p.birth_date).getTime()) / (1000 * 60 * 60 * 24 * 365))
                    : null,
                weightKg: p.weight_kg,
                allergies: p.allergies,
                chronicConditions: p.chronic_conditions,
                upcomingVaccinations: upcoming.slice(0, 3),
                overdueVaccinations: overdue,
            };
        }));
        return { pets: enriched, totalPets: enriched.length };
    }
}
