import type { VerticalWorkspaceKind } from './verticalWorkspace';

export type OperationComposerKind = Exclude<VerticalWorkspaceKind, 'appointments' | 'stays' | 'none'>;
export type AppointmentSubjectKind = 'listing' | 'pet' | 'vehicle';

const CONTACT_REQUIRED_KINDS = new Set<OperationComposerKind>([
    'tours',
    'restaurant',
    'orders',
    'education',
    'insurance',
    'service_requests',
    'photo_sessions',
    'vehicle_rentals',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Normalize only IDs that can safely reference a tenant CRM contact. */
export function validTenantContactId(value: unknown): string {
    const candidate = String(value || '').trim();
    return UUID_PATTERN.test(candidate) ? candidate : '';
}

/** Claims inherit their contact through the selected policy. */
export function operationRequiresContact(kind: OperationComposerKind, mode = 'create'): boolean {
    return CONTACT_REQUIRED_KINDS.has(kind) && !(kind === 'insurance' && mode === 'claim');
}

/** Never send arbitrary customer state for boarding: the pet owns this link. */
export function petOwnerContactId(item: any): string {
    return validTenantContactId(item?.contact_id || item?.contactId);
}

export function resolveAppointmentSubjectKind(
    industryValue: string,
    subTypeValue: string,
): AppointmentSubjectKind | null {
    const industry = String(industryValue || '').trim().toLowerCase();
    const subType = String(subTypeValue || '').trim().toLowerCase();
    if (industry === 'inmobiliaria') return 'listing';
    if (industry === 'veterinaria' || industry === 'pet_services') return 'pet';
    if (industry === 'automotriz' && subType === 'concesionario') return 'vehicle';
    return null;
}
