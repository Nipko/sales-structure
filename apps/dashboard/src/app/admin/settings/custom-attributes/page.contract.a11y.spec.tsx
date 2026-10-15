import { interact, renderScreen } from '@/test/a11y';
import CustomAttributesPage from './page';

jest.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 'tenant-1' }) }));
jest.mock('@/hooks/usePlanLimits', () => ({ usePlanLimits: () => ({ canCreate: () => true, getLimit: () => null }) }));
jest.mock('@/components/ui/help-panel', () => ({ HelpPanel: () => null }));
jest.mock('@/components/ui/upgrade-banner', () => ({ UpgradeBanner: () => null }));

const fetchMock = jest.fn();
const originalFetch = global.fetch;
let rows: Record<string, unknown>[];
beforeEach(() => {
    localStorage.clear(); fetchMock.mockReset(); rows = [];
    global.fetch = fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
        if (!url.includes('/crm/custom-attributes/tenant-1')) throw Error('Unexpected endpoint');
        if (init.method === 'POST') {
            const body = JSON.parse(String(init.body));
            if (!body.entityType || !body.attributeKey || !body.attributeLabel || !body.attributeType)
                return { ok: false, status: 500, json: async () => ({ message: 'Invalid service contract' }) };
            rows.push({ id: 'attribute-1', entity_type: body.entityType, attribute_key: body.attributeKey,
                attribute_label: body.attributeLabel, attribute_type: body.attributeType, required: body.required, options: body.options });
        }
        return { ok: true, status: 200, json: async () => ({ success: true, data: init.method === 'POST' ? rows[0] : rows }) };
    });
});
afterAll(() => { global.fetch = originalFetch; });
const button = (root: HTMLElement, text: string) => [...root.querySelectorAll('button')].find(e => e.textContent?.trim() === text)!;

it('submits the real form once and displays the canonical persisted label', async () => {
    const screen = await renderScreen(<CustomAttributesPage />);
    try {
        await interact(() => button(screen.container, 'Nuevo atributo').click());
        const input = screen.container.querySelector('input[placeholder="ej.: Cumpleaños"]') as HTMLInputElement;
        await interact(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'QA preference');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await interact(() => button(screen.container, 'Crear').click());
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
        expect(rows).toHaveLength(1);
        expect(screen.container.querySelector('tbody')?.textContent).toContain('QA preference');
        expect(screen.container.querySelector('input[placeholder="ej.: Cumpleaños"]')).toBeNull();
    } finally { screen.unmount(); }
});

it('loads canonical label, type and options into the actual edit form without writes', async () => {
    rows = [{ id: 'attribute-1', entity_type: 'contact', attribute_key: 'qa_preference',
        attribute_label: 'QA preference', attribute_type: 'list', required: true, options: ['A', 'B'] }];
    const screen = await renderScreen(<CustomAttributesPage />);
    try {
        expect(screen.container.querySelector('tbody')?.textContent).toContain('QA preference');
        const pencil = screen.container.querySelector('button:has(svg.lucide-pencil)') as HTMLButtonElement;
        await interact(() => pencil.click());
        expect((screen.container.querySelector('input[placeholder="ej.: Cumpleaños"]') as HTMLInputElement).value).toBe('QA preference');
        expect((screen.container.querySelectorAll('select')[1] as HTMLSelectElement).value).toBe('list');
        expect((screen.container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('A, B');
        expect(fetchMock.mock.calls.every(([, init]) => !init?.method)).toBe(true);
    } finally { screen.unmount(); }
});
