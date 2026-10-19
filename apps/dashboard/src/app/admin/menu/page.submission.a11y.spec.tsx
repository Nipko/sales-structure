import { interact, renderScreen } from '@/test/a11y';
import MenuPage from './page';
import { api } from '@/lib/api';

jest.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 'tenant-qa' }) }));
jest.mock('@/hooks/useOperatingCurrency', () => ({ useOperatingCurrency: () => 'COP' }));
jest.mock('@/components/ui/help-panel', () => ({ HelpPanel: () => null }));
jest.mock('@/components/BulkImportModal', () => ({ BulkImportModal: () => null }));
jest.mock('@/lib/api', () => ({ api: { listMenuCategories: jest.fn(), listMenuItems: jest.fn(), createMenuItem: jest.fn() } }));

beforeEach(() => {
    jest.clearAllMocks();
    (api.listMenuCategories as jest.Mock).mockResolvedValue({ success: true, data: [] });
    (api.listMenuItems as jest.Mock).mockResolvedValue({ success: true, data: [] });
});

it('keeps fields and blocks another submission when the transport throws', async () => {
    (api.createMenuItem as jest.Mock).mockRejectedValue(new Error('connection interrupted'));
    const { screen, name, save } = await openAndFill();
    try {
        await interact(() => save().click());
        expect(screen.container.contains(name)).toBe(true);
        expect(screen.container.querySelector('[role="alert"]')?.textContent).toContain('confirmar');
        expect(save().disabled).toBe(true);
        await interact(() => save().click());
        expect(api.createMenuItem).toHaveBeenCalledTimes(1);
    } finally { screen.unmount(); }
});

it('closes and reloads the catalog only after a confirmed successful creation', async () => {
    (api.createMenuItem as jest.Mock).mockResolvedValue({ success: true, data: { id: 'item-qa' } });
    const { screen, name, save } = await openAndFill();
    try {
        await interact(() => save().click());
        expect(api.createMenuItem).toHaveBeenCalledTimes(1);
        expect(screen.container.contains(name)).toBe(false);
        expect(api.listMenuItems).toHaveBeenCalledTimes(2);
    } finally { screen.unmount(); }
});

async function openAndFill() {
    const screen = await renderScreen(<MenuPage />);
    await interact(() => [...screen.container.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Agregar plato')!.click());
    const name = screen.container.querySelector<HTMLInputElement>('input[type="text"]')!;
    const price = screen.container.querySelector<HTMLInputElement>('input[type="number"]')!;
    await interact(() => {
        for (const [input, value] of [[name, 'QA plato'], [price, '-1']] as const) {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });
    const save = () => [...screen.container.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Guardar')!;
    return { screen, name, price, save };
}

it.each([
    [{ success: false, httpStatus: 400, error: 'price must be >= 0' }, false],
    [{ success: false, httpStatus: 500, error: 'server error' }, true],
    [{ success: false, error: 'connection interrupted' }, true],
] as const)('preserves menu fields after %j and blocks uncertain retry=%s', async (result, uncertain) => {
    (api.createMenuItem as jest.Mock).mockResolvedValue(result);
    const { screen, name, price, save } = await openAndFill();
    try {
        await interact(() => save().click());
        expect(api.createMenuItem).toHaveBeenCalledTimes(1);
        expect(api.createMenuItem).toHaveBeenCalledWith('tenant-qa', expect.objectContaining({ name: 'QA plato', price: -1, currency: 'COP' }));
        expect(screen.container.contains(name)).toBe(true);
        expect([name.value, price.value]).toEqual(['QA plato', '-1']);
        expect(screen.container.textContent).not.toContain('Plato guardado correctamente');
        expect(screen.container.querySelector('[role="alert"]')?.textContent?.trim()).toBeTruthy();
        expect(save().disabled).toBe(uncertain);
        if (uncertain) {
            await interact(() => save().click());
            expect(api.createMenuItem).toHaveBeenCalledTimes(1);
        }
    } finally { screen.unmount(); }
});
