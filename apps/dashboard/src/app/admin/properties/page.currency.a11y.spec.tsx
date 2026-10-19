import { interact, renderScreen } from '@/test/a11y';
import PropertiesPage from './page';
import { api } from '@/lib/api';

let mockCurrency: string | null = 'COP';
jest.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 'tenant-qa' }) }));
jest.mock('@/hooks/useOperatingCurrency', () => ({ useOperatingCurrency: () => mockCurrency }));
jest.mock('@/components/ui/help-panel', () => ({ HelpPanel: () => null }));
jest.mock('@/components/ui/page-header', () => ({ PageHeader: ({ action }: any) => <header>{action}</header> }));
jest.mock('@/lib/api', () => ({ api: { listProperties: jest.fn(), getBusinessInfo: jest.fn(), createProperty: jest.fn() } }));

beforeEach(() => {
    jest.clearAllMocks(); mockCurrency = 'COP';
    (api.listProperties as jest.Mock).mockResolvedValue({ success: true, data: [] });
    (api.getBusinessInfo as jest.Mock).mockResolvedValue({ success: true, data: {} });
    (api.createProperty as jest.Mock).mockResolvedValue({ success: false, httpStatus: 400 });
});

async function open() {
    const screen = await renderScreen(<PropertiesPage />);
    await interact(() => [...screen.container.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Agregar propiedad')!.click());
    const name = screen.container.querySelector<HTMLInputElement>('input:not([type])')!;
    await interact(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'QA room');
        name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const save = [...screen.container.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Guardar')!;
    return { screen, name, save, currency: screen.container.querySelector('select')! };
}

it('sends the resolved operating currency shown by the selector even without business country', async () => {
    const { screen, save, currency } = await open();
    try {
        expect(currency.value).toBe('COP');
        await interact(() => save.click());
        expect(api.createProperty).toHaveBeenCalledWith('tenant-qa', expect.objectContaining({ name: 'QA room', currency: 'COP' }));
    } finally { screen.unmount(); }
});

it('shows no currency and blocks saving while the operating currency is unresolved', async () => {
    mockCurrency = null;
    const { screen, save, currency } = await open();
    try {
        expect(currency.value).toBe('');
        expect(save.disabled).toBe(true);
        await interact(() => save.click());
        expect(api.createProperty).not.toHaveBeenCalled();
    } finally { screen.unmount(); }
});

it('keeps an explicit selection when the operating currency resolves later', async () => {
    mockCurrency = null;
    const { screen, name, currency, save } = await open();
    try {
        await interact(() => { currency.value = 'USD'; currency.dispatchEvent(new Event('change', { bubbles: true })); });
        mockCurrency = 'COP';
        await interact(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'QA selected');
            name.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(currency.value).toBe('USD');
        await interact(() => save.click());
        expect(api.createProperty).toHaveBeenCalledWith('tenant-qa', expect.objectContaining({ currency: 'USD' }));
    } finally { screen.unmount(); }
});
