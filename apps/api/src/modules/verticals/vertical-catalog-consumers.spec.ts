import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('canonical vertical manifest dashboard consumers', () => {
    const dashboardSrc = resolve(__dirname, '../../../../dashboard/src');
    const readDashboardSource = (relativePath: string) => (
        readFileSync(resolve(dashboardSrc, relativePath), 'utf8')
    );

    it('keeps the administrative tenant flow on the API manifest', () => {
        const page = readDashboardSource('app/admin/tenants/page.tsx');
        const modal = readDashboardSource('app/admin/tenants/_components/CreateTenantModal.tsx');

        expect(page).toContain('api.getVerticalDefinitions()');
        expect(page).toContain('isCanonicalVerticalCatalog(verticalsResult.data)');
        expect(modal).toContain('Object.keys(verticalDefinitions)');
    });

    it('keeps self-service onboarding on the same API manifest without a subtype copy', () => {
        const onboarding = readDashboardSource('app/onboarding/page.tsx');

        expect(onboarding).toContain('api.getVerticalDefinitions()');
        expect(onboarding).toContain('isCanonicalVerticalCatalog(result.data)');
        expect(onboarding).toContain('Object.keys(verticalDefinitions)');
        expect(onboarding).not.toMatch(/\bconst\s+SUB_TYPES\b/);
        expect(onboarding).not.toMatch(/\bconst\s+INDUSTRY_KEYS\b/);
    });

    it('fails both selectors closed unless the complete 18-vertical catalog arrives', () => {
        const catalogBoundary = readDashboardSource('lib/vertical-catalog.ts');

        expect(catalogBoundary).toContain('CANONICAL_VERTICAL_COUNT = 18');
        expect(catalogBoundary).toContain('entries.length !== CANONICAL_VERTICAL_COUNT');
    });
});
