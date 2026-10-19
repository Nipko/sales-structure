import fs from 'fs';
import path from 'path';
import { NextIntlClientProvider } from 'next-intl';
import { interact, renderScreen } from '@/test/a11y';
import ListingsPage from './page';
import { api } from '@/lib/api';

let mockCurrency: string | null = 'USD';
jest.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 'tenant-qa' }) }));
jest.mock('@/hooks/useOperatingCurrency', () => ({ useOperatingCurrency: () => mockCurrency }));
jest.mock('@/components/ui/help-panel', () => ({ HelpPanel: () => null }));
jest.mock('@/components/ui/page-header', () => ({ PageHeader: ({ action }: any) => <header>{action}</header> }));
jest.mock('@/components/media/PhotoManager', () => ({ PhotoManager: () => null }));
jest.mock('@/components/BulkImportModal', () => ({ BulkImportModal: () => null }));
jest.mock('@/lib/api', () => ({ api: { listListings: jest.fn(), createListing: jest.fn() } }));

beforeEach(() => {
    jest.clearAllMocks(); mockCurrency = 'USD';
    (api.listListings as jest.Mock).mockResolvedValue({ success: true, data: [] });
    (api.createListing as jest.Mock).mockResolvedValue({ success: false, error: 'Synthetic rejection' });
});

async function input(control: HTMLInputElement, value: string) {
    await interact(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(control, value);
        control.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

async function open(locale = 'es') {
    const messages = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'messages', locale + '.json'), 'utf8'));
    const screen = await renderScreen(<NextIntlClientProvider locale={locale} messages={messages} timeZone="America/Bogota"><ListingsPage /></NextIntlClientProvider>);
    await interact(() => [...screen.container.querySelectorAll('button')].find(b => b.textContent?.trim() === messages.listings.createListing)!.click());
    const name = screen.container.querySelector<HTMLInputElement>('input:not([type])')!;
    await input(name, 'Synthetic QA apartment');
    const save = [...screen.container.querySelectorAll('button')].filter(b => b.textContent?.trim() === messages.listings.createListing).pop()!;
    return { screen, name, save, messages, currency: screen.container.querySelector<HTMLSelectElement>('#listing-currency')! };
}

it.each(['es', 'en', 'pt', 'fr'])('shows a named currency selector and sends the displayed operating currency in %s', async locale => {
    const { screen, currency, save, messages } = await open(locale);
    try {
        expect(currency).not.toBeNull();
        expect(currency.labels?.[0]?.textContent?.trim()).toBe(messages.listings.currency);
        expect(currency.value).toBe('USD');
        await interact(() => save.click());
        expect(api.createListing).toHaveBeenCalledWith('tenant-qa', expect.objectContaining({ name: 'Synthetic QA apartment', currency: 'USD' }));
    } finally { screen.unmount(); }
});

it('blocks creation until an unresolved currency is explicitly chosen', async () => {
    mockCurrency = null;
    const { screen, save, currency } = await open();
    try {
        expect(save.disabled).toBe(true);
        expect(currency.value).toBe('');
        await interact(() => save.click());
        expect(api.createListing).not.toHaveBeenCalled();
    } finally { screen.unmount(); }
});

it('uses a currency that resolves after the create modal mounted', async () => {
    mockCurrency = null;
    const { screen, name, save } = await open();
    try {
        mockCurrency = 'MXN';
        await input(name, 'Synthetic late region');
        await interact(() => save.click());
        expect(api.createListing).toHaveBeenCalledWith('tenant-qa', expect.objectContaining({ currency: 'MXN' }));
    } finally { screen.unmount(); }
});

it('preserves an explicit manual choice when a regional currency resolves later', async () => {
    mockCurrency = null;
    const { screen, name, currency, save } = await open();
    try {
        await interact(() => { currency.value = 'EUR'; currency.dispatchEvent(new Event('change', { bubbles: true })); });
        mockCurrency = 'COP';
        await input(name, 'Synthetic manual currency');
        expect(currency.value).toBe('EUR');
        await interact(() => save.click());
        expect(api.createListing).toHaveBeenCalledWith('tenant-qa', expect.objectContaining({ currency: 'EUR' }));
    } finally { screen.unmount(); }
});
