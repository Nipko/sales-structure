import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AUTH_THROTTLE_KEY } from '../../common/decorators/auth-throttle.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AuthThrottleGuard } from '../../common/guards/auth-throttle.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { MetaComplianceController } from './meta-compliance.controller';

describe('MetaComplianceController security metadata', () => {
    it('limita por IP el formulario público', () => {
        const handler = MetaComplianceController.prototype.userRequest;

        expect(Reflect.getMetadata(AUTH_THROTTLE_KEY, handler)).toEqual({
            limit: 5,
            windowSeconds: 3600,
        });
        expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(AuthThrottleGuard);
    });

    it('reserva la transición de estado al super administrador', () => {
        const handler = MetaComplianceController.prototype.updateStatus;
        const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as Array<{
            prototype?: { canActivate?: unknown };
        }>;

        expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['super_admin']);
        expect(guards).toHaveLength(2);
        expect(guards).toContain(RolesGuard);
        const jwtGuard = guards.find((guard) => guard !== RolesGuard);
        expect(typeof jwtGuard?.prototype?.canActivate).toBe('function');
    });
});
