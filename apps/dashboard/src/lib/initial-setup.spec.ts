import type { AgentSetupTask } from '@parallext/shared';
import es from '../../messages/es.json';
import en from '../../messages/en.json';
import pt from '../../messages/pt.json';
import fr from '../../messages/fr.json';
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
      task({ key: 'business', status: 'unknown', state: 'unknown', href: '/admin/settings/business-info', tourId: 'business_identity' }),
      task({ key: 'agent', status: 'not_applicable', state: null, href: '/admin/agent', tourId: null }),
      task({ key: 'team', status: 'warning', state: 'degraded', href: '/admin/users', tourId: 'human_handoff_route' }),
    ], href => href !== '/admin/users');

    expect(result).toEqual([
      { key: 'channel', href: '/admin/channels', done: false, labelKey: 'items.channel', tourId: 'connect_channel', channelType: undefined },
      { key: 'business', href: '/admin/settings/business-info', done: false, labelKey: 'items.business', tourId: 'business_identity', channelType: undefined, verification: 'unavailable' },
      { key: 'agent', href: '/admin/agent', done: true, labelKey: 'items.agent', notApplicable: true, tourId: null, channelType: undefined },
    ]);
  });

  // Owner decision D2/D8 (sep-2026): the Home card shows the four essentials
  // only. Knowledge, hours, appointments, catalogue, mission and tests make the
  // agent better and live in Agent health; nine equal boxes made a new owner
  // conclude she had to "work on all of these" before anything would answer.
  it('leaves polish tasks to the health panel, however unfinished they are', () => {
    const result = essentialSetupItemsFromAssessment([
      task({ key: 'knowledge', status: 'fail', href: '/admin/knowledge', tourId: 'knowledge_base' }),
      task({ key: 'catalog', status: 'fail', href: '/admin/catalog', tourId: null }),
      task({ key: 'mission', status: 'fail', href: '/admin/agent', tourId: null }),
      task({ key: 'tests', status: 'fail', href: '/admin/agent', tourId: null }),
      task({ key: 'hours', status: 'fail', href: '/admin/settings/business-hours', tourId: null }),
      task({ key: 'appointments', status: 'fail', href: '/admin/appointments', tourId: null }),
      task({ key: 'agent', status: 'pass', state: 'operating', href: '/admin/agent', tourId: null }),
    ], () => true);
    expect(result.map(item => item.key)).toEqual(['agent']);
  });

  it.each([
    ['operational_channel_scope', {}, 'channelActions.unsupported'],
    ['channel_assignment', {}, 'channelActions.assign'],
    ['channel_coverage', {}, 'channelActions.coverage'],
    ['channel_connection', { staleBindings: 1 }, 'channelActions.reassign'],
    ['channel_connection', { hasCredentialIssue: true }, 'channelActions.credentials'],
    ['channel_connection', {}, 'channelActions.connect'],
    ['channel_unanswered', { unansweredChannels: 'whatsapp' }, 'channelActions.unanswered'],
    ['whatsapp_delivery', { reason: 'timezone_missing' }, 'channelActions.whatsappDelivery'],
    ['whatsapp_delivery', { reason: 'multiple', reasons: 'funding_absent,timezone_missing' }, 'channelActions.whatsappDelivery'],
    ['whatsapp_delivery', { reason: 'funding_absent' }, 'channelActions.whatsappPaymentMethod'],
  ])('explains %s using the assessed reason', (code, evidence, label) => {
    const pending = { code, status: 'fail', evidence, href: '/admin/agent/agent?focus=channels' } as any;
    const assessed = task({ pendingCheckCode: code, checks: [pending], href: pending.href });
    expect(setupTaskLabelKey(assessed)).toBe(label);
    expect(essentialSetupItemsFromAssessment([assessed], () => true)[0]).toMatchObject({ labelKey: label, pendingCheck: pending, href: pending.href });
  });

  it('has every channel label in the four languages, none of them the generic fallback', () => {
    const labels = [
      'channelActions.unanswered', 'channelActions.whatsappDelivery', 'channelActions.whatsappPaymentMethod',
    ];
    for (const locale of [es, en, pt, fr] as any[]) {
      for (const label of labels) {
        const [group, key] = label.split('.');
        const text = locale.qualityHealth.setup[group]?.[key];
        expect({ label, text: typeof text }).toEqual({ label, text: 'string' });
        expect(text).not.toBe(locale.qualityHealth.setup.items.channel);
      }
    }
  });

  // `whatsapp_delivery` is part of the "your channel works" essential. Before
  // 1-oct-2026 a number with no payment method in Meta still delivers: the
  // check is a `warning`, and the card asks for the payment method without
  // presenting the channel as unreadable or broken.
  it('lists a payment-method warning as something to do, never as a failure or an unreadable channel', () => {
    const pending = { code: 'whatsapp_delivery', status: 'warning', evidence: { reason: 'funding_absent' }, href: '/admin/channels/whatsapp' } as any;
    const [item] = essentialSetupItemsFromAssessment([
      task({ status: 'warning', state: 'degraded', pendingCheckCode: 'whatsapp_delivery', checks: [pending], href: pending.href, tourId: null }),
    ], () => true);
    expect(item).toMatchObject({ key: 'channel', done: false, labelKey: 'channelActions.whatsappPaymentMethod', href: '/admin/channels/whatsapp', tourId: null });
    expect(item.verification).toBeUndefined();
    expect(item.notApplicable).toBeUndefined();
  });

  it('keeps a channel whose delivery checks do not apply done and ready', () => {
    const checks = [
      { code: 'channel_connection', status: 'pass', evidence: {} },
      { code: 'channel_unanswered', status: 'not_applicable', evidence: {} },
      { code: 'whatsapp_delivery', status: 'not_applicable', evidence: {} },
    ] as any;
    const assessed = task({ status: 'pass', state: 'prepared', checks });
    expect(setupTaskLabelKey(assessed)).toBe('channelActions.ready');
    expect(essentialSetupItemsFromAssessment([assessed], () => true)[0]).toMatchObject({ done: true, labelKey: 'channelActions.ready' });
  });
});
