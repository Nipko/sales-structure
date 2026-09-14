import { vehicleRentalHandoff, VEHICLE_RENTAL_WEB_PATH } from '../vehicleRentalHandoff';

describe('vehicle rental web continuation', () => {
    it.each(['tenant_admin', 'tenant_supervisor'])('sends %s to the verified review page', role => {
        expect(vehicleRentalHandoff('pending_review', role)).toMatchObject({
            bodyKey: 'ops.rental.reviewBody', path: VEHICLE_RENTAL_WEB_PATH,
        });
    });
    it('keeps approval with managers while letting the agent read the same record', () => {
        expect(vehicleRentalHandoff('pending_review', 'tenant_agent')).toMatchObject({
            bodyKey: 'ops.rental.managerReview', path: VEHICLE_RENTAL_WEB_PATH,
        });
        expect(vehicleRentalHandoff('reserved', 'tenant_agent')?.titleKey).toBe('ops.rental.inspectionPickup');
        expect(vehicleRentalHandoff('picked_up', 'tenant_agent')?.titleKey).toBe('ops.rental.inspectionReturn');
    });
    it.each(['super_admin', 'tenant_viewer', 'unknown'])('does not send %s to a denied page', role => {
        expect(vehicleRentalHandoff('reserved', role)).toMatchObject({ path: null, bodyKey: 'ops.rental.askManager' });
    });
    it.each(['returned', 'cancelled', 'rejected', 'unexpected', undefined])('does not invent an active step for %s', state => {
        expect(vehicleRentalHandoff(state, 'tenant_admin')).toBeNull();
    });
});
