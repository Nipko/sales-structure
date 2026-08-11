import {
  canAccessPath,
  defaultLandingForRole,
  isSuperAdmin,
  type Role,
} from "./roles";
import {
  resolveNavigationReturnTarget,
  resolveNavigationRoute,
} from "./navigation-contract";
import {
  isVerticalDashboardPathVisible,
  resolveVerticalDashboard,
  type DashboardVerticalConfigLike,
} from "./vertical-dashboard-resolver";

/** One role + vertical visibility decision shared by every navigation surface. */
export function canAccessDashboardNavigationPath(
  pathname: string,
  role: Role,
  impersonating: boolean,
  verticalConfig: DashboardVerticalConfigLike | null | undefined,
): boolean {
  if (!canAccessPath(pathname, role, impersonating)) return false;
  const tenantMode = !isSuperAdmin(role) || impersonating;
  if (!tenantMode) return true;
  return isVerticalDashboardPathVisible(resolveVerticalDashboard(verticalConfig), pathname);
}

/** Resolve a denied route to the authenticated role's stable product home. */
export function resolveAccessDeniedNavigation(
  currentPath: string,
  role: Role,
  impersonating: boolean,
  verticalConfig?: DashboardVerticalConfigLike | null,
): string {
  const roleLanding = defaultLandingForRole(role, impersonating);
  const roleLandingRouteId = resolveNavigationRoute(roleLanding)?.definition.id;

  return resolveNavigationReturnTarget({
    currentPath,
    fallbackRouteId: roleLandingRouteId,
    isAllowedPath: (candidate) => canAccessDashboardNavigationPath(
      candidate,
      role,
      impersonating,
      verticalConfig,
    ),
  }).href;
}
