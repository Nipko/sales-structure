import type { ToolExecutionAuthority } from '@parallext/shared';

/**
 * La autoridad que una prueba declara para el turno que está montando.
 *
 * El ejecutor pasó a denegar por defecto: una tool que no está publicada no
 * corre, venga de donde venga la llamada. Las pruebas de dominio —seguridad de
 * citas, integridad de pedidos, semántica de lectura— no son sobre autoridad,
 * pero igual tienen que declararla, y declararla **exacta**: cada caso autoriza
 * las tools que ese caso invoca y ninguna más.
 *
 * No existe un `allowAll()` a propósito. Una autoridad que autorice todo dejaría
 * pasar en verde justamente los casos que el default-deny tiene que atrapar.
 */
export function authorityFor(...allowedTools: string[]): ToolExecutionAuthority {
    return {
        source: 'turn_contract',
        allowedTools,
        resolvedAt: new Date().toISOString(),
    };
}
