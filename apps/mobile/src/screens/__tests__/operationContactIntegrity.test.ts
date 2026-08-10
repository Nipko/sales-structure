import {
    operationRequiresContact,
    petOwnerContactId,
    resolveAppointmentSubjectKind,
    validTenantContactId,
    type OperationComposerKind,
} from '../../lib/operationContactIntegrity';

describe('mobile operation contact integrity', () => {
    it('accepts only a valid tenant contact UUID for manual operations', () => {
        const contactId = '11111111-1111-4111-8111-111111111111';
        expect(validTenantContactId(contactId)).toBe(contactId);
        expect(validTenantContactId('lead_123')).toBe('');
        expect(validTenantContactId(undefined)).toBe('');
    });

    it.each([
        'tours',
        'restaurant',
        'orders',
        'education',
        'service_requests',
        'photo_sessions',
        'vehicle_rentals',
    ] as OperationComposerKind[])('requires a contact for %s', (kind) => {
        expect(operationRequiresContact(kind)).toBe(true);
    });

    it('requires contacts for insurance quote/policy but derives claims from the policy', () => {
        expect(operationRequiresContact('insurance', 'quote')).toBe(true);
        expect(operationRequiresContact('insurance', 'policy')).toBe(true);
        expect(operationRequiresContact('insurance', 'claim')).toBe(false);
    });

    it.each(['classes', 'pet_boarding', 'test_drives'] as OperationComposerKind[])(
        'does not invent an independent contact selection for %s',
        (kind) => expect(operationRequiresContact(kind)).toBe(false),
    );

    it('derives only a valid pet-owner contact from either API naming convention', () => {
        const ownerId = '11111111-1111-4111-8111-111111111111';
        expect(petOwnerContactId({ contact_id: ownerId })).toBe(ownerId);
        expect(petOwnerContactId({ contactId: ownerId })).toBe(ownerId);
        expect(petOwnerContactId({ contact_id: 'not-a-uuid' })).toBe('');
        expect(petOwnerContactId({})).toBe('');
    });
});

describe('automotive appointment subject integrity', () => {
    it('uses dealership inventory only as appointment metadata context', () => {
        expect(resolveAppointmentSubjectKind('automotriz', 'concesionario')).toBe('vehicle');
    });

    it('never presents dealership stock as the workshop customer vehicle', () => {
        expect(resolveAppointmentSubjectKind('automotriz', 'taller')).toBeNull();
    });
});
