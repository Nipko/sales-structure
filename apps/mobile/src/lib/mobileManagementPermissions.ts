import { DASHBOARD_ROLE_KEYS } from '@parallext/shared';

/** Mirrors CRM archive/restore and dashboard analytics API role guards. */
export function mobileManagementPermissions(role?: string | null) {
    // RolesGuard also allows super_admin; tenant-scoped requests still pass TenantGuard.
    const allowed = role === DASHBOARD_ROLE_KEYS.SUPER_ADMIN
        || role === DASHBOARD_ROLE_KEYS.TENANT_ADMIN
        || role === DASHBOARD_ROLE_KEYS.TENANT_SUPERVISOR;
    return { viewAnalytics: allowed, archiveLeads: allowed };
}
