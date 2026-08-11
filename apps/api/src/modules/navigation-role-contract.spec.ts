import 'reflect-metadata';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { AlertsController } from './analytics/alerts.controller';
import { DashboardAnalyticsController } from './analytics/dashboard-analytics.controller';
import { DripSequenceController } from './automation/drip-sequence.controller';
import { AutomationTemplatesController } from './automation/templates/automation-templates.controller';
import { FaqsController } from './faqs/faqs.controller';
import { KbHealthController } from './kb-health/kb-health.controller';
import { AnalyticsController } from './analytics/analytics.controller';
import { AgentAnalyticsController } from './analytics/agent-analytics.controller';
import { OrdersController } from './orders/orders.controller';
import { OffersController } from './offers/offers.controller';
import { KnowledgeController } from './knowledge/knowledge.controller';

type ControllerPrototype = Record<string, (...args: never[]) => unknown>;

function rolesFor(controller: { prototype: object }, method: string): string[] {
  const handler = (controller.prototype as ControllerPrototype)[method];
  return Reflect.getMetadata(ROLES_KEY, handler) ?? [];
}

describe('dashboard navigation role contract', () => {
  it('keeps FAQs readable by agents and editable by supervisors', () => {
    for (const method of ['list', 'get']) {
      expect(rolesFor(FaqsController, method)).toEqual(expect.arrayContaining([
        'tenant_agent',
        'tenant_supervisor',
      ]));
    }

    for (const method of ['create', 'update', 'delete']) {
      const roles = rolesFor(FaqsController, method);
      expect(roles).toContain('tenant_supervisor');
      expect(roles).not.toContain('tenant_agent');
    }
  });

  it('keeps KB health operations aligned with supervisor knowledge access', () => {
    for (const method of ['getIssues', 'scan', 'updateIssue']) {
      const roles = rolesFor(KbHealthController, method);
      expect(roles).toContain('tenant_supervisor');
      expect(roles).not.toContain('tenant_agent');
    }
  });

  it('allows supervisors to complete every drip-sequence workflow', () => {
    const methods = [
      'listSequences',
      'getSequence',
      'createSequence',
      'updateSequence',
      'deleteSequence',
      'toggleSequence',
      'enrollContact',
      'enrollSegment',
      'unenrollContact',
      'getEnrollments',
    ];

    for (const method of methods) {
      expect(rolesFor(DripSequenceController, method)).toContain('tenant_supervisor');
    }
  });

  it('allows supervisors to install automation templates', () => {
    expect(rolesFor(AutomationTemplatesController, 'installTemplate'))
      .toContain('tenant_supervisor');
  });

  it('keeps alerts and report mutations aligned with supervisor settings access', () => {
    const methods = [
      'createAlert',
      'updateAlert',
      'deleteAlert',
      'upsertReportConfig',
      'createSavedReport',
      'updateSavedReport',
      'deleteSavedReport',
    ];

    for (const method of methods) {
      expect(rolesFor(AlertsController, method)).toContain('tenant_supervisor');
    }
  });

  it('keeps every tenant analytics tab available to supervisors', () => {
    const dashboardRoles = Reflect.getMetadata(ROLES_KEY, DashboardAnalyticsController) ?? [];
    const legacyRoles = Reflect.getMetadata(ROLES_KEY, AnalyticsController) ?? [];
    const agentAnalyticsRoles = Reflect.getMetadata(ROLES_KEY, AgentAnalyticsController) ?? [];

    for (const roles of [dashboardRoles, legacyRoles, agentAnalyticsRoles]) {
      expect(roles).toContain('tenant_supervisor');
      expect(roles).not.toContain('tenant_agent');
    }

    expect(rolesFor(AgentAnalyticsController, 'submitCSAT')).toContain('tenant_agent');
  });

  it('keeps order operations available to agents without opening the controller to viewers', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, OrdersController) ?? [];
    expect(roles).toEqual(expect.arrayContaining([
      'tenant_admin',
      'tenant_supervisor',
      'tenant_agent',
    ]));
  });

  it('keeps the offer catalogue fully manageable by supervisors', () => {
    for (const method of ['list', 'get', 'create', 'update', 'delete']) {
      expect(rolesFor(OffersController, method)).toContain('tenant_supervisor');
    }
  });

  it('keeps tenant-wide knowledge analytics out of the agent role', () => {
    for (const method of ['getUsageStats', 'getQualityScores', 'getAnalytics', 'getGapReport']) {
      const roles = rolesFor(KnowledgeController, method);
      expect(roles).toContain('tenant_supervisor');
      expect(roles).not.toContain('tenant_agent');
    }
  });
});
