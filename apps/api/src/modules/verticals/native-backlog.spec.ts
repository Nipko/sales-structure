import { SUBTYPE_EXPERIENCE_PROFILES } from '@parallext/shared';
import {
    DERIVABLE_ALERTS,
    businessWritersForProfile,
    deriveNativeBacklog,
    deriveNativeBacklogAll,
    summariseNativeBacklog,
} from './native-backlog';

/**
 * ═══ EL BACKLOG NATIVO ERA UNA FOTO DE JULIO PRESENTADA COMO ESTADO ACTUAL ═══
 *
 * Cada perfil lleva `alerts`, y su propio comentario lo dice: son hallazgos de
 * auditoría **copiados literalmente**, para poder trazar una decisión hasta lo
 * que la produjo. Son procedencia, no estado — y no había ningún campo que
 * dijera cuáles siguen abiertas.
 *
 * Con lo cual "ejecutar el backlog nativo de los 31 `build` y 23 `hybrid`" era,
 * literalmente, **incontestable**: la lista mezcla lo que sigue faltando con lo
 * que se construyó después de que la auditoría se escribiera, y nadie puede
 * distinguirlo mirándola.
 *
 * Lo medido: las cuatro alertas `WRITER` —"este perfil no tiene escritor"— eran
 * **falsas**. Los cuatro perfiles tenían entre tres y cuatro escrituras de
 * negocio, construidas después. La alerta seguía ahí.
 */

const BUILD_AND_HYBRID = Object.entries(SUBTYPE_EXPERIENCE_PROFILES as Record<string, any>)
    .filter(([, e]) => e.strategy === 'build' || e.strategy === 'hybrid');

describe('el backlog cubre exactamente los perfiles que lo tienen', () => {
    it('son los 31 `build` y los 23 `hybrid`', () => {
        const backlog = deriveNativeBacklogAll();
        expect(backlog.length).toBe(BUILD_AND_HYBRID.length);
        expect(backlog.length).toBe(54);
    });

    it('un perfil `stop` o `integrate` no entra', () => {
        const ids = deriveNativeBacklogAll().map(e => e.profileId);
        expect(ids).not.toContain('finanzas/fintech');
        expect(ids).not.toContain('salud/medica_general');
    });

    it('un perfil que no existe devuelve nada, no un backlog vacío', () => {
        // Un backlog vacío se lee como "no le falta nada", que es lo contrario
        // de "no sé quién es".
        expect(deriveNativeBacklog('rubro/inventado')).toBeNull();
    });
});

describe('cada alerta dice si sigue abierta, y por qué', () => {
    it('ninguna queda sin clasificar', () => {
        for (const entry of deriveNativeBacklogAll()) {
            for (const item of entry.items) {
                expect(['open', 'stale', 'needs_review']).toContain(item.state);
                // Un estado sin motivo no se puede discutir ni cerrar.
                expect(item.detail.length).toBeGreaterThan(10);
            }
        }
    });

    it('lo que el código no puede contestar se dice, no se supone', () => {
        // Cerrar por decreto lo que hay que ir a mirar sería peor que la foto
        // vieja: al menos la foto no mentía sobre su propia fecha.
        const summary = summariseNativeBacklog();
        expect(summary.needs_review).toBeGreaterThan(0);
        for (const entry of deriveNativeBacklogAll()) {
            for (const item of entry.items) {
                if (DERIVABLE_ALERTS.includes(item.alert)) continue;
                expect({ alert: item.alert, state: item.state })
                    .toEqual({ alert: item.alert, state: 'needs_review' });
            }
        }
    });

    it('la lista de derivables es corta y explícita', () => {
        // Si creciera sin que nadie lo piense, el backlog empezaría a cerrarse
        // solo con derivaciones flojas.
        expect(DERIVABLE_ALERTS).toEqual(['WRITER']);
    });
});

describe('las cuatro alertas `WRITER` eran falsas y ya no están', () => {
    it('ningún perfil declara `WRITER` hoy', () => {
        const stillDeclared = BUILD_AND_HYBRID
            .filter(([, e]) => (e.alerts ?? []).includes('WRITER'))
            .map(([id]) => id);
        expect(stillDeclared).toEqual([]);
    });

    it.each([
        ['moda_belleza/spa', 3],
        ['automotriz/alquiler', 3],
        ['pet_services/guarderia', 4],
        ['pet_services/hotel', 4],
    ])('%s tiene %i escritura(s) de negocio', (id, expected) => {
        // Es la evidencia de por qué la alerta se sacó: no un juicio, un conteo.
        const [industry, subtype] = id.split('/');
        expect(businessWritersForProfile(industry, subtype).length).toBe(expected);
    });

    it('un perfil de captación puede legítimamente no tener escritores', () => {
        // Sacar la alerta no significa que todos escriban: significa que esos
        // cuatro sí. Un perfil que sólo capta interés no necesita escribir nada.
        const captacion = Object.entries(SUBTYPE_EXPERIENCE_PROFILES as Record<string, any>)
            .find(([, e]) => e.scope === 'captacion' && e.strategy !== 'stop');
        expect(captacion).toBeDefined();
    });
});

describe('el resumen dice de qué tamaño es lo que queda', () => {
    it('cuenta los tres estados sin perder ninguno', () => {
        const summary = summariseNativeBacklog();
        const total = summary.open + summary.stale + summary.needs_review;
        const declared = deriveNativeBacklogAll()
            .reduce((n, entry) => n + entry.items.length, 0);
        expect(total).toBe(declared);
    });

    it('el backlog no está vacío: si lo estuviera, esto pasaría en verde por nada', () => {
        expect(summariseNativeBacklog().needs_review).toBeGreaterThan(50);
    });
});
