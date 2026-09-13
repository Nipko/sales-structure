import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('TopBar live event contract', () => {
  const source = readFileSync(resolve(__dirname, 'TopBar.tsx'), 'utf8');

  it('subscribes to the event names emitted by the backend gateway', () => {
    for (const event of ['newMessage', 'inbox:handoff', 'inbox:escalation',
      'inbox:assigned_to_you', 'optout.detected', 'appointmentCreated',
      'appointmentCancelled', 'lead.captured', 'system:llm_alert']) {
      expect(source).toContain(`socket.on("${event}"`);
    }
  });

  it('does not promise live events with no backend emitter', () => {
    for (const event of ['handoff.escalated', 'automation.triggered', 'order.created',
      'appointment.created', 'appointment.cancelled']) {
      expect(source).not.toContain(`socket.on("${event}"`);
    }
  });
});
