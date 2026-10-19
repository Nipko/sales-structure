import { interact, renderScreen } from '@/test/a11y';
import ContactsPage from './page';
import { api } from '@/lib/api';

const mockPush = jest.fn();
const mockParams = new URLSearchParams();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn() }), useSearchParams: () => mockParams }));
jest.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 'tenant-qa' }) }));
jest.mock('@/hooks/useVerticalTerms', () => ({ useVerticalTerms: () => ({ customerNoun: 'contacto', customerNounPlural: 'contactos', countCustomers: (n: number) => `${n} contactos`, industry: 'otro' }) }));
jest.mock('@/hooks/usePlanLimits', () => ({ usePlanLimits: () => ({ canCreate: () => true, getLimit: () => 100 }) }));
jest.mock('@/components/ui/help-panel', () => ({ HelpPanel: () => null }));
jest.mock('@/components/ui/upgrade-banner', () => ({ UpgradeBanner: () => null }));
jest.mock('@/lib/api', () => ({ api: { fetch: jest.fn() } }));

beforeEach(() => {
    jest.clearAllMocks();
    (api.fetch as jest.Mock).mockResolvedValue({ success: true, data: [
        { id: 'synthetic-1', first_name: 'QA', last_name: 'Uno', stage: 'nuevo' },
        { id: 'synthetic-2', first_name: 'QA', last_name: 'Dos', stage: 'nuevo' },
    ] });
});

it('identifies each contact details action and opens the matching contact without a write', async () => {
    const screen = await renderScreen(<ContactsPage />);
    try {
        const first = screen.container.querySelector<HTMLButtonElement>('button[aria-label="Ver contacto: QA Uno"]');
        const second = screen.container.querySelector<HTMLButtonElement>('button[aria-label="Ver contacto: QA Dos"]');
        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        await interact(() => second!.click());
        expect(mockPush).toHaveBeenCalledWith('/admin/contacts/synthetic-2');
        expect(api.fetch).toHaveBeenCalledTimes(1);
        expect(api.fetch).toHaveBeenCalledWith('/crm/leads/tenant-qa');
    } finally { screen.unmount(); }
});

it('exposes the filter drawer close action and dismisses it without mutating contacts', async () => {
    const screen = await renderScreen(<ContactsPage />);
    try {
        const open = [...screen.container.querySelectorAll('button')].find(b => b.textContent?.includes('Filtros avanzados'))!;
        const drawer = screen.container.querySelector('#contacts-filter-drawer')!;
        expect(drawer.hasAttribute('inert')).toBe(true);
        expect(drawer.getAttribute('aria-hidden')).toBe('true');
        await interact(() => open.click());
        expect(open.getAttribute('aria-expanded')).toBe('true');
        expect(drawer.hasAttribute('inert')).toBe(false);
        expect(drawer.getAttribute('aria-hidden')).toBe('false');
        const close = screen.container.querySelector<HTMLButtonElement>('button[aria-label="Cerrar filtros"]');
        expect(close).not.toBeNull();
        await interact(() => close!.click());
        expect(drawer.hasAttribute('inert')).toBe(true);
        expect(drawer.getAttribute('aria-hidden')).toBe('true');
        expect(open.getAttribute('aria-expanded')).toBe('false');
        expect(api.fetch).toHaveBeenCalledTimes(1);
    } finally { screen.unmount(); }
});
