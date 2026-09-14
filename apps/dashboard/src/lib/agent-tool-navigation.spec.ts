import { AGENT_CONFIG_TOOL_FAMILIES, type AgentToolConfigurationSummary } from '@parallext/shared';
import * as fs from 'fs';
import * as path from 'path';
import { AGENT_TOOL_MODULE_ROUTES, agentToolFamiliesForRoute, agentToolModuleState, agentToolNavigationState } from './agent-tool-navigation';
import { canAccessDashboardNavigationPath } from './navigation-access';
import { resolveNavigationRoute } from './navigation-contract';

const snapshot = (counts = {}) => ({ source: 'operational', totalAgents: 3,
  families: Object.fromEntries(AGENT_CONFIG_TOOL_FAMILIES.map(family => [family,
    { activeEnabledAgents: 0, pausedEnabledAgents: 0, unknownAgents: 0, ...counts }])) } as AgentToolConfigurationSummary);

describe('manual modules and AI settings remain independent', () => {
  it.each([
    [{}, 'disabled'], [{ activeEnabledAgents: 1 }, 'configured'], [{ pausedEnabledAgents: 1 }, 'paused'],
    [{ unknownAgents: 1 }, 'unknown'], [{ activeEnabledAgents: 1, unknownAgents: 1 }, 'unknown'],
  ])('describes configuration without claiming readiness: %j', (counts, state) => {
    expect(agentToolNavigationState(snapshot(counts), 'appointments')).toBe(state);
  });
  it('distinguishes no agents from an unreadable or malformed snapshot', () => {
    expect(agentToolNavigationState({ ...snapshot(), totalAgents: 0 }, 'appointments')).toBe('no_agents');
    for (const summary of [null, {} as any, { ...snapshot(), source: 'draft' } as any,
      snapshot({ activeEnabledAgents: -1 }), snapshot({ pausedEnabledAgents: undefined }), snapshot({ activeEnabledAgents: 3, pausedEnabledAgents: 1 })]) {
      expect(agentToolNavigationState(summary, 'appointments')).toBe('unknown');
    }
  });
  it('does not mark a multi-tool module disabled when another related family is configured', () => {
    const summary = snapshot(); summary.families.ecommerce.activeEnabledAgents = 1;
    expect(agentToolModuleState(summary, agentToolFamiliesForRoute('/admin/orders'))).toBe('configured');
    expect(agentToolModuleState(summary, agentToolFamiliesForRoute('/admin/appointments'))).toBe('disabled');
  });
  it('resolves the most specific route and never matches a similar prefix', () => {
    expect(agentToolFamiliesForRoute('/admin/knowledge/faqs?filter=all')).toEqual(['faqs']);
    expect(agentToolFamiliesForRoute('/admin/appointments/')).toEqual(['appointments']);
    expect(agentToolFamiliesForRoute('/admin/appointments-other')).toEqual([]);
    expect(agentToolFamiliesForRoute('/admin/settings/billing')).toEqual([]);
    for (const [route, families] of AGENT_TOOL_MODULE_ROUTES) {
      expect(resolveNavigationRoute(route)).not.toBeNull();
      expect(families.every(family => AGENT_CONFIG_TOOL_FAMILIES.includes(family))).toBe(true);
    }
  });
  it('never grants another vertical or revokes manual operations when tools are disabled', () => {
    const vertical = { industry: 'salud', effectiveCapabilities: ['appointment_booking'] };
    expect(agentToolNavigationState(snapshot(), 'appointments')).toBe('disabled');
    expect(canAccessDashboardNavigationPath('/admin/appointments', 'tenant_admin', false, vertical)).toBe(true);
    expect(canAccessDashboardNavigationPath('/admin/courses', 'tenant_admin', false, vertical)).toBe(false);
  });
  it.each(['es', 'en', 'pt', 'fr'])('includes every state explanation in %s', locale => {
    const copy = JSON.parse(fs.readFileSync(path.join(__dirname, '../../messages', `${locale}.json`), 'utf8')).agentToolNavigation;
    for (const state of ['loading', 'unknown', 'no_agents', 'disabled', 'paused', 'configured']) {
      expect(typeof copy.status[state]).toBe('string'); expect(typeof copy.description[state]).toBe('string');
    }
    for (const key of ['title', 'manage', 'refresh', 'scopeTitle', 'manualScope', 'runtimeScope', 'draftScope', 'editorScope']) expect(typeof copy[key]).toBe('string');
  });
});
