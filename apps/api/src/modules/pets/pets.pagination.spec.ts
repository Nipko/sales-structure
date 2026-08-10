import { PetsService } from './pets.service';

describe('PetsService pagination', () => {
    it('searches tutor/pet fields and loads a page after item 200', async () => {
        const executeInTenantSchema = jest.fn()
            .mockResolvedValueOnce([{ total: 260 }])
            .mockResolvedValueOnce(Array.from({ length: 40 }, (_, index) => ({ id: `pet-${index}` })));
        const service = new PetsService({ executeInTenantSchema } as any);

        const page = await service.listAll('tenant_schema', { search: 'Toby', limit: 40, offset: 200 });

        expect(page).toMatchObject({ total: 260, limit: 40, offset: 200, hasMore: true });
        expect(executeInTenantSchema.mock.calls[0][1]).toContain('c.phone ILIKE $1');
        expect(executeInTenantSchema.mock.calls[1][2]).toEqual(['%Toby%', 40, 200]);
    });
});
