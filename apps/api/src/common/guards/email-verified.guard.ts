import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
    EMAIL_VERIFICATION_CAPABILITIES,
    resolveEmailVerificationState,
    VERIFIED_EMAIL_CAPABILITY_KEY,
    type VerifiedEmailCapability,
} from '@parallext/shared';

/**
 * Exige que el correo del usuario esté verificado.
 *
 * NO va en todo el panel a propósito: lectura, configuración básica y prueba
 * conservan el alta progresiva. Va sólo en capacidades sensibles declaradas
 * por `RequiresVerifiedEmail`: publicar agentes/canales, iniciar campañas,
 * administrar cobros o integraciones, invitar usuarios y exportar datos.
 * La metadata de cada endpoint permite devolver un riesgo y una reparación
 * tipados sin convertir la verificación en un bloqueo global del producto.
 *
 * Quien entra con Google o Microsoft nunca lo ve: esos proveedores ya probaron
 * la casilla y `emailVerified` queda en true al vincular la cuenta.
 *
 * super_admin pasa siempre — es personal de la plataforma, no un tenant.
 */
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const { user } = context.switchToHttp().getRequest();
        if (!user) return true; // que resuelva el guard de auth, no éste
        if (user.role === 'super_admin') return true;
        const state = resolveEmailVerificationState(user);
        if (state === 'verified') return true;
        const capability = this.reflector.getAllAndOverride<VerifiedEmailCapability>(
            VERIFIED_EMAIL_CAPABILITY_KEY,
            [context.getHandler(), context.getClass()],
        ) || 'sensitive_admin';
        const policy = EMAIL_VERIFICATION_CAPABILITIES[capability];

        throw new ForbiddenException({
            error: 'email_not_verified',
            state,
            capability,
            risk: policy.risk,
            repair: '/verify-email',
            message: 'Verifica tu correo electrónico para autorizar esta operación.',
        });
    }
}
