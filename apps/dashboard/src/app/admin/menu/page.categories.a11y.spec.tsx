import { interact, renderScreen, findAccessibilityViolations } from '@/test/a11y';
import MenuPage from './page';
import { api } from '@/lib/api';

jest.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 'tenant-qa' }) }));
jest.mock('@/hooks/useOperatingCurrency', () => ({ useOperatingCurrency: () => 'COP' }));
jest.mock('@/components/ui/help-panel', () => ({ HelpPanel: () => null }));
jest.mock('@/components/BulkImportModal', () => ({ BulkImportModal: () => null }));
jest.mock('@/lib/api', () => ({ api: { listMenuCategories: jest.fn(), listMenuItems: jest.fn() } }));

it('exposes the empty menu category toggle by name and expansion state without writing', async () => {
    (api.listMenuCategories as jest.Mock).mockResolvedValue({ success: true, data: [] });
    (api.listMenuItems as jest.Mock).mockResolvedValue({ success: true, data: [] });
    const screen = await renderScreen(<MenuPage />);
    try {
        expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        const toggle = screen.container.querySelector<HTMLButtonElement>('button[aria-label="Categorías"]');
        expect(toggle).not.toBeNull();
        expect(toggle!.getAttribute('aria-expanded')).toBe('false');
        await interact(() => toggle!.click());
        expect(toggle!.getAttribute('aria-expanded')).toBe('true');
        expect(screen.container.querySelector('input[placeholder="Nueva categoría..."]')).not.toBeNull();
        await interact(() => toggle!.click());
        expect(toggle!.getAttribute('aria-expanded')).toBe('false');
        expect(screen.container.querySelector('input[placeholder="Nueva categoría..."]')).toBeNull();
        expect(api.listMenuCategories).toHaveBeenCalledTimes(1);
        expect(api.listMenuItems).toHaveBeenCalledTimes(1);
    } finally { screen.unmount(); }
});
