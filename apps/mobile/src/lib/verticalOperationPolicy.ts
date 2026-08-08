import type { VerticalWorkspaceKind } from './verticalWorkspace';

/** Role and state policy for every workspace kind exposed by the mobile app. */
export type VerticalOperationKind = VerticalWorkspaceKind;

export type VerticalOperationItemType =
    | 'appointment'
    | 'stay'
    | 'tour_booking'
    | 'restaurant_order'
    | 'table_reservation'
    | 'order'
    | 'class'
    | 'class_booking'
    | 'cohort'
    | 'enrollment'
    | 'quote'
    | 'policy'
    | 'claim'
    | 'service_request'
    | 'photo_session'
    | 'test_drive'
    | 'vehicle_rental'
    | 'boarding';

export type VerticalOperationActionId =
    | 'confirm'
    | 'complete'
    | 'reschedule'
    | 'cancel'
    | 'advance'
    | 'book_member'
    | 'enroll'
    | 'quote'
    | 'accept'
    | 'reject'
    | 'create_policy'
    | 'claim'
    | 'edit'
    | 'deliver'
    | 'check_in'
    | 'check_out'
    | 'pick_up'
    | 'return_vehicle';

type AccessLevel = 'viewer' | 'agent' | 'manager';

const AGENT_CREATABLE = new Set<VerticalOperationKind>([
    // Existing, server-authorized mobile flows.
    'appointments',
    'stays',
    // New domain-specific intake flows requested for field agents.
    'tours',
    'restaurant',
    'orders',
    'classes', // An agent creates a class booking, not the class definition.
    'insurance', // Quote and claim intake.
    'service_requests',
    'test_drives',
    'vehicle_rentals',
    'pet_boarding',
]);

const MANAGER_CREATABLE = new Set<VerticalOperationKind>([
    ...AGENT_CREATABLE,
    'education',
    'photo_sessions',
]);

const SAFE_TRANSITIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    restaurant_order: {
        received: 'preparing',
        preparing: 'ready',
        ready: 'delivered',
    },
    order: {
        pending: 'confirmed',
        confirmed: 'paid',
    },
    service_request: {
        pending: 'quoted',
        quoted: 'scheduled',
        scheduled: 'dispatched',
        dispatched: 'in_progress',
        in_progress: 'completed',
    },
    cohort: {
        open: 'finished',
        full: 'finished',
    },
    enrollment: {
        enrolled: 'active',
        active: 'completed',
    },
    photo_session: {
        scheduled: 'in_progress',
        in_progress: 'delivered',
    },
    vehicle_rental: {
        reserved: 'picked_up',
        picked_up: 'returned',
    },
    boarding: {
        reserved: 'checked_in',
        checked_in: 'checked_out',
    },
};

const TERMINAL_BY_ITEM: Readonly<Record<string, ReadonlySet<string>>> = {
    appointment: new Set(['completed', 'cancelled', 'no_show']),
    stay: new Set(['completed', 'cancelled', 'checked_out']),
    tour_booking: new Set(['completed', 'cancelled']),
    restaurant_order: new Set(['delivered', 'cancelled']),
    table_reservation: new Set(['completed', 'cancelled', 'no_show']),
    order: new Set(['paid', 'cancelled']),
    class: new Set(['completed', 'cancelled']),
    class_booking: new Set(['attended', 'cancelled', 'no_show']),
    cohort: new Set(['finished', 'cancelled']),
    enrollment: new Set(['completed', 'dropped', 'refunded']),
    quote: new Set(['rejected', 'expired']),
    policy: new Set(['expired', 'cancelled']),
    claim: new Set(['paid', 'rejected']),
    service_request: new Set(['completed', 'cancelled']),
    photo_session: new Set(['delivered', 'cancelled']),
    test_drive: new Set(['completed', 'cancelled', 'no_show']),
    vehicle_rental: new Set(['returned', 'cancelled']),
    boarding: new Set(['checked_out', 'cancelled']),
};

function normalize(value: string | null | undefined): string {
    return String(value || '').trim().toLowerCase();
}

function accessLevel(role: string | null | undefined): AccessLevel {
    switch (normalize(role)) {
        case 'tenant_agent':
        case 'agent':
            return 'agent';
        case 'tenant_admin':
        case 'admin':
        case 'tenant_supervisor':
        case 'supervisor':
        case 'super_admin':
            return 'manager';
        default:
            return 'viewer';
    }
}

function isTerminal(itemType: string, status: string): boolean {
    return TERMINAL_BY_ITEM[itemType]?.has(status) ?? false;
}

function transitionAction(kind: VerticalOperationKind, nextStatus: string): VerticalOperationActionId {
    if (kind === 'photo_sessions' && nextStatus === 'delivered') return 'deliver';
    if (kind === 'pet_boarding' && nextStatus === 'checked_in') return 'check_in';
    if (kind === 'pet_boarding' && nextStatus === 'checked_out') return 'check_out';
    if (kind === 'vehicle_rentals' && nextStatus === 'picked_up') return 'pick_up';
    if (kind === 'vehicle_rentals' && nextStatus === 'returned') return 'return_vehicle';
    return 'advance';
}

