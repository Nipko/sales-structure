import type { AgentSetupTask } from '@parallext/shared';
import { essentialSetupItemsFromAssessment, setupTaskLabelKey } from './initial-setup';

const task = (overrides: Partial<AgentSetupTask>): AgentSetupTask => ({
  key: 'channel',
  status: 'fail',
  state: 'degraded',
  checks: [],
  href: '/admin/channels',
  tourId: 'connect_channel',
  dependsOn: [],
  ...overrides,
});

describe('essential setup projects the server assessment', () => {
  it('preserves unknown and not-applicable semantics and applies route access', () => {
    const result = essentialSetupItemsFromAssessment([
      task({ key: 'channel', status: 'fail' }),
      task({ key: 'knowledge', status: 'unknown', state: 'unknown', href: '/admin/knowledge', tourId: 'knowledge_base' }),
      task({ key: 'catalog', status: 'not_applicable', state: null, href: '/admin/catalog', tourId: null }),
      task({ key: 'team', status: 'warning', state: 'degraded', href: '/admin/users', tourId: 'human_handoff_route' }),
    ], href => href !== '/admin/users');

    expect(result).toEqual([
      { key: 'channel', href: '/admin/channels', done: false, labelKey: 'items.channel', tourId: 'connect_channel', channelType: undefined },
      { key: 'knowledge', href: '/admin/knowledge', done: false, labelKey: 'items.knowledge', tourId: 'knowledge_base', channelType: undefined, verification: 'unavailable' },
      { key: 'catalog', href: '/admin/catalog', done: true, labelKey: 'items.catalog', notApplicable: true, tourId: null, channelType: undefined },
    ]);
  });

  it.each([
    ['operational_channel_scope', {}, 'channelActions.unsupported'],
    ['channel_assignment', {}, 'channelActions.assign'],
    ['channel_coverage', {}, 'channelActions.coverage'],
    ['channel_connection', { staleBindings: 1 }, 'channelActions.reassign'],
    ['channel_connection', { hasCredentialIssue: true }, 'channelActions.credentials'],
    ['channel_connection', {}, 'channelActions.connect'],
  ])('explains %s using the assessed reason', (code, evidence, label) => {
    const pending = { code, status: 'fail', evidence, href: '/admin/agent/agent?focus=channels' } as any;
    const assessed = task({ pendingCheckCode: code, checks: [pending], href: pending.href });
    expect(setupTaskLabelKey(assessed)).toBe(label);
    expect(essentialSetupItemsFromAssessment([assessed], () => true)[0]).toMatchObject({ labelKey: label, pendingCheck: pending, href: pending.href });
  });
});
