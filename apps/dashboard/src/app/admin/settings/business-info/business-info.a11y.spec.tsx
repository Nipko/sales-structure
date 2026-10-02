import { renderScreen, interact, findAccessibilityViolations } from "@/test/a11y";
import { api } from "@/lib/api";
import BusinessInfoPage from "./page";

jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ activeTenantId: "tenant" }) }));
jest.mock("@/components/ui/help-panel", () => ({ HelpPanel: () => null }));
jest.mock("@/lib/api", () => ({ api: { getBusinessInfo: jest.fn(), updateBusinessInfo: jest.fn() } }));

describe("business information uses named fields and the onboarding vocabulary", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getBusinessInfo as jest.Mock).mockResolvedValue({ success: true, data: {
            companyName: 'Example Homes', about: 'Venta de viviendas', industry: 'inmobiliaria',
            customerTypes: ['buyers', 'other:Vecinos'], chatReasons: ['lead_qualification'],
        } });
        (api.updateBusinessInfo as jest.Mock).mockResolvedValue({ success: true });
    });

    it('associates every visible field with its label, including the external logo URL', async () => {
        const screen = await renderScreen(<BusinessInfoPage />);
        try {
            const assertNamedFields = () => {
                for (const input of screen.container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type="file"]), textarea')) {
                    expect(input.labels?.length).toBeGreaterThan(0);
                    expect(input.labels?.[0].textContent?.trim()).toBeTruthy();
                }
            };
            assertNamedFields();
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
            const external = [...screen.container.querySelectorAll('button')].find((button) => button.textContent?.includes('Enlace externo'));
            await interact(() => external!.click());
            assertNamedFields();
            expect(screen.container.querySelector('#business-info-logo-url')).not.toBeNull();
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it('translates a saved vertical audience and preserves its stored key when saving', async () => {
        const screen = await renderScreen(<BusinessInfoPage />);
        try {
            const buyer = [...screen.container.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Compradores');
            expect(buyer?.getAttribute('aria-pressed')).toBe('true');
            expect(screen.container.textContent).not.toContain('buyers');
            expect(screen.container.textContent).toContain('Vecinos');
            await interact(() => buyer!.click());
            expect(buyer?.getAttribute('aria-pressed')).toBe('false');
            await interact(() => buyer!.click());
            const save = [...screen.container.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Guardar cambios');
            await interact(() => save!.click());
            expect(api.updateBusinessInfo).toHaveBeenCalledWith('tenant', expect.objectContaining({ customerTypes: ['other:Vecinos', 'buyers'] }));
        } finally { screen.unmount(); }
    });
});
