import { act } from 'react';
import { renderScreen, findAccessibilityViolations } from '@/test/a11y';
import { api } from '@/lib/api';
import { AgentReadinessBanner } from './AgentReadinessBanner';
import InitialSetupCard from './InitialSetupCard';

jest.mock('@/lib/api', () => ({ api: { getAgentQualityOverview: jest.fn(), getAgentAssessment: jest.fn() } }));
jest.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 'tenant' }) }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ verticalConfig: undefined }) }));
jest.mock('@/hooks/useRole', () => ({ useRole: () => ({ role: 'tenant_admin', impersonating: false }) }));

function overview(status: 'unknown' | 'fail') {
  return { status: 'configuration_incomplete', preparation: { criticalBlockers: ['rag_knowledge'],
    dimensions: [{ checks: [{ code: 'rag_knowledge', status, href: '/admin/knowledge', critical: true }] }] },
    production: { sampleSize: 0, minimumSample: 20 }, tested: { stale: false } };
}

describe('readiness guidance reflects the diagnosis', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders an unreadable requirement as unverified and retries the lookup', async () => {
    jest.mocked(api.getAgentQualityOverview).mockResolvedValue({ success: true, data: overview('unknown') } as any);
    const screen = await renderScreen(<AgentReadinessBanner tenantId="tenant" agentId="agent" />);
    try {
      expect(screen.container.textContent).toContain('Verificación de configuración pendiente');
      expect(screen.container.textContent).toContain('No pudimos verificar 1 requisito');
      expect(screen.container.textContent).not.toContain('Falta configurar');
      expect(screen.container.textContent).not.toContain('bloqueo crítico');
      expect(screen.container.textContent).toContain('versión operativa');
      const retry = Array.from(screen.container.querySelectorAll('button')).find(button => button.textContent?.includes('Reintentar'))!;
      await act(async () => { retry.click(); });
      expect(api.getAgentQualityOverview).toHaveBeenCalledTimes(2);
      expect(await findAccessibilityViolations(screen.container)).toEqual([]);
    } finally { screen.unmount(); }
  });

  it('still names a verified missing setting as a blocker', async () => {
    jest.mocked(api.getAgentQualityOverview).mockResolvedValue({ success: true, data: overview('fail') } as any);
    const screen = await renderScreen(<AgentReadinessBanner tenantId="tenant" agentId="agent" />);
    try {
      expect(screen.container.textContent).toContain('Falta configurar');
      expect(screen.container.textContent).toContain('1 bloqueo crítico');
      expect(screen.container.querySelector('a[href="/admin/knowledge"]')).not.toBeNull();
    } finally { screen.unmount(); }
  });

  it('shows the assignment repair instead of requesting another connection', async () => {
    jest.mocked(api.getAgentAssessment).mockResolvedValue({ success: true, data: { agent: { id: 'agent' }, tasks: [
      { key: 'channel', status: 'fail', pendingCheckCode: 'operational_channel_scope', href: '/admin/agent/agent?focus=channels',
        tourId: 'assign_agent_channel', checks: [{ code: 'operational_channel_scope', status: 'fail', evidence: { unsupportedAssignments: 1 } }] },
      { key: 'catalog', status: 'not_applicable', href: '/admin/inventory', tourId: null, checks: [] },
    ] } } as any);
    const screen = await renderScreen(<InitialSetupCard />);
    try {
      expect(screen.container.textContent).toContain('Revisar asignaciones no compatibles');
      expect(screen.container.textContent).not.toContain('Conectar y asignar un canal');
      expect(screen.container.querySelector('a[href="/admin/agent/agent?focus=channels"]')).not.toBeNull();
      expect(await findAccessibilityViolations(screen.container)).toEqual([]);
    } finally { screen.unmount(); }
  });
});
