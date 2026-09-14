import { agentChannelAssignmentIssues, channelOverviewIsAuthoritative, normalizeAgentChannelAssignments } from './agent-channel-assignment';

const supported = ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget'];

describe('agent channel assignment normalization', () => {
  it.each([true, false])('retains unsupported assignments for explicit review (inventory available=%s)', overviewAvailable => {
    const input = { accounts: [{ channelType: 'whatsapp', accountId: 'current' }],
      channels: ['whatsapp', 'email', 'web_chat'], bindings: ['sms:old'], overviewAvailable, supportedTypes: supported };
    const normalized = normalizeAgentChannelAssignments(input);
    expect(normalized.channels).toEqual(expect.arrayContaining(input.channels));
    expect(normalized.bindings).toEqual(['sms:old']);
    expect(agentChannelAssignmentIssues({ ...input, ...normalized })).toEqual([
      { kind: 'channel', value: 'email', reason: 'unsupported' },
      { kind: 'channel', value: 'web_chat', reason: 'unsupported' },
      { kind: 'binding', value: 'sms:old', reason: 'unsupported' },
    ]);
  });

  it.each([[], [{ channelType: 'whatsapp', accountId: 'new' }],
    [{ channelType: 'whatsapp', accountId: 'new' }, { channelType: 'whatsapp', accountId: 'second' }]].map(accounts => ({ accounts })))(
    'never replaces a stale exact binding with the current account (%j)', ({ accounts }) => {
      const input = { accounts, channels: [], bindings: ['whatsapp:old'], overviewAvailable: true, supportedTypes: supported };
      const normalized = normalizeAgentChannelAssignments(input);
      expect(normalized).toEqual({ channels: [], bindings: ['whatsapp:old'] });
      expect(agentChannelAssignmentIssues({ ...input, ...normalized })).toEqual([
        { kind: 'binding', value: 'whatsapp:old', reason: 'stale' },
      ]);
    });

  it('does not declare an account stale when the inventory could not be read', () => {
    expect(agentChannelAssignmentIssues({ accounts: [], channels: ['whatsapp'], bindings: ['instagram:old'],
      overviewAvailable: false, supportedTypes: supported })).toEqual([]);
  });

  it('rejects a syntactically valid but partially degraded overview', () => {
    expect(channelOverviewIsAuthoritative({ data: [], degraded: ['web_widget'] })).toBe(false);
    expect(channelOverviewIsAuthoritative({ data: [], degraded: [] })).toBe(true);
  });

  it('preserves assignments when the connected-account inventory is unavailable', () => {
    expect(normalizeAgentChannelAssignments({
      accounts: [], channels: ['whatsapp'], bindings: ['instagram:ig-1'],
      overviewAvailable: false, supportedTypes: supported,
    })).toEqual({ channels: ['whatsapp'], bindings: ['instagram:ig-1'] });
  });

  it('expands a type assignment only when two current accounts prove it is needed', () => {
    expect(normalizeAgentChannelAssignments({
      accounts: [
        { channelType: 'whatsapp', accountId: 'phone-1' },
        { channelType: 'whatsapp', accountId: 'phone-2' },
      ],
      channels: ['whatsapp'], bindings: [], overviewAvailable: true,
      supportedTypes: supported,
    })).toEqual({
      channels: [], bindings: ['whatsapp:phone-1', 'whatsapp:phone-2'],
    });
  });

  it('folds a binding only when the readable inventory has at most one account', () => {
    expect(normalizeAgentChannelAssignments({
      accounts: [{ channelType: 'whatsapp', accountId: 'phone-1' }],
      channels: [], bindings: ['whatsapp:phone-1'], overviewAvailable: true,
      supportedTypes: supported,
    })).toEqual({ channels: ['whatsapp'], bindings: [] });
  });
});
