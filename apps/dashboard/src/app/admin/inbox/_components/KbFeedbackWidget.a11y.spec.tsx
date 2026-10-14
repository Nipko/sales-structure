import { act } from 'react';
import { api } from '@/lib/api';
import { interact, renderScreen, scanScreen, type RenderedScreen } from '@/test/a11y';
import { KbFeedbackWidget } from './KbFeedbackWidget';

jest.mock('@/lib/api', () => ({ api: { fetch: jest.fn() } }));
const request = api.fetch as jest.Mock;
const refs = {
    tenantId: '3ec0bcc5-462f-4a4f-9ebf-56ea4198b1c8',
    conversationId: '4ce4f40b-a9f2-4ade-95b0-beea66faa97a',
    messageId: '0539ba28-5a6f-4d19-8515-85a46d72a038',
};
let screen: RenderedScreen;
beforeEach(() => { request.mockReset(); });
afterEach(() => { screen?.unmount(); });
const button = (title: string) => screen.container.querySelector<HTMLButtonElement>(`button[title="${title}"]`)!;

it.each([['Útil', 5], ['No útil', 1]])('submits %s as a numeric opinion for the exact message', async (label, rating) => {
    request.mockResolvedValue({ success: true, data: { id: 'feedback-1' } });
    screen = await renderScreen(<KbFeedbackWidget {...refs} />);
    await interact(() => button(String(label)).click());
    expect(request).toHaveBeenCalledTimes(1);
    const [endpoint, options] = request.mock.calls[0];
    expect(endpoint).toBe(`/knowledge/${refs.tenantId}/feedback`);
    expect(JSON.parse(options.body)).toEqual({ conversationId: refs.conversationId, messageId: refs.messageId, rating, query: '' });
    expect(screen.container.textContent).toContain('¡Gracias!');
});

it('locks two immediate clicks to one pending request and waits for acknowledgement', async () => {
    let acknowledge!: (value: unknown) => void;
    request.mockImplementation(() => new Promise(resolve => { acknowledge = resolve; }));
    screen = await renderScreen(<KbFeedbackWidget {...refs} />);
    await interact(() => { button('Útil').click(); button('No útil').click(); });
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.container.textContent).not.toContain('¡Gracias!');
    await act(async () => { acknowledge({ success: true, data: { id: 'feedback-1' } }); });
    expect(screen.container.textContent).toContain('¡Gracias!');
});

it('does not acknowledge an unsuccessful response body', async () => {
    request.mockResolvedValue({ success: false });
    screen = await renderScreen(<KbFeedbackWidget {...refs} />);
    await interact(() => button('Útil').click());
    expect(screen.container.textContent).not.toContain('¡Gracias!');
    expect(screen.container.querySelector('[role="alert"]')).not.toBeNull();
});

it('does not resend when delivery of feedback is uncertain', async () => {
    request.mockRejectedValue(new Error('network unavailable'));
    screen = await renderScreen(<KbFeedbackWidget {...refs} />);
    await interact(() => button('Útil').click());
    expect(screen.container.querySelector('[role="alert"]')).not.toBeNull();
    await interact(() => button('No útil').click());
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.container.textContent).not.toContain('¡Gracias!');
});

it('offers named keyboard controls with the actual Spanish messages', async () => {
    expect(await scanScreen(<KbFeedbackWidget {...refs} />)).toEqual([]);
});
