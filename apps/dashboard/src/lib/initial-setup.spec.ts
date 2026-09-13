import type { AgentSetupTask } from '@parallext/shared';
import { essentialSetupItemsFromAssessment } from './initial-setup';

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
      { key: 'channel', href: '/admin/channels', done: false, tourId: 'connect_channel', channelType: undefined },
      { key: 'knowledge', href: '/admin/knowledge', done: false, tourId: 'knowledge_base', channelType: undefined, verification: 'unavailable' },
      { key: 'catalog', href: '/admin/catalog', done: true, tourId: null, channelType: undefined },
    ]);
  });
});
