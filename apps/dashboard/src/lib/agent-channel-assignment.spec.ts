import { normalizeAgentChannelAssignments } from './agent-channel-assignment';

const supported = ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget'];

describe('agent channel assignment normalization', () => {
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
