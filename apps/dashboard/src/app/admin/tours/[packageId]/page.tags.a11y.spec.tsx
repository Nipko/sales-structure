import fs from 'fs';
import path from 'path';
import { interact, renderScreen } from '@/test/a11y';
import TourDetailPage from './page';
import { api } from '@/lib/api';

jest.mock('next/navigation', () => ({ useParams: () => ({ packageId: 'synthetic-package' }) }));
jest.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 'synthetic-tenant' }) }));
jest.mock('@/components/ui/page-header', () => ({ PageHeader: ({ title }: any) => <h1>{title}</h1> }));
jest.mock('@/components/ui/skeleton-loader', () => ({ SkeletonPage: () => null }));
jest.mock('@/lib/api', () => ({ api: { getTourPackage: jest.fn(), updateTourPackage: jest.fn() } }));
const messages = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'messages/es.json'), 'utf8'));

beforeEach(() => {
    jest.clearAllMocks();
    (api.getTourPackage as jest.Mock).mockResolvedValue({ success: true, data: {
        id: 'synthetic-package', name: 'Synthetic tour', duration_type: 'hours', duration_value: 4,
        price: 125, currency: 'EUR', max_capacity: 10, min_party_size: 1, languages: ['es'],
        includes: [], excludes: [], tags: [], images: [], child_discount_pct: 0, is_active: true,
    } });
});

async function fillAndEnter(input: HTMLInputElement, value: string) {
    await interact(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    let defaultAllowed = true;
    await interact(() => { defaultAllowed = input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })); });
    return defaultAllowed;
}

it.each(['includes', 'excludes'] as const)('Enter creates a trimmed %s chip, clears the draft and does not save', async kind => {
    const screen = await renderScreen(<TourDetailPage />);
    try {
        const input = screen.container.querySelector<HTMLInputElement>(`input[placeholder="${messages.tours[kind + 'Placeholder']}"]`)!;
        const group = input.parentElement!.parentElement!;
        expect(await fillAndEnter(input, '  Synthetic QA tag  ')).toBe(false);
        expect(input.value).toBe('');
        expect([...group.querySelectorAll('span.inline-flex')].map(x => x.textContent)).toEqual(['Synthetic QA tag']);
        expect(api.updateTourPackage).not.toHaveBeenCalled();
    } finally { screen.unmount(); }
});

it('ignores a whitespace-only tag and does not save', async () => {
    const screen = await renderScreen(<TourDetailPage />);
    try {
        const input = screen.container.querySelector<HTMLInputElement>(`input[placeholder="${messages.tours.includesPlaceholder}"]`)!;
        await fillAndEnter(input, '   ');
        expect(input.parentElement!.parentElement!.querySelectorAll('span.inline-flex')).toHaveLength(0);
        expect(api.updateTourPackage).not.toHaveBeenCalled();
    } finally { screen.unmount(); }
});

it('removes a locally added chip without saving the package', async () => {
    const screen = await renderScreen(<TourDetailPage />);
    try {
        const input = screen.container.querySelector<HTMLInputElement>(`input[placeholder="${messages.tours.includesPlaceholder}"]`)!;
        const group = input.parentElement!.parentElement!;
        await fillAndEnter(input, 'Synthetic removable tag');
        await interact(() => group.querySelector<HTMLButtonElement>('span.inline-flex button')!.click());
        expect(group.querySelectorAll('span.inline-flex')).toHaveLength(0);
        expect(api.updateTourPackage).not.toHaveBeenCalled();
    } finally { screen.unmount(); }
});
