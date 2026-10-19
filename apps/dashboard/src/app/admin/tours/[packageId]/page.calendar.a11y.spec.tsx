import fs from 'fs';
import path from 'path';
import { NextIntlClientProvider } from 'next-intl';
import { interact, renderScreen } from '@/test/a11y';
import TourDetailPage from './page';
import { api } from '@/lib/api';

jest.mock('next/navigation', () => ({ useParams: () => ({ packageId: 'synthetic-package' }) }));
jest.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 'synthetic-tenant' }) }));
jest.mock('@/components/ui/page-header', () => ({ PageHeader: ({ title }: any) => <h1>{title}</h1> }));
jest.mock('@/components/ui/skeleton-loader', () => ({ SkeletonPage: () => null }));
jest.mock('@/lib/api', () => ({ api: { getTourPackage: jest.fn(), listTourInventory: jest.fn(), listTourBookings: jest.fn(), createTourInventory: jest.fn(), deleteTourInventory: jest.fn() } }));

beforeEach(() => {
    jest.clearAllMocks();
    (api.getTourPackage as jest.Mock).mockResolvedValue({ success: true, data: {
        id: 'synthetic-package', name: 'Synthetic calendar tour', duration_type: 'hours', duration_value: 4,
        price: 125, currency: 'EUR', max_capacity: 10, min_party_size: 1, languages: ['es'],
        includes: [], excludes: [], tags: [], images: [], child_discount_pct: 0, is_active: true,
    } });
});

async function open(tab: 'inventory' | 'bookings', date: string, time: string, locale = 'es') {
    (api.listTourInventory as jest.Mock).mockResolvedValue({ success: true, data: [{
        id: 'synthetic-departure', departure_date: date, departure_time: time, available_seats: 10, total_seats: 10,
    }] });
    (api.listTourBookings as jest.Mock).mockResolvedValue({ success: true, data: [{
        id: 'synthetic-booking', departure_date: date, departure_time: time, party_size: 2, adults: 2,
        children: 0, guest_name: 'Synthetic QA guest', total_price: 250, currency: 'EUR', status: 'confirmed',
    }] });
    const messages = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'messages', locale + '.json'), 'utf8'));
    const screen = await renderScreen(<NextIntlClientProvider locale={locale} messages={messages} timeZone="America/Bogota"><TourDetailPage /></NextIntlClientProvider>);
    await interact(() => screen.container.querySelector<HTMLButtonElement>(`[data-tab-id="${tab}"]`)!.click());
    return screen;
}

it.each(['es', 'en', 'pt', 'fr'])('renders API ISO departure date and wall-clock time correctly in %s', async locale => {
    const screen = await open('inventory', '2026-12-15T00:00:00Z', '1970-01-01T09:00:00Z', locale);
    try {
        expect(screen.container.querySelector('p.text-2xl')?.textContent).toBe('15');
        expect(screen.container.querySelector('p[class~="mt-0.5"]')?.textContent?.trim()).toBe('09:00');
        expect(screen.container.textContent).not.toMatch(/Invalid Date|NaN|1970-/);
        expect(api.createTourInventory).not.toHaveBeenCalled();
        expect(api.deleteTourInventory).not.toHaveBeenCalled();
    } finally { screen.unmount(); }
});

it.each([
    ['inventory', '2026-12-15', '09:00:00'],
    ['inventory', '2026-12-15', '1970-01-01T09:00:00Z'],
    ['bookings', '2026-12-15', '09:00:00'],
    ['bookings', '2026-12-15T00:00:00Z', '1970-01-01T09:00:00Z'],
] as const)('preserves the business calendar day for %s with %s', async (tab, date, time) => {
    const screen = await open(tab, date, time);
    try {
        expect(screen.container.querySelector('p.text-2xl')?.textContent).toBe('15');
        expect(screen.container.textContent).not.toMatch(/Invalid Date|NaN/);
        if (tab === 'inventory') expect(screen.container.querySelector('p[class~="mt-0.5"]')?.textContent?.trim()).toBe('09:00');
    } finally { screen.unmount(); }
});
