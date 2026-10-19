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
jest.mock('@/lib/api', () => ({ api: { getTourPackage: jest.fn(), listTourInventory: jest.fn(), deleteTourInventory: jest.fn() } }));

beforeEach(() => {
    jest.clearAllMocks();
    (api.getTourPackage as jest.Mock).mockResolvedValue({ success: true, data: {
        id: 'synthetic-package', name: 'Synthetic tour', duration_type: 'hours', duration_value: 4,
        price: 125, currency: 'EUR', max_capacity: 10, min_party_size: 1, languages: ['es'],
        includes: [], excludes: [], tags: [], images: [], child_discount_pct: 0, is_active: true,
    } });
    (api.listTourInventory as jest.Mock).mockResolvedValue({ success: true, data: [
        { id: 'synthetic-first', departure_date: '2026-12-15T00:00:00Z', departure_time: '1970-01-01T09:00:00Z', available_seats: 10, total_seats: 10 },
        { id: 'synthetic-second', departure_date: '2026-12-15', departure_time: '15:30:00', available_seats: 8, total_seats: 8 },
    ] });
});

it.each(['es', 'en', 'pt', 'fr'])('names each destructive departure control with its action, date and time in %s', async locale => {
    const messages = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'messages', locale + '.json'), 'utf8'));
    const screen = await renderScreen(<NextIntlClientProvider locale={locale} messages={messages} timeZone="America/Bogota"><TourDetailPage /></NextIntlClientProvider>);
    try {
        await interact(() => screen.container.querySelector<HTMLButtonElement>('[data-tab-id="inventory"]')!.click());
        const controls = [...screen.container.querySelectorAll('div.rounded-xl.p-3.flex > button')];
        expect(controls).toHaveLength(2);
        expect(controls.map(b => b.getAttribute('aria-label'))).toEqual([
            `${messages.common.delete} 2026-12-15 09:00`, `${messages.common.delete} 2026-12-15 15:30`,
        ]);
        expect(api.deleteTourInventory).not.toHaveBeenCalled();
    } finally { screen.unmount(); }
});
