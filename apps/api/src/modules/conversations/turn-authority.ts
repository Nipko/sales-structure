import type { EffectiveCapabilityContract, ToolExecutionAuthority } from '@parallext/shared';

/**
 * Cómo se arma la autoridad de un turno, en un solo lugar.
 *
 * Vivía dentro de `generateResponse`, que tiene mil setecientas líneas y
 * treinta y nueve dependencias: probarlo exigía construir el orquestador
 * entero, así que en la práctica **no se probaba** — y lo que un E2E podía
 * hacer era *replicar* el armado, que es la forma más silenciosa de que la
 * prueba y el código dejen de decir lo mismo.
 *
 * Acá es una función pura de tres entradas. Lo que la prueba ejercita es
 * exactamente lo que corre en producción.
 */

/** Cuando el contrato no se pudo resolver, la autoridad nace vieja. */
const UNRESOLVED_AT = new Date(0).toISOString();

export interface TurnAuthorityInput {
    /** El contrato de este turno. Ausente = el resolutor no resolvió. */
    contract: EffectiveCapabilityContract | undefined | null;
    /** Motivo por el que el negocio no puede comprometerse, o `null`. */
    commitmentBlocked: { reason: string } | null;
    /** Lo que el dueño apagó a mano en la pantalla del agente. */
    deniedTools: readonly string[];
    /** El perfil del subtipo con el que se resolvió, para la traza. */
    subtypeProfileId?: string;
}

/**
 * La autoridad del turno, con la lista de tools que se le pase.
 *
 * `resolvedAt` sale del contrato y **no** de `now()`. La diferencia importa: si
 * el contrato no se pudo resolver, la autoridad nace vieja y el ejecutor la
 * rechaza por `authority_stale`, en vez de dejar pasar una lista vacía como si
 * fuera una decisión que alguien tomó.
 */
export function buildTurnAuthority(
    input: TurnAuthorityInput,
    allowedTools: readonly string[],
): ToolExecutionAuthority {
    return {
        source: 'turn_contract',
        allowedTools,
        commitmentBlocked: input.commitmentBlocked,
        deniedTools: input.deniedTools,
        resolvedAt: input.contract?.resolvedAt ?? UNRESOLVED_AT,
        subtypeProfileId: input.subtypeProfileId ?? input.contract?.subtypeProfileId,
    };
}

/**
 * Lo que los motores deterministas pueden invocar.
 *
 * Sale del contrato y no de la lista final de tools del turno: el motor de
 * reservas y Procedures corren ANTES de que esa lista se arme, y atarlos a ella
 * los ataría a un orden de ejecución que no controlan.
 */
export function engineAuthorityFor(input: TurnAuthorityInput): ToolExecutionAuthority {
    return buildTurnAuthority(input, input.contract?.publishedTools ?? []);
}
