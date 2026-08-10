import {
    availableItemActions,
    canCreateOperation,
    getSafeNextStatus,
    requiresScheduledAtTransition,
    type VerticalOperationKind,
} from '../verticalOperationPolicy';

const ALL_KINDS: VerticalOperationKind[] = [
    'appointments', 'stays', 'tours', 'restaurant', 'orders', 'classes',
    'education', 'insurance', 'service_requests', 'photo_sessions',
    'test_drives', 'none', 'vehicle_rentals', 'pet_boarding',
];

describe('verticalOperationPolicy', () => {
    describe('canCreateOperation', () => {
        it.each(ALL_KINDS)('keeps viewers read-only for %s', (kind) => {
            expect(canCreateOperation(kind, 'viewer')).toBe(false);
            expect(canCreateOperation(kind, undefined)).toBe(false);
            expect(canCreateOperation(kind, 'unknown_role')).toBe(false);
        });

        it('allows agents to initiate only agent-safe operations', () => {
            const allowed: VerticalOperationKind[] = [
                'appointments', 'stays', 'tours', 'restaurant', 'orders', 'classes',
                'insurance', 'service_requests', 'test_drives', 'vehicle_rentals',
                'pet_boarding',
            ];
            for (const kind of ALL_KINDS) {
                expect(canCreateOperation(kind, 'tenant_agent')).toBe(allowed.includes(kind));
                expect(canCreateOperation(kind, 'agent')).toBe(allowed.includes(kind));
            }
        });

        it.each(['tenant_admin', 'admin', 'tenant_supervisor', 'supervisor', 'super_admin'])(
            'gives manager-equivalent role %s every supported create flow',
            (role) => {
                for (const kind of ALL_KINDS) {
                    expect(canCreateOperation(kind, role)).toBe(kind !== 'none');
                }
            },
        );
    });

    describe('safe transition matrices', () => {
        const paths: Array<{
            kind: VerticalOperationKind;
            itemType: string;
            states: string[];
        }> = [
            { kind: 'restaurant', itemType: 'restaurant_order', states: ['received', 'preparing', 'ready', 'delivered'] },
            { kind: 'orders', itemType: 'order', states: ['pending', 'confirmed', 'paid'] },
            { kind: 'service_requests', itemType: 'service_request', states: ['pending', 'quoted', 'scheduled', 'dispatched', 'in_progress', 'completed'] },
            { kind: 'education', itemType: 'enrollment', states: ['enrolled', 'active', 'completed'] },
            { kind: 'photo_sessions', itemType: 'photo_session', states: ['requested', 'scheduled', 'in_progress', 'delivered'] },
            { kind: 'vehicle_rentals', itemType: 'vehicle_rental', states: ['reserved', 'picked_up', 'returned'] },
            { kind: 'pet_boarding', itemType: 'boarding', states: ['reserved', 'checked_in', 'checked_out'] },
        ];

        it.each(paths)('follows the closed $kind/$itemType path', ({ kind, itemType, states }) => {
            for (let index = 0; index < states.length - 1; index += 1) {
                expect(getSafeNextStatus(kind, itemType, states[index])).toBe(states[index + 1]);
            }
            expect(getSafeNextStatus(kind, itemType, states.at(-1))).toBeNull();
        });

        it.each([
            ['open', 'finished'],
            ['full', 'finished'],
        ])('finishes an education cohort from %s', (from, to) => {
            expect(getSafeNextStatus('education', 'cohort', from)).toBe(to);
        });

        it('requires an atomic timestamp for service and photography scheduling', () => {
            expect(requiresScheduledAtTransition('service_requests', 'service_request', 'scheduled')).toBe(true);
            expect(requiresScheduledAtTransition('photo_sessions', 'photo_session', 'scheduled')).toBe(true);
            expect(requiresScheduledAtTransition('photo_sessions', 'photo_session', 'in_progress')).toBe(false);
            expect(requiresScheduledAtTransition('appointments', 'appointment', 'scheduled')).toBe(false);
        });

        it('never guesses transitions for an unknown state or mismatched item type', () => {
            expect(getSafeNextStatus('orders', 'order', 'mystery')).toBeNull();
            expect(getSafeNextStatus('orders', 'restaurant_order', 'received')).toBeNull();
            expect(getSafeNextStatus('appointments', 'appointment', 'pending')).toBeNull();
            expect(getSafeNextStatus('restaurant', 'restaurant_order', ' CANCELLED ')).toBeNull();
        });
    });

    describe('availableItemActions', () => {
        const readableSamples: Array<[VerticalOperationKind, string, string]> = [
            ['appointments', 'appointment', 'pending'],
            ['stays', 'stay', 'confirmed'],
            ['tours', 'tour_booking', 'reserved'],
            ['restaurant', 'restaurant_order', 'received'],
            ['orders', 'order', 'pending'],
            ['classes', 'class', 'scheduled'],
            ['education', 'enrollment', 'enrolled'],
            ['insurance', 'quote', 'sent'],
            ['service_requests', 'service_request', 'pending'],
            ['photo_sessions', 'photo_session', 'scheduled'],
            ['test_drives', 'test_drive', 'scheduled'],
            ['vehicle_rentals', 'vehicle_rental', 'reserved'],
            ['pet_boarding', 'boarding', 'reserved'],
        ];

        it.each(readableSamples)('keeps viewer read-only for %s/%s', (kind, itemType, status) => {
            expect(availableItemActions(kind, 'viewer', itemType, status)).toEqual([]);
        });

        it('offers safe appointment actions and locks terminal appointments', () => {
            expect(availableItemActions('appointments', 'tenant_agent', 'appointment', 'pending'))
                .toEqual(['confirm', 'reschedule', 'cancel']);
            expect(availableItemActions('appointments', 'tenant_agent', 'appointment', 'confirmed'))
                .toEqual(['complete', 'reschedule', 'cancel']);
            for (const status of ['completed', 'cancelled', 'no_show']) {
                expect(availableItemActions('appointments', 'tenant_admin', 'appointment', status)).toEqual([]);
            }
        });

        it('keeps stay and tour cancellation manager-only', () => {
            expect(availableItemActions('stays', 'tenant_agent', 'stay', 'confirmed')).toEqual([]);
            expect(availableItemActions('stays', 'tenant_supervisor', 'stay', 'confirmed')).toEqual(['cancel']);
            expect(availableItemActions('tours', 'tenant_agent', 'tour_booking', 'reserved')).toEqual([]);
            expect(availableItemActions('tours', 'tenant_admin', 'tour_booking', 'reserved')).toEqual(['cancel']);
        });

        it('allows agents to advance orders while reserving cancellation for managers', () => {
            expect(availableItemActions('restaurant', 'tenant_agent', 'restaurant_order', 'received')).toEqual(['advance']);
            expect(availableItemActions('restaurant', 'tenant_admin', 'restaurant_order', 'ready')).toEqual(['advance', 'cancel']);
            expect(availableItemActions('orders', 'tenant_agent', 'order', 'pending')).toEqual(['advance']);
            expect(availableItemActions('orders', 'tenant_supervisor', 'order', 'confirmed')).toEqual(['advance', 'cancel']);
            expect(availableItemActions('orders', 'tenant_admin', 'order', 'paid')).toEqual([]);
        });

        it('separates class booking from class administration', () => {
            expect(availableItemActions('classes', 'tenant_agent', 'class', 'scheduled')).toEqual(['book_member']);
            expect(availableItemActions('classes', 'tenant_admin', 'class', 'scheduled')).toEqual(['book_member', 'cancel']);
            expect(availableItemActions('classes', 'tenant_agent', 'class', 'full')).toEqual([]);
            expect(availableItemActions('classes', 'tenant_admin', 'class', 'full')).toEqual(['cancel']);
            expect(availableItemActions('classes', 'tenant_agent', 'class_booking', 'confirmed')).toEqual(['cancel']);
            expect(availableItemActions('classes', 'tenant_admin', 'class', 'cancelled')).toEqual([]);
        });

        it('keeps education mutations manager-only', () => {
            expect(availableItemActions('education', 'tenant_agent', 'cohort', 'open')).toEqual([]);
            expect(availableItemActions('education', 'tenant_admin', 'cohort', 'open')).toEqual(['enroll', 'cancel']);
            expect(availableItemActions('education', 'tenant_supervisor', 'enrollment', 'active')).toEqual(['advance', 'cancel']);
            expect(availableItemActions('education', 'tenant_admin', 'enrollment', 'completed')).toEqual([]);
        });

        it('exposes semantic insurance actions without mutating terminal records', () => {
            expect(availableItemActions('insurance', 'tenant_admin', 'quote', 'draft')).toEqual(['quote']);
            expect(availableItemActions('insurance', 'tenant_supervisor', 'quote', 'sent')).toEqual(['accept', 'reject']);
            expect(availableItemActions('insurance', 'tenant_admin', 'quote', 'accepted')).toEqual(['create_policy']);
            expect(availableItemActions('insurance', 'tenant_agent', 'policy', 'active')).toEqual(['claim']);
            expect(availableItemActions('insurance', 'tenant_admin', 'quote', 'expired')).toEqual([]);
            expect(availableItemActions('insurance', 'tenant_admin', 'claim', 'paid')).toEqual([]);
        });

        it('uses safe field-service, photo, rental and boarding actions', () => {
            expect(availableItemActions('service_requests', 'tenant_agent', 'service_request', 'pending')).toEqual(['advance']);
            expect(availableItemActions('service_requests', 'tenant_admin', 'service_request', 'in_progress')).toEqual(['advance', 'cancel']);
            expect(availableItemActions('photo_sessions', 'tenant_agent', 'photo_session', 'requested')).toEqual([]);
            expect(availableItemActions('photo_sessions', 'tenant_admin', 'photo_session', 'requested')).toEqual(['advance', 'cancel']);
            expect(availableItemActions('photo_sessions', 'tenant_agent', 'photo_session', 'scheduled')).toEqual([]);
            expect(availableItemActions('photo_sessions', 'tenant_admin', 'photo_session', 'scheduled')).toEqual(['advance', 'cancel']);
            expect(availableItemActions('photo_sessions', 'tenant_admin', 'photo_session', 'in_progress')).toEqual(['deliver', 'cancel']);
            expect(availableItemActions('vehicle_rentals', 'tenant_agent', 'vehicle_rental', 'reserved')).toEqual(['pick_up']);
            expect(availableItemActions('vehicle_rentals', 'tenant_admin', 'vehicle_rental', 'reserved')).toEqual(['pick_up', 'cancel']);
            expect(availableItemActions('vehicle_rentals', 'tenant_admin', 'vehicle_rental', 'picked_up')).toEqual(['return_vehicle', 'cancel']);
            expect(availableItemActions('pet_boarding', 'tenant_agent', 'boarding', 'reserved')).toEqual(['check_in']);
            expect(availableItemActions('pet_boarding', 'tenant_supervisor', 'boarding', 'reserved')).toEqual(['check_in', 'cancel']);
            expect(availableItemActions('pet_boarding', 'tenant_supervisor', 'boarding', 'checked_in')).toEqual(['check_out', 'cancel']);
        });

        it('does not invent unsupported test-drive mutations', () => {
            expect(availableItemActions('test_drives', 'tenant_admin', 'test_drive', 'scheduled')).toEqual([]);
        });

        it.each([
            ['restaurant', 'restaurant_order', 'delivered'],
            ['orders', 'order', 'paid'],
            ['service_requests', 'service_request', 'completed'],
            ['education', 'cohort', 'finished'],
            ['education', 'enrollment', 'completed'],
            ['photo_sessions', 'photo_session', 'delivered'],
            ['vehicle_rentals', 'vehicle_rental', 'returned'],
            ['pet_boarding', 'boarding', 'checked_out'],
        ] as Array<[VerticalOperationKind, string, string]>)('returns no actions for terminal %s/%s=%s', (kind, itemType, status) => {
            expect(availableItemActions(kind, 'tenant_admin', itemType, status)).toEqual([]);
        });

        it('normalizes roles, item types and statuses', () => {
            expect(availableItemActions('restaurant', ' TENANT_AGENT ', ' RESTAURANT_ORDER ', ' RECEIVED ')).toEqual(['advance']);
        });
    });
});
