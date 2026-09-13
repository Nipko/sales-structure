import { resolveQualityFocusResponse } from './quality-focus';

describe('quality focus verification', () => {
  const agent = { id: 'agent-a' };
  const signal = { success: true, data: { agent, code: 'fix_channel_connection' } } as any;
  it.each([null, { success: false }, { success: false, httpStatus: 403 }, { success: false, httpStatus: 500 }])(
    'never describes a failed verification as a resolved or missing signal (%j)', response => {
      expect(resolveQualityFocusResponse(response, null, agent.id)).toEqual({ state: 'unavailable', payload: null });
    },
  );
  it('distinguishes a missing active signal from a failed lookup', () => {
    expect(resolveQualityFocusResponse({ success: false, httpStatus: 404 }, null, agent.id).state).toBe('gone');
  });
  it('retains the action without inventing preparation evidence when the overview fails', () => {
    expect(resolveQualityFocusResponse(signal, { success: false }, agent.id)).toEqual({ state: 'ready', payload: { signal: signal.data, overview: null } });
  });
  it('refuses an overview or signal for a different agent', () => {
    const overview = { success: true, data: { agent: { id: 'agent-b' } } } as any;
    expect(resolveQualityFocusResponse(signal, overview, agent.id)).toMatchObject({ payload: { overview: null } });
    expect(resolveQualityFocusResponse(signal, null, 'agent-b').state).toBe('unavailable');
  });
});
