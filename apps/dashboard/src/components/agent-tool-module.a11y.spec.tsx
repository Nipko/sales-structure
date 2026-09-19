import { useState } from 'react';
import { AGENT_CONFIG_TOOL_FAMILIES, type AgentToolConfigurationSummary } from '@parallext/shared';
import { renderScreen, interact, findAccessibilityViolations } from '@/test/a11y';
import { api } from '@/lib/api';
import { AgentToolConfigurationProvider } from '@/contexts/AgentToolConfigurationContext';
import { AgentToolModuleNotice, AgentToolNavigationStatus } from './AgentToolModuleNotice';
import { AGENT_CONFIGURATION_APPLIED_EVENT } from '@/lib/quality-health-events';

let mockTenant = 'tenant-a';
let mockManage = true;
let mockRole = 'tenant_admin';
let mockAuthTenant: string | null | undefined;
jest.mock('next/navigation', () => ({ usePathname: () => '/admin/appointments' }));
jest.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: mockTenant }) }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user', role: mockRole, tenantId: mockAuthTenant === undefined ? mockTenant : mockAuthTenant } }) }));
jest.mock('@/hooks/useRole', () => ({ useRole: () => ({ canAccess: (href: string) => href !== '/admin/agent' || mockManage }) }));
jest.mock('@/lib/api', () => ({ api: { getAgentToolConfigurationSummary: jest.fn(), getAgentReviewMode: jest.fn() } }));

function summary(activeEnabledAgents = 0, pausedEnabledAgents = 0): AgentToolConfigurationSummary {
  return { source: 'operational', totalAgents: 2, families: Object.fromEntries(AGENT_CONFIG_TOOL_FAMILIES.map(family =>
    [family, { activeEnabledAgents, pausedEnabledAgents, unknownAgents: 0 }])) as AgentToolConfigurationSummary['families'] };
}
function Harness() {
  const [version, setVersion] = useState(0);
  return <AgentToolConfigurationProvider>
    <button type="button" onClick={() => { mockTenant = 'tenant-b'; setVersion(version + 1); }}>Cambiar cuenta</button>
    <nav aria-label="Módulos"><a href="/admin/appointments" aria-describedby="appointments-tool-status">Citas<AgentToolNavigationStatus href="/admin/appointments" descriptionId="appointments-tool-status" /></a></nav>
    <AgentToolModuleNotice />
    <button type="button">Crear cita manual</button>
  </AgentToolConfigurationProvider>;
}
const ok = (data = summary()) => ({ success: true, data });

