import { projectOwnCatalogRow } from './catalog-turn-projection';
import { PromptAssemblerService } from './prompt-assembler.service';

/**
 * Production evidence (tenant "Tienda QA Electronica", product "Audifono QA", stock 2):
 * asked alone, the stock question made the model call check_stock and answer "2 unidades".
 * Asked together with price and warranty, the model answered from the turn's `<catalog>`
 * block, which carried only `in_stock="true"`, and said "hay unidades" with no number.
 */
describe('own catalog rows carry the stock quantity', () => {
    const row = (stock: unknown) => ({ id: 'p1', name: 'Audifono QA', price: '129900', currency: 'COP', stock, category: 'audio' });

    it('keeps the known quantity next to the availability flag', () => {
        expect(projectOwnCatalogRow(row(2))).toMatchObject({ title: 'Audifono QA', inStock: true, stock: 2 });
        expect(projectOwnCatalogRow(row('2'))).toMatchObject({ inStock: true, stock: 2 });
    });

    it('reports zero units as a quantity, not as a missing value', () => {
        expect(projectOwnCatalogRow(row(0))).toMatchObject({ inStock: false, stock: 0 });
    });

    it('states no quantity when the product does not track stock', () => {
        const projected = projectOwnCatalogRow(row(null));
        expect(projected.inStock).toBe(true);
        expect(projected).not.toHaveProperty('stock');
    });
});

describe('the prompt <catalog> block exposes the stock quantity', () => {
    const assembler = new PromptAssemblerService({ buildSystemPrompt: () => '' } as any);
    const render = (catalog: any[]) => (assembler as any).buildTurnLayer({ language: 'es', timezone: 'America/Bogota', catalog });

    it('renders stock="2" so a compound question can be answered without a tool call', () => {
        const xml: string = render([{ id: 'p1', title: 'Audifono QA', price: 129900, currency: 'COP', inStock: true, stock: 2 }]);
        expect(xml).toContain('in_stock="true"');
        expect(xml).toContain('stock="2"');
    });

    it('renders no stock attribute when the quantity is unknown', () => {
        const xml: string = render([{ id: 'p1', title: 'Audifono QA', inStock: true }]);
        expect(xml).not.toMatch(/ stock="/);
    });
});