/** Whether this role can initiate the kind's primary mobile operation. */
export function canCreateOperation(
    kind: VerticalOperationKind,
    role: string | null | undefined,
): boolean {
    const level = accessLevel(role);
    if (level === 'viewer' || kind === 'none') return false;
    return (level === 'manager' ? MANAGER_CREATABLE : AGENT_CREATABLE).has(kind);
}

/**
 * Returns the one safe, forward-only status selected by the mobile policy.
 * Unknown and terminal statuses intentionally have no fallback transition.
 */
export function getSafeNextStatus(
    kind: VerticalOperationKind,
    itemType: VerticalOperationItemType | string,
    status: string | null | undefined,
): string | null {
    const normalizedType = normalize(itemType);
    const normalizedStatus = normalize(status);
    if (!normalizedStatus || isTerminal(normalizedType, normalizedStatus)) return null;

    const expectedTypeByKind: Partial<Record<VerticalOperationKind, ReadonlySet<string>>> = {
        restaurant: new Set(['restaurant_order']),
        orders: new Set(['order']),
        service_requests: new Set(['service_request']),
        education: new Set(['cohort', 'enrollment']),
        photo_sessions: new Set(['photo_session']),
        vehicle_rentals: new Set(['vehicle_rental']),
        pet_boarding: new Set(['boarding']),
    };
    if (!expectedTypeByKind[kind]?.has(normalizedType)) return null;
    return SAFE_TRANSITIONS[normalizedType]?.[normalizedStatus] ?? null;
}

/**
 * Item-level actions are conservative: a missing/unknown state is read-only,
 * terminal records never expose mutations, and viewer-equivalent roles only read.
 */
export function availableItemActions(
    kind: VerticalOperationKind,
    role: string | null | undefined,
    itemType: VerticalOperationItemType | string,
    status: string | null | undefined,
): VerticalOperationActionId[] {
    const level = accessLevel(role);
    const type = normalize(itemType);
    const state = normalize(status);
    const manager = level === 'manager';
    const operator = level === 'agent' || manager;

    if (!operator || kind === 'none' || !state || isTerminal(type, state)) return [];

    if (kind === 'appointments' && type === 'appointment') {
        if (state === 'pending' || state === 'scheduled') return ['confirm', 'reschedule', 'cancel'];
        if (state === 'confirmed') return ['complete', 'reschedule', 'cancel'];
        return [];
    }

    if (kind === 'stays' && type === 'stay') {
        return manager ? ['cancel'] : [];
    }

    if (kind === 'tours' && type === 'tour_booking') {
        return manager ? ['cancel'] : [];
    }

    if (kind === 'restaurant' && type === 'table_reservation') {
        if (state === 'pending' || state === 'scheduled') return ['confirm', 'reschedule', 'cancel'];
        if (state === 'confirmed') return ['complete', 'reschedule', 'cancel'];
        return [];
    }

    if (kind === 'classes' && type === 'class') {
        if (state === 'full') return manager ? ['cancel'] : [];
        const actions: VerticalOperationActionId[] = ['book_member'];
        if (manager) actions.push('cancel');
        return actions;
    }

    if (kind === 'classes' && type === 'class_booking') {
        return ['cancel'];
    }

    if (kind === 'insurance') {
        if (type === 'quote' && manager) {
            if (state === 'draft') return ['quote'];
            if (state === 'sent') return ['accept', 'reject'];
            if (state === 'accepted') return ['create_policy'];
            return [];
        }
        if (type === 'policy' && state === 'active') return ['claim'];
        return [];
    }

    if (kind === 'test_drives' && type === 'test_drive') {
        // The current API has create/list only; do not surface fake mutations.
        return [];
    }

    const nextStatus = getSafeNextStatus(kind, type, state);
    if (!nextStatus) return [];

    if (kind === 'restaurant' || kind === 'orders') {
        const actions: VerticalOperationActionId[] = [transitionAction(kind, nextStatus)];
        if (manager) actions.push('cancel');
        return actions;
    }

    if (kind === 'service_requests') {
        const actions: VerticalOperationActionId[] = ['advance'];
        if (manager) actions.push('cancel');
        return actions;
    }

    if (kind === 'education') {
        if (!manager) return [];
        if (type === 'cohort') return state === 'open' ? ['enroll', 'cancel'] : ['cancel'];
        return ['advance', 'cancel'];
    }

    if (kind === 'photo_sessions') {
        if (!manager) return [];
        return [transitionAction(kind, nextStatus), 'cancel'];
    }

    if (kind === 'vehicle_rentals' || kind === 'pet_boarding') {
        const transition = transitionAction(kind, nextStatus);
        if (!manager) {
            const intakeTransition = (kind === 'vehicle_rentals' && state === 'reserved')
                || (kind === 'pet_boarding' && state === 'reserved');
            return intakeTransition ? [transition] : [];
        }
        return [transition, 'cancel'];
    }

    return [];
}