describe('manual module tool status', () => {
  beforeEach(() => { jest.clearAllMocks(); mockTenant = 'tenant-a'; mockManage = true; mockRole = 'tenant_admin'; mockAuthTenant = undefined; });
  it('reads the explicitly selected tenant for a super admin, not an implicit account', async () => {
    mockRole = 'super_admin'; mockAuthTenant = null;
    jest.mocked(api.getAgentToolConfigurationSummary).mockResolvedValue(ok());
    const screen = await renderScreen(<Harness />);
    try { expect(api.getAgentToolConfigurationSummary).toHaveBeenCalledWith('tenant-a'); }
    finally { screen.unmount(); }
  });
  it('does not fetch another tenant while a tenant session is changing', async () => {
    mockAuthTenant = 'tenant-b';
    const screen = await renderScreen(<Harness />);
    try {
      expect(api.getAgentToolConfigurationSummary).not.toHaveBeenCalled();
      expect(screen.container.querySelector('nav')?.textContent).toContain('IA por verificar');
    } finally { screen.unmount(); }
  });
  it('keeps manual navigation and actions while explaining that AI tools are disabled', async () => {
    jest.mocked(api.getAgentToolConfigurationSummary).mockResolvedValue(ok());
    const screen = await renderScreen(<Harness />);
    try {
      expect(api.getAgentToolConfigurationSummary).toHaveBeenCalledTimes(1);
      expect(screen.container.querySelector('nav')?.textContent).toContain('IA desactivada');
      expect(screen.container.querySelector('a[href="/admin/appointments"]')).not.toBeNull();
      const link = screen.container.querySelector('a[href="/admin/appointments"]')!;
      const description = screen.container.querySelector(`#${link.getAttribute('aria-describedby')}`)!;
      expect(description.getAttribute('aria-hidden')).toBe('true');
      expect(description.textContent).toBe('IA desactivada');
      expect(screen.container.textContent).toContain('Puedes seguir utilizándolo manualmente');
      // Until someone opens "Cómo funciona", the sentence true in both change modes.
      expect(screen.container.textContent).toContain('Las herramientas de cada agente se cambian en su editor.');
      expect(screen.container.textContent).not.toContain('borrador');
      const manual = Array.from(screen.container.querySelectorAll('button')).find(button => button.textContent === 'Crear cita manual')!;
      expect(manual.disabled).toBe(false);
      expect(await findAccessibilityViolations(screen.container)).toEqual([]);
    } finally { screen.unmount(); }
  });
  it('distinguishes paused agents from configured active agents and refreshes after publication', async () => {
    jest.mocked(api.getAgentToolConfigurationSummary).mockResolvedValueOnce(ok(summary(0, 1))).mockResolvedValueOnce(ok(summary(1)));
    const screen = await renderScreen(<Harness />);
    try {
      expect(screen.container.textContent).toContain('Solo agentes pausados');
      await interact(() => window.dispatchEvent(new CustomEvent(AGENT_CONFIGURATION_APPLIED_EVENT, { detail: { tenantId: 'other-tenant' } })));
      expect(api.getAgentToolConfigurationSummary).toHaveBeenCalledTimes(1);
      await interact(() => window.dispatchEvent(new CustomEvent(AGENT_CONFIGURATION_APPLIED_EVENT, { detail: { tenantId: 'tenant-a' } })));
      expect(screen.container.querySelector('nav')?.textContent).toContain('IA configurada');
      expect(screen.container.textContent).toContain('Esto no confirma que esté lista para ejecutarse');
    } finally { screen.unmount(); }
  });
  it('treats a failed refresh as unknown, never as off or last-known active', async () => {
    jest.mocked(api.getAgentToolConfigurationSummary).mockResolvedValueOnce(ok(summary(1))).mockRejectedValueOnce(new Error('offline'));
    const screen = await renderScreen(<Harness />);
    try {
      await interact(() => Array.from(screen.container.querySelectorAll('button')).find(button => button.textContent === 'Actualizar estado')!.click());
      expect(screen.container.querySelector('nav')?.textContent).toContain('IA por verificar');
      expect(screen.container.querySelector('nav')?.textContent).not.toContain('IA configurada');
      expect(screen.container.textContent).toContain('Esto no significa que esté desactivada');
    } finally { screen.unmount(); }
  });
  it('never displays a late response from a previous tenant', async () => {
    let resolveOld!: (value: ReturnType<typeof ok>) => void;
    jest.mocked(api.getAgentToolConfigurationSummary)
      .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce(ok());
    const screen = await renderScreen(<Harness />);
    try {
      await interact(() => Array.from(screen.container.querySelectorAll('button')).find(button => button.textContent === 'Cambiar cuenta')!.click());
      expect(api.getAgentToolConfigurationSummary).toHaveBeenLastCalledWith('tenant-b');
      await interact(() => resolveOld(ok(summary(1))));
      expect(screen.container.querySelector('nav')?.textContent).toContain('IA desactivada');
      expect(screen.container.querySelector('nav')?.textContent).not.toContain('IA configurada');
    } finally { screen.unmount(); }
  });
  describe("how a change reaches the AI, in the tenant's change mode", () => {
    async function openScope(screen: Awaited<ReturnType<typeof renderScreen>>) {
      const details = screen.container.querySelector('aside details') as HTMLDetailsElement;
      await interact(() => { details.open = true; details.dispatchEvent(new Event('toggle')); });
      await interact(() => {});
      return details;
    }

    it('reads the mode only when "Cómo funciona" is opened, and says a save applies at once in immediate mode', async () => {
      jest.mocked(api.getAgentToolConfigurationSummary).mockResolvedValue(ok());
      jest.mocked(api.getAgentReviewMode).mockResolvedValue({ success: true, data: { mode: 'immediate' } } as any);
      const screen = await renderScreen(<Harness />);
      try {
        expect(api.getAgentReviewMode).not.toHaveBeenCalled();
        const details = await openScope(screen);
        expect(api.getAgentReviewMode).toHaveBeenCalledWith('tenant-a');
        expect(details.textContent).toContain('el cambio se aplica de inmediato');
        expect(details.textContent).not.toMatch(/borrador|publicaci/);
        expect(await findAccessibilityViolations(screen.container)).toEqual([]);
      } finally { screen.unmount(); }
    });

    it('keeps the draft and publication sentence for a tenant in reviewed mode', async () => {
      jest.mocked(api.getAgentToolConfigurationSummary).mockResolvedValue(ok());
      jest.mocked(api.getAgentReviewMode).mockResolvedValue({ success: true, data: { mode: 'reviewed' } } as any);
      const screen = await renderScreen(<Harness />);
      try {
        const details = await openScope(screen);
        expect(details.textContent).toContain('guarda el borrador y completa su publicación');
      } finally { screen.unmount(); }
    });

    it('says neither when the mode cannot be read, and never asks for a role that cannot read it', async () => {
      jest.mocked(api.getAgentToolConfigurationSummary).mockResolvedValue(ok());
      jest.mocked(api.getAgentReviewMode).mockResolvedValue({ success: false } as any);
      const failed = await renderScreen(<Harness />);
      try {
        const details = await openScope(failed);
        expect(details.textContent).toContain('Las herramientas de cada agente se cambian en su editor.');
        expect(details.textContent).not.toMatch(/borrador|de inmediato/);
      } finally { failed.unmount(); }
      jest.mocked(api.getAgentReviewMode).mockClear();
      mockManage = false;
      const supervisor = await renderScreen(<Harness />);
      try {
        await openScope(supervisor);
        expect(api.getAgentReviewMode).not.toHaveBeenCalled();
      } finally { supervisor.unmount(); }
    });
  });

  it('does not offer agent management to a role that cannot access it', async () => {
    mockManage = false;
    jest.mocked(api.getAgentToolConfigurationSummary).mockResolvedValue(ok());
    const screen = await renderScreen(<Harness />);
    try { expect(screen.container.querySelector('a[href="/admin/agent"]')).toBeNull(); }
    finally { screen.unmount(); }
  });
});
