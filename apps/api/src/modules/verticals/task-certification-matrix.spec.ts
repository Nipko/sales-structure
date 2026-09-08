import { buildTaskCertificationMatrix, summariseTaskCertificationMatrix } from './task-certification-matrix';
import { EVAL_WRITER_SANDBOX_FAMILIES } from '../conversations/agent-test-tool-policy';

/**
 * La matriz que las auditorías venían transcribiendo a mano.
 *
 * «76 perfiles, 268 tareas, 146 transaccionales» se regeneraba en cada tanda y
 * se copiaba a la prosa. Acá se deriva de las mismas fuentes que usa el runtime,
 * así que la cifra es una consecuencia: si alguien agrega un perfil, renombra un
 * intent o audita un verificador, esta prueba se cae y la cifra se corrige en el
 * mismo commit que la movió, en vez de envejecer en un documento.
 */
const matrix = buildTaskCertificationMatrix();
const summary = summariseTaskCertificationMatrix(matrix);

describe('la matriz de tareas se calcula, no se transcribe', () => {
    it('reproduce el censo canónico: 76 perfiles, 268 tareas, 146 transaccionales', () => {
        expect(summary.profiles).toBe(76);
        expect(summary.tasks).toBe(268);
        expect(summary.transactional).toBe(146);
    });

    it('da a cada tarea capacidad, datos requeridos, dependencias y comandos', () => {
        // Una fila sin dependencias no es una tarea que el agente pueda intentar:
        // no tiene ni una lectura con la que empezar.
        const empty = matrix.filter(row => !row.dependencies.length).map(row => `${row.profileId}/${row.taskKey}`);
        expect(empty).toEqual([]);
        // Y una transaccional sin comando no compromete nada, que contradice su
        // propio contrato.
        const uncommitted = matrix
            .filter(row => row.transactional && !row.commands.length)
            .map(row => `${row.profileId}/${row.taskKey}`);
        expect(uncommitted).toEqual([]);
    });

    it('ninguna tarea queda sin escenario positivo ni negativo propio', () => {
        // Las auditorías registraban 32 tareas sin positivo propio. Hoy son cero,
        // y la lista —no el conteo— es lo que lo demuestra: un conteo que baja
        // puede ser un perfil que desapareció.
        expect(summary.withoutOwnPositive).toEqual([]);
        expect(summary.withoutOwnNegative).toEqual([]);
    });

    it('ninguna tarea compromete algo que la evaluación no pueda verificar', () => {
        // Eran 51 cuando la matriz empezó a calcularse: 41 porque el registro de
        // writers no decía lo que el adaptador aislado ya hacía —cancelar,
        // reprogramar, agendar una prueba de manejo— y 5 porque cotizar una
        // póliza escribe una tabla que el namespace arrendado no copiaba.
        expect(summary.withoutVerifier).toEqual([]);
    });

    it('separa lo que no tiene verificador de lo que no debe tenerlo', () => {
        // `file_claim` sólo existe en una evaluación para demostrar que el
        // step-up de identidad lo rechaza: nunca llega a un writer y nunca manda
        // un OTP desde una corrida. Pedirle un verificador de efecto sería pedir
        // que se compruebe algo cuyo contrato es que no se escribe nada.
        const kinds = [...new Set(summary.deliberatelyUnverifiable.map(entry => entry.split('/')[2]))].sort();
        expect(kinds).toEqual(['file_claim']);
        expect(summary.deliberatelyUnverifiable).toHaveLength(5);
    });

    it('no hereda un verificador: la familia tiene que nombrar el comando exacto', () => {
        // Que `create_appointment` esté auditado no verifica `cancel_appointment`
        // aunque escriban la misma tabla: verificar una cancelación es comprobar
        // una transición, no la existencia de una fila.
        const audited = new Set(Object.values(EVAL_WRITER_SANDBOX_FAMILIES)
            .filter(family => family.status === 'audited').flatMap(family => [...family.tools]));
        for (const row of matrix.filter(row => row.verifier === 'audited')) {
            expect(row.commands.some(command => audited.has(command))).toBe(true);
        }
    });

    it('no declara ningún perfil certificado', () => {
        // La certificación exige ejecutar los escenarios por modelo, idioma y
        // canal. Esta matriz dice qué existe, nunca qué se probó.
        expect(summary.certifiedProfiles).toBe(0);
    });
});
