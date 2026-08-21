import {
    SUBTYPE_EXPERIENCE_PROFILES,
    resolveSubtypeExperienceProfile,
    type SubtypeAlert,
} from '@parallext/shared';
import { staticToolsForAgentConfig } from '../conversations/agent-tool-registry';
import { isBusinessWriteTool } from '../conversations/tool-policy-registry';

/**
 * ═══ EL BACKLOG NATIVO ERA UNA FOTO DE JULIO PRESENTADA COMO ESTADO ACTUAL ═══
 *
 * Cada perfil lleva `alerts`, y su propio comentario lo dice: *"Audit alerts
 * carried forward **verbatim**, so a reader can trace a decision to the finding
 * that produced it."* Son **procedencia**, no estado — y no hay ningún campo que
 * diga cuáles siguen abiertas.
 *
 * Con lo cual "ejecutar el backlog nativo de los 31 `build` y 23 `hybrid`" es,
 * literalmente, **incontestable**: la lista mezcla lo que sigue faltando con lo
 * que se construyó después de que la auditoría la escribiera, y nadie puede
 * distinguir una cosa de la otra mirándola.
 *
 * Medido: las cuatro alertas `WRITER` —"este perfil no tiene escritor"— son
 * **falsas hoy**. `moda_belleza/spa` tiene tres escrituras de agenda;
 * `automotriz/alquiler`, `pet_services/guarderia` y `pet_services/hotel` tienen
 * las de alquiler de recurso que se construyeron después. La alerta seguía ahí.
 *
 * ═══ QUÉ SE DERIVA Y QUÉ NO ═══
 *
 * Sólo se deriva lo que el sistema **sabe con certeza**. Una derivación
 * plausible pero floja sería peor que la foto vieja: cerraría por decreto lo que
 * hay que ir a mirar.
 *
 * - `WRITER` **sí**: "¿este perfil tiene alguna escritura de negocio?" se
 *   contesta contando los writers de sus familias de tools. No hay margen.
 * - `SOR`, `LIVE`, `CAP`, `PAY` **no**: "el registro real vive afuera",
 *   "no hay dato en vivo", "faltan recursos", "no puede cobrar" son hechos del
 *   **negocio del tenant**, no de nuestras tablas. Un consultorio puede tener
 *   agenda propia o llevarla en su sistema clínico, y el código no distingue.
 * - `REG`, `MISCLASS`, `STOP`, `E2E`, `SEC`, `UX` **tampoco**: son decisiones de
 *   producto, de dominio o evidencia de campo.
 *
 * Lo que esto entrega no es "el backlog ejecutado": es el backlog **legible**,
 * que era lo que faltaba para poder ejecutarlo.
 */

/** Las alertas cuya vigencia el código puede contestar sin ayuda. */
export const DERIVABLE_ALERTS: readonly SubtypeAlert[] = Object.freeze(['WRITER']);

export type BacklogItemState =
    /** Se verificó y sigue siendo cierta. */
    | 'open'
    /** Se verificó y ya no lo es: se construyó después de la auditoría. */
    | 'stale'
    /** El código no puede contestarlo. Necesita una persona. */
    | 'needs_review';

export interface NativeBacklogItem {
    alert: SubtypeAlert;
    state: BacklogItemState;
    /** Por qué. Un estado sin motivo no se puede discutir ni cerrar. */
    detail: string;
}

export interface NativeBacklogEntry {
    profileId: string;
    strategy: string;
    items: NativeBacklogItem[];
}

/** Las escrituras de negocio que las familias de este perfil publican. */
export function businessWritersForProfile(industry: string, subtype: string): string[] {
    const profile = resolveSubtypeExperienceProfile(industry, subtype);
    const config = Object.fromEntries(
        profile.capability.toolGroups.map(group => [group, { enabled: true }]),
    );
    return staticToolsForAgentConfig(config)
        .map(tool => String(tool.name))
        .filter(isBusinessWriteTool);
}

function deriveItem(alert: SubtypeAlert, industry: string, subtype: string): NativeBacklogItem {
    if (alert !== 'WRITER') {
        return {
            alert,
            state: 'needs_review',
            detail: 'Es un hecho del negocio del tenant o una decisión de producto: '
                + 'el código no lo puede contestar.',
        };
    }
    const writers = businessWritersForProfile(industry, subtype);
    return writers.length
        ? {
            alert,
            state: 'stale',
            detail: `Tiene ${writers.length} escritura(s) de negocio: ${writers.join(', ')}.`,
        }
        : {
            alert,
            state: 'open',
            detail: 'Ninguna de sus familias de tools publica una escritura de negocio.',
        };
}

/**
 * El backlog de un perfil, con cada alerta clasificada.
 *
 * Devuelve también las `needs_review`: sacarlas dejaría un backlog que parece
 * más corto de lo que es, que es exactamente el problema que esto viene a
 * arreglar.
 */
export function deriveNativeBacklog(profileId: string): NativeBacklogEntry | null {
    const entry = (SUBTYPE_EXPERIENCE_PROFILES as Record<string, any>)[profileId];
    if (!entry) return null;
    const [industry, subtype] = profileId.split('/');
    return {
        profileId,
        strategy: entry.strategy,
        items: (entry.alerts ?? []).map((alert: SubtypeAlert) =>
            deriveItem(alert, industry, subtype)),
    };
}

/** El backlog nativo completo: sólo `build` y `hybrid`, que son los que lo tienen. */
export function deriveNativeBacklogAll(): NativeBacklogEntry[] {
    return Object.entries(SUBTYPE_EXPERIENCE_PROFILES as Record<string, any>)
        .filter(([, entry]) => entry.strategy === 'build' || entry.strategy === 'hybrid')
        .map(([id]) => deriveNativeBacklog(id)!)
        .filter(Boolean);
}

/** Cuántas de cada estado, para saber de qué tamaño es lo que queda. */
export function summariseNativeBacklog(): Record<BacklogItemState, number> {
    const summary: Record<BacklogItemState, number> = {
        open: 0, stale: 0, needs_review: 0,
    };
    for (const entry of deriveNativeBacklogAll()) {
        for (const item of entry.items) summary[item.state] += 1;
    }
    return summary;
}
