import Lead360Page from './page';
import { api } from '@/lib/api';
import { renderScreen, type RenderedScreen } from '@/test/a11y';

jest.mock('next/navigation', () => {
    const router = { push: jest.fn(), replace: jest.fn() };
    return { useParams: () => ({ leadId: 'qa-lead' }), useRouter: () => router, usePathname: () => '/admin/contacts/qa-lead' };
});
jest.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 'qa-tenant' }) }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ verticalConfig: { industry: 'turismo' } }) }));
jest.mock('@/hooks/useVerticalTerms', () => ({ useVerticalTerms: () => ({ customerNoun: 'viajero', customerNounPlural: 'viajeros' }) }));
jest.mock('@/components/ui/page-header', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
jest.mock('@/components/ui/breadcrumbs', () => ({ Breadcrumbs: () => null }));
jest.mock('@/components/TreatmentPlansCard', () => ({ TreatmentPlansCard: () => null }));
jest.mock('@/components/PetsCard', () => ({ PetsCard: () => null }));
jest.mock('@/lib/api', () => ({ api: { fetch: jest.fn(), getStages: jest.fn() } }));

let screen: RenderedScreen;
let stage: string;
const fetch = api.fetch as jest.Mock, getStages = api.getStages as jest.Mock;
beforeEach(() => {
    stage = 'cotizacion';
    fetch.mockReset(); getStages.mockReset();
    getStages.mockResolvedValue({ success: true, data: [{ id: 'qa-stage', slug: 'cotizacion', name: 'Cotización' }] });
    fetch.mockImplementation(async (url: string) => url === '/crm/leads/qa-tenant/qa-lead'
        ? { data: { lead: { id: 'qa-lead', contact_id: 'qa-contact', first_name: 'Prueba', last_name: 'QA', stage, score: 7 }, opportunities: [{ id: 'qa-opportunity', stage }], tags: [] } }
        : { data: url.endsWith('/score') ? null : [] });
});
afterEach(() => { screen?.unmount(); });

it('uses the configured vertical stage name for both the profile and its opportunity', async () => {
    screen = await renderScreen(<Lead360Page />);
    const labels = Array.from(screen.container.querySelectorAll('span')).filter(el => el.textContent === 'Cotización');
    expect(labels).toHaveLength(2);
    expect(screen.container.textContent).not.toContain('common.stages.');
    expect(getStages).toHaveBeenCalledWith('qa-tenant');
});

it('preserves a tenant-renamed stage instead of substituting the generic dictionary label', async () => {
    stage = 'nuevo';
    getStages.mockResolvedValue({ data: [{ id: 'qa-stage', slug: stage, name: 'Primera atención QA' }] });
    screen = await renderScreen(<Lead360Page />);
    expect(screen.container.textContent?.match(/Primera atención QA/g)).toHaveLength(2);
});

it('keeps the profile readable when the stage configuration request fails', async () => {
    stage = 'revision_especial_qa';
    getStages.mockRejectedValue(new Error('stage lookup unavailable'));
    screen = await renderScreen(<Lead360Page />);
    expect(screen.container.querySelector('h1')?.textContent).toBe('Lead 360°');
    expect(screen.container.textContent).toContain('Revision especial qa');
    expect(screen.container.textContent).not.toContain('common.stages.');
});

it('still translates generic stages when there is no matching configured definition', async () => {
    stage = 'ganado';
    getStages.mockResolvedValue({ data: [] });
    screen = await renderScreen(<Lead360Page />);
    expect(screen.container.textContent?.match(/Ganado/g)).toHaveLength(2);
    expect(screen.container.textContent).not.toContain('common.stages.');
});
