import { renderScreen, findAccessibilityViolations } from '@/test/a11y';
import { api } from '@/lib/api';
import { AgentReadinessBanner } from './AgentReadinessBanner';

/**
 * Where the readiness banner sends an owner about example prices.
 *
 * The check's own `href` always wins: the API already knows whether the prices
 * live in Citas, in the service catalogue or — for a gym whose only pending
 * prices are membership plans — in Membresías. The banner's fallback used to be
 * a fixed /admin/appointments, which for that gym is a list with nothing
 * pending; without an `href` it now reads the same evidence the API does.
 */

jest.mock('@/lib/api', () => ({ api: { getAgentQualityOverview: jest.fn() } }));

function overview(check: Record<string, unknown>) {
  return {
    status: 'configuration_incomplete',
    preparation: {
      criticalBlockers: ['fix_services_example_price'],
      dimensions: [{ checks: [{ code: 'services_example_price', status: 'warning', critical: false, ...check }] }],
    },
    production: { sampleSize: 0, minimumSample: 20 },
    tested: { stale: false },
  };
}

async function linkFor(check: Record<string, unknown>) {
  jest.mocked(api.getAgentQualityOverview).mockResolvedValue({ success: true, data: overview(check) } as any);
  const screen = await renderScreen(<AgentReadinessBanner tenantId="tenant" agentId="agent" />);
  // The panel's own label, so a rename of the check ("Precios sin confirmar",
  // sep-2026) moves this spec with it instead of breaking it.
  const label: string = require('../../messages/es.json').agentQuality.checks.services_example_price;
  const link = Array.from(screen.container.querySelectorAll('a'))
    .find(anchor => anchor.textContent?.includes(label));
  return { screen, href: link?.getAttribute('href') ?? null };
}

describe('the readiness banner and example prices', () => {
  beforeEach(() => jest.clearAllMocks());

  it("follows the check's href", async () => {
    const { screen, href } = await linkFor({ href: '/admin/service-catalog', evidence: { examplePriceServices: 2, examplePricePlans: 0 } });
    try {
      expect(href).toBe('/admin/service-catalog');
      expect(await findAccessibilityViolations(screen.container)).toEqual([]);
    } finally { screen.unmount(); }
  });

  it('without an href, sends a gym with only plans pending to Membresías', async () => {
    const { screen, href } = await linkFor({ evidence: { examplePriceServices: 0, examplePricePlans: 3 } });
    try { expect(href).toBe('/admin/memberships'); } finally { screen.unmount(); }
  });

  it('without an href, keeps services on Citas', async () => {
    const { screen, href } = await linkFor({ evidence: { examplePriceServices: 1, examplePricePlans: 2 } });
    try { expect(href).toBe('/admin/appointments?tab=services'); } finally { screen.unmount(); }
  });

  // The check also counts rows with NO amount (`noPriceServices`,
  // `noPricePlans`), and the API sends a gym to Membresías when only plans are
  // pending of either kind. Reading only the example halves sent a gym whose
  // plans had no price to Citas, where nothing was pending.
  it('without an href, sends a gym whose only pending plans have no price to Membresías', async () => {
    const { screen, href } = await linkFor({
      evidence: { examplePriceServices: 0, examplePricePlans: 0, noPriceServices: 0, noPricePlans: 2 },
    });
    try {
      expect(href).toBe('/admin/memberships');
      expect(await findAccessibilityViolations(screen.container)).toEqual([]);
    } finally { screen.unmount(); }
  });

  it('without an href, keeps a mix with any service pending on Citas', async () => {
    const { screen, href } = await linkFor({
      evidence: { examplePriceServices: 0, examplePricePlans: 3, noPriceServices: 1, noPricePlans: 0 },
    });
    try { expect(href).toBe('/admin/appointments?tab=services'); } finally { screen.unmount(); }
  });

  it('follows the href the check sends for a no-price-only mix', async () => {
    const { screen, href } = await linkFor({
      href: '/admin/service-catalog',
      evidence: { examplePriceServices: 0, examplePricePlans: 0, noPriceServices: 2, noPricePlans: 0 },
    });
    try { expect(href).toBe('/admin/service-catalog'); } finally { screen.unmount(); }
  });
});
