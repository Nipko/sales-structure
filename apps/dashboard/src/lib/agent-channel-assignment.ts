export interface ConnectedAgentChannel {
  channelType: string;
  accountId: string;
}

export function normalizeAgentChannelAssignments(input: {
  accounts: ConnectedAgentChannel[];
  channels: string[];
  bindings: string[];
  overviewAvailable: boolean;
  supportedTypes: readonly string[];
}): { channels: string[]; bindings: string[] } {
  const supported = new Set(input.supportedTypes);
  const channels = input.channels.filter((type) => supported.has(type));
  const bindings = input.bindings.filter((binding) => supported.has(binding.split(':')[0]));

  // Without the current account cardinality we cannot know whether a type-level
  // assignment should expand into per-account bindings or whether old bindings
  // should fold back into a type. Preserve the durable answer byte-for-byte.
  if (!input.overviewAvailable) return { channels, bindings };

  const countByType: Record<string, number> = {};
  for (const account of input.accounts) {
    countByType[account.channelType] = (countByType[account.channelType] || 0) + 1;
  }
  const bindingTypes = bindings.map((binding) => binding.split(':')[0]);
  const allTypes = Array.from(new Set([...channels, ...bindingTypes, ...Object.keys(countByType)]))
    .filter((type) => supported.has(type));
  const nextChannels: string[] = [];
  const nextBindings: string[] = [];
  for (const type of allTypes) {
    const count = countByType[type] || 0;
    const hadChannel = channels.includes(type);
    const typeBindings = bindings.filter((binding) => binding.split(':')[0] === type);
    if (count >= 2) {
      const keys = new Set(typeBindings);
      if (hadChannel) {
        for (const account of input.accounts.filter((candidate) => candidate.channelType === type)) {
          keys.add(`${type}:${account.accountId}`);
        }
      }
      nextBindings.push(...keys);
    } else if (hadChannel || typeBindings.length > 0) {
      nextChannels.push(type);
    }
  }
  return { channels: nextChannels, bindings: nextBindings };
}
