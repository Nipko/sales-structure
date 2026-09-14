import { dashboardRoleCanOpen } from '@parallext/shared';

export const VEHICLE_RENTAL_WEB_PATH = '/admin/resource-rentals';

/** Web owns eligibility review and evidence-backed pickup/return. */
export function vehicleRentalHandoff(status: string | undefined, role: string | undefined) {
    const state = String(status || '').trim().toLowerCase();
    if (!['pending_review', 'reserved', 'picked_up'].includes(state)) return null;
    const canOpen = dashboardRoleCanOpen(VEHICLE_RENTAL_WEB_PATH, role || '');
    const canReview = role === 'tenant_admin' || role === 'tenant_supervisor';
    return {
        titleKey: state === 'pending_review' ? 'ops.rental.reviewPending'
            : state === 'reserved' ? 'ops.rental.inspectionPickup' : 'ops.rental.inspectionReturn',
        bodyKey: !canOpen ? 'ops.rental.askManager'
            : state === 'pending_review' && !canReview ? 'ops.rental.managerReview'
                : state === 'pending_review' ? 'ops.rental.reviewBody' : 'ops.rental.inspectionBody',
        path: canOpen ? VEHICLE_RENTAL_WEB_PATH : null,
    };
}
