import { randomUUID } from 'crypto';
import { CustomerPortalService } from './customer-portal.service';
import { CRM_BASE_TABLES, N3_DATABASE_URL, openLive, seedCustomer } from '../conversations/__fixtures__/n3-live-harness';

/** N3 · getProfile against the canonical `contacts` table (no is_active, first_name, language...). */
(N3_DATABASE_URL ? describe : describe.skip)('N3: customer portal profile on the canonical schema', () => {
    jest.setTimeout(120_000);
    let h: Awaited<ReturnType<typeof openLive>>;
    let service: CustomerPortalService;

    beforeAll(async () => {
        h = await openLive({ prefix: 'n3prof', tables: [...CRM_BASE_TABLES, 'customer_memory_erasure'] });
        const redis = { get: async () => h.schema, set: async () => undefined };
        service = new CustomerPortalService(h.prisma, redis as any, {} as any, {} as any);
    });
    afterAll(async () => { if (h) await h.close(); });

    it('returns the contact profile', async () => {
        const C = await seedCustomer(h.q, 'Perfil Uno', { email: 'p1@example.invalid', phone: '+573001112233' });
        const profile = await service.getProfile(h.tenantId, C.contactId);
        expect(profile).toMatchObject({ id: C.contactId, name: 'Perfil Uno', email: 'p1@example.invalid', phone: '+573001112233' });
    });

    it('does not return an erased contact', async () => {
        const C = await seedCustomer(h.q, 'Borrado');
        await h.q('INSERT INTO customer_memory_erasure(contact_id) VALUES($1::uuid)', [C.contactId]);
        await expect(service.getProfile(h.tenantId, C.contactId)).rejects.toThrow('Contact profile not found');
        await expect(service.getProfile(h.tenantId, randomUUID())).rejects.toThrow('Contact profile not found');
    });
});
