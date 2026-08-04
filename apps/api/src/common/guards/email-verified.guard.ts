import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Exige que el correo del usuario esté verificado.
 *
 * NO va en todo el panel a propósito: el alta sigue sin fricción porque cada
 * punto de bloqueo en el registro es un trial que se pierde, y ya sabemos que
 * el envío del correo puede fallar en silencio. Va sólo donde el correo importa
 * de verdad:
 *
 *   - Invitar usuarios: se manda un enlace de acceso a la cuenta desde una
 *     casilla que nadie confirmó que exista.
 *   - Cargar medio de pago / suscribirse: el correo es donde llegan las
 *     facturas y desde donde se recupera la cuenta si se pierde el acceso.
 *
 * Quien entra con Google o Microsoft nunca lo ve: esos proveedores ya probaron
 * la casilla y `emailVerified` queda en true al vincular la cuenta.
 *
 * super_admin pasa siempre — es personal de la plataforma, no un tenant.
 */
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const { user } = context.switchToHttp().getRequest();
        if (!user) return true; // que resuelva el guard de auth, no éste
        if (user.role === 'super_admin') return true;
        if (user.emailVerified) return true;

        throw new ForbiddenException({
            error: 'email_not_verified',
            message: 'Verificá tu correo electrónico para poder hacer esto. Te reenviamos el código desde el aviso que aparece arriba.',
        });
    }
}
