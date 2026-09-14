export interface ConnectedAgentChannel {
  channelType: string;
  accountId: string;
}

export function channelOverviewIsAuthoritative(value: unknown): value is {
  data: ConnectedAgentChannel[];
  degraded?: string[];
} {
  if (!value || typeof value !== 'object') return false;
  const response = value as { data?: unknown; degraded?: unknown };
  return Array.isArray(response.data)
    && (!Array.isArray(response.degraded) || response.degraded.length === 0);
}

export function normalizeAgentChannelAssignments(input: {
  accounts: ConnectedAgentChannel[];
  channels: string[];
  bindings: string[];
  overviewAvailable: boolean;
  supportedTypes: readonly string[];
}): { channels: string[]; bindings: string[] } {
  const supported = new Set(input.supportedTypes);
  // Keep unsupported and stale assignments visible until the owner removes
  // them. Loading an editor is not a repair of its operational configuration.
  const channels = [...input.channels];
  const bindings = [...input.bindings];

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
  const nextChannels = channels.filter(type => !supported.has(type));
  const nextBindings = bindings.filter(binding => !supported.has(binding.split(':')[0]));
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
    } else {
      const currentBinding = count === 1
        ? `${type}:${input.accounts.find(account => account.channelType === type)!.accountId}` : null;
      if (hadChannel || (currentBinding !== null && typeBindings.includes(currentBinding))) nextChannels.push(type);
      nextBindings.push(...typeBindings.filter(binding => binding !== currentBinding));
    }
  }
  return { channels: nextChannels, bindings: nextBindings };
}

export interface AgentChannelAssignmentIssue {
  kind: 'channel' | 'binding';
  value: string;
  reason: 'unsupported' | 'disconnected' | 'stale';
}

export function agentChannelAssignmentIssues(input: {
  channels: string[]; bindings: string[]; accounts: ConnectedAgentChannel[];
  overviewAvailable: boolean; supportedTypes: readonly string[];
}): AgentChannelAssignmentIssue[] {
  const supported = new Set(input.supportedTypes);
  const connectedTypes = new Set(input.accounts.map(account => account.channelType));
  const connectedBindings = new Set(input.accounts.map(account => `${account.channelType}:${account.accountId}`));
  const issues: AgentChannelAssignmentIssue[] = [];
  for (const value of input.channels) {
    if (!supported.has(value)) issues.push({ kind: 'channel', value, reason: 'unsupported' });
    else if (input.overviewAvailable && !connectedTypes.has(value)) issues.push({ kind: 'channel', value, reason: 'disconnected' });
  }
  for (const value of input.bindings) {
    if (!supported.has(value.split(':')[0])) issues.push({ kind: 'binding', value, reason: 'unsupported' });
    else if (input.overviewAvailable && !connectedBindings.has(value)) issues.push({ kind: 'binding', value, reason: 'stale' });
  }
  return issues;
}
