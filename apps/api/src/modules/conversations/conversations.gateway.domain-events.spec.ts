import { ConversationsGateway } from './conversations.gateway';

describe('ConversationsGateway domain event relay', () => {
    function gateway() {
        const wsRelay = { publish: jest.fn() };
        const instance = new ConversationsGateway(
            {} as any, {} as any, wsRelay as any, {} as any, {} as any,
        );
        return { instance, wsRelay };
    }

    it.each([
        ['created', 'appointmentCreated'],
        ['updated', 'appointmentUpdated'],
        ['cancelled', 'appointmentCancelled'],
    ])('relays an appointment %s event under the dashboard contract', (type, event) => {
        const h = gateway();
        h.instance.onAppointmentWs({ tenantId: 'tenant-1', type, appointment: { id: 'appointment-1' } });
        expect(h.wsRelay.publish).toHaveBeenCalledWith('inbox', {
            room: 'tenant-1', event, payload: { id: 'appointment-1' },
        });
    });

    it('relays captured leads to their tenant only', () => {
        const h = gateway();
        h.instance.onLeadCaptured({ tenantId: 'tenant-1', leadId: 'lead-1' });
        expect(h.wsRelay.publish).toHaveBeenCalledWith('inbox', {
            room: 'tenant-1', event: 'lead.captured',
            payload: { tenantId: 'tenant-1', leadId: 'lead-1' },
        });
    });
});
