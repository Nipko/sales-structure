import { SetMetadata } from '@nestjs/common';
import type { VerticalCapability } from '@parallext/shared';

export const REQUIRE_VERTICAL_CAPABILITY_KEY = 'requiredVerticalCapabilities';

/**
 * Restrict a vertical's controller to tenants whose industry can have the
 * capability. The dashboard already hides the pages of other industries, but a
 * route that only the sidebar protects is not protected: any authenticated
 * tenant could call `/restaurants/:tenantId/...` or `/repair-orders/...` on a
 * dental clinic. Pass every capability that makes the surface visible in the
 * dashboard (`CAPABILITY_ITEMS` in `vertical-dashboard-resolver.ts`); the route
 * is open when ANY of them applies. Enforced by `VerticalCapabilityGuard`.
 *
 *   @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard, VerticalCapabilityGuard)
 *   @RequireVerticalCapability('restaurant_ordering')
 *   @Controller('restaurants')
 */
export const RequireVerticalCapability = (...capabilities: VerticalCapability[]) =>
    SetMetadata(REQUIRE_VERTICAL_CAPABILITY_KEY, capabilities);
