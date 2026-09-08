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

    it('enumera exactamente qué tareas comprometen algo que la evaluación no puede verificar', () => {
        // El hueco real, con nombre. Son cuatro tipos de tarea: cancelar una
        // cita, agendar una prueba de manejo, cotizar una póliza y abrir un
        // siniestro. Ninguna tiene una familia AUDITADA en el registro de
        // writers de evaluación, así que el gate no puede comprobar el efecto
        // que dicen producir.
        const kinds = [...new Set(summary.withoutVerifier.map(entry => entry.split('/')[2].split(' ')[0]))].sort();
        expect(kinds).toEqual(['cancel_appointment', 'file_claim', 'quote_policy', 'schedule_test_drive']);
        expect(summary.withoutVerifier).toHaveLength(51);
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
