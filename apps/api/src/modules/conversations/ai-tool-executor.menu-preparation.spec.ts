import { AIToolExecutorService } from './ai-tool-executor.service';

describe('menu preparation source semantics', () => {
    const item = { id: '11111111-1111-4111-8111-111111111111', name: 'QA dish',
        description: 'Synthetic only', price: '13500', currency: 'COP', tags: [], allergens: [] };
    async function menu(preparation: number | null) {
        const executor = Object.create(AIToolExecutorService.prototype) as any;
        executor.restaurantsService = { searchMenu: jest.fn().mockResolvedValue([{ ...item, prep_time_minutes: preparation }]) };
        return executor.getMenu('tenant_synthetic', { query: 'QA dish' });
    }
    it('distinguishes a readable menu with missing preparation time from unavailable access', async () => {
        const result = await menu(null);
        expect(result.items[0]).toMatchObject({ name: 'QA dish', prepTimeMinutes: null });
        expect(result.preparationTimeNotice).toContain('not recorded');
        expect(result.preparationTimeNotice).toContain('Do not invent');
        expect(result.preparationTimeNotice).toContain('not an access failure');
        expect(result.error).toBeUndefined();
    });
    it('preserves a configured preparation time without substituting a default', async () => {
        const result = await menu(22);
        expect(result.items[0].prepTimeMinutes).toBe(22);
        expect(result.preparationTimeNotice).toBeUndefined();
    });
});
