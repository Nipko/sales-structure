import type { AgentToolConfigurationSummary, AgentToolFamily } from '@parallext/shared';

/** Descriptive ownership only. This map must NEVER grant/hide routes or replace
 * role, plan, subtype, tool subpermission or execution-authority checks. */
export const AGENT_TOOL_MODULE_ROUTES: ReadonlyArray<readonly [string, readonly AgentToolFamily[]]> = [
  ['/admin/appointments', ['appointments']],
  ['/admin/knowledge/faqs', ['faqs']], ['/admin/knowledge', ['knowledge']],
  ['/admin/settings/policies', ['policies']], ['/admin/settings/integrations/payments', ['payments']],
  ['/admin/catalog/offers', ['offers']], ['/admin/catalog/courses', ['education']], ['/admin/orders', ['orders', 'ecommerce']],
  ['/admin/inventory', ['catalog', 'ecommerce']], ['/admin/catalog', ['catalog', 'ecommerce']],
  ['/admin/contacts', ['crm']], ['/admin/pipeline', ['crm']], ['/admin/funnel', ['crm']],
  ['/admin/properties', ['properties']], ['/admin/stays', ['properties']],
  ['/admin/tours', ['tours']], ['/admin/tour-bookings', ['tours']],
  ['/admin/treatment-plans', ['treatments']], ['/admin/listings', ['realEstate']],
  ['/admin/vehicles', ['vehicles', 'vehicleRentals']], ['/admin/pets', ['pets', 'petServices', 'petBoarding']],
  ['/admin/resource-rentals', ['vehicleRentals', 'petBoarding']],
  ['/admin/menu', ['restaurants']], ['/admin/food-orders', ['restaurants']],
  ['/admin/memberships', ['gyms']], ['/admin/classes', ['gyms']], ['/admin/courses', ['education']],
  ['/admin/insurance', ['insurance']], ['/admin/service-requests', ['homeServices']],
  ['/admin/photo-sessions', ['photography']], ['/admin/cases', ['professionalServices']],
  ['/admin/repair-orders', ['repairOrders']],
];

export function agentToolFamiliesForRoute(href: string): readonly AgentToolFamily[] {
  const path = href.split(/[?#]/, 1)[0].replace(/\/+$/, '');
  return [...AGENT_TOOL_MODULE_ROUTES].sort((a, b) => b[0].length - a[0].length)
    .find(([route]) => path === route || path.startsWith(`${route}/`))?.[1] ?? [];
}

export type AgentToolNavigationState = 'unknown' | 'no_agents' | 'disabled' | 'paused' | 'configured';
export function agentToolNavigationState(summary: AgentToolConfigurationSummary | null, family: AgentToolFamily): AgentToolNavigationState {
  const counts = summary?.families?.[family];
  if (summary?.source !== 'operational' || !counts || !Number.isInteger(summary.totalAgents) || summary.totalAgents < 0
    || ![counts.activeEnabledAgents, counts.pausedEnabledAgents, counts.unknownAgents]
      .every(value => Number.isInteger(value) && value >= 0 && value <= summary.totalAgents)
    || counts.activeEnabledAgents + counts.pausedEnabledAgents + counts.unknownAgents > summary.totalAgents
    || counts.unknownAgents > 0) return 'unknown';
  if (summary.totalAgents === 0) return 'no_agents';
  if (counts.activeEnabledAgents > 0) return 'configured';
  if (counts.pausedEnabledAgents > 0) return 'paused';
  return 'disabled';
}

export function agentToolModuleState(summary: AgentToolConfigurationSummary | null, families: readonly AgentToolFamily[]): AgentToolNavigationState {
  const states = families.map(family => agentToolNavigationState(summary, family));
  if (!states.length || states.includes('unknown')) return 'unknown';
  if (states.includes('configured')) return 'configured';
  if (states.includes('paused')) return 'paused';
  if (states.every(state => state === 'no_agents')) return 'no_agents';
  return 'disabled';
}
