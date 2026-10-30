import {
    DEFAULT_SLA_MS, OPEN_STATUSES, nextStatus, normalizeQuestion, recordGapStatement, slaMsFrom, statusesAllowing, topicKeyFor,
    type PendingQuestionAction, type PendingQuestionStatus,
} from './pending-question-topic';

const ALL: PendingQuestionStatus[] = ['gap', 'open', 'answered', 'stored', 'closed', 'dismissed'];
const ACTIONS: PendingQuestionAction[] = ['wait', 'answer_once', 'store', 'dismiss', 'close'];

describe('pending_questions: máquina de estados (C0 §2.6)', () => {
    it('cada acción lleva solo desde los estados que el diseño permite', () => {
        const table = Object.fromEntries(ACTIONS.map(a => [a, Object.fromEntries(ALL.map(s => [s, nextStatus(s, a)]))]));
        expect(table).toEqual({
            wait: { gap: 'open', open: 'open', answered: null, stored: null, closed: null, dismissed: null },
            answer_once: { gap: 'answered', open: 'answered', answered: null, stored: null, closed: null, dismissed: null },
            store: { gap: 'stored', open: 'stored', answered: 'stored', stored: null, closed: null, dismissed: null },
            dismiss: { gap: 'dismissed', open: 'dismissed', answered: null, stored: null, closed: null, dismissed: null },
            close: { gap: null, open: null, answered: 'closed', stored: 'closed', closed: null, dismissed: null },
        });
    });

    it('closed y dismissed son finales; los abiertos son los del índice único parcial', () => {
        for (const a of ACTIONS) {
            expect(nextStatus('closed', a)).toBeNull();
            expect(nextStatus('dismissed', a)).toBeNull();
        }
        expect(OPEN_STATUSES).toEqual(['gap', 'open']);
        expect(statusesAllowing('store').sort()).toEqual(['answered', 'gap', 'open']);
    });
});

describe('pending_questions: deduplicación por topic_key', () => {
    it('la misma pregunta escrita distinto es el mismo tema', () => {
        expect(normalizeQuestion('¿Tienen PARQUEADERO?')).toBe('tienen parqueadero');
        const a = topicKeyFor({ question: '¿Tienen PARQUEADERO?' });
        expect(a).toMatch(/^q:[0-9a-f]{16}$/);
        expect(topicKeyFor({ question: 'tienen   parqueadero' })).toBe(a);
        expect(topicKeyFor({ question: 'Tienen parqueadéro!!' })).toBe(a);
        expect(topicKeyFor({ question: '¿Aceptan mascotas?' })).not.toBe(a);
    });

    it('con requisito, el tema es el requisito (y el ítem), no el texto', () => {
        expect(topicKeyFor({ question: '¿hay parqueo?', requirementId: 'CORE.LOCATION.PARKING' })).toBe('req:CORE.LOCATION.PARKING');
        expect(topicKeyFor({ question: 'otra forma de preguntarlo', requirementId: 'CORE.LOCATION.PARKING' })).toBe('req:CORE.LOCATION.PARKING');
        expect(topicKeyFor({ question: 'x', requirementId: 'OBJ.SERVICE.PRICE', itemRef: 'svc-12' })).toBe('req:OBJ.SERVICE.PRICE#svc-12');
        // un id que no parece un requisito no se usa como clave
        expect(topicKeyFor({ question: 'hola', requirementId: 'DROP TABLE' })).toMatch(/^q:/);
    });

    it('la sentencia del hueco suma una ocurrencia al tema abierto, o solo asegura la fila', () => {
        const counted = recordGapStatement({ question: '¿Tienen parqueadero?', source: 'retrieval', conversationId: '22222222-2222-4222-8222-222222222222' });
        expect(counted.sql).toContain(`ON CONFLICT (topic_key) WHERE status IN ('gap','open')`);
        expect(counted.sql).toContain('occurrences = pending_questions.occurrences + 1');
        expect(counted.params[3]).toBe(topicKeyFor({ question: 'tienen parqueadero' }));
        expect(counted.params[5]).toBe('22222222-2222-4222-8222-222222222222');
        expect(counted.params[7]).toBe('retrieval');
        const ensured = recordGapStatement({ question: 'x', source: 'agent', conversationId: 'not-a-uuid' }, { countOccurrence: false });
        expect(ensured.sql).not.toContain('occurrences = pending_questions.occurrences + 1');
        expect(ensured.params[5]).toBeNull();
    });
});

describe('SLA de CORE.PENDING.ROUTING', () => {
    it('lee {min, unit} y cae en 4 h (D10) si falta o es inválido', () => {
        expect(slaMsFrom({ sla: { min: 4, unit: 'h' } })).toBe(4 * 3_600_000);
        expect(slaMsFrom({ sla: { min: 30, unit: 'min' } })).toBe(30 * 60_000);
        expect(slaMsFrom({ sla: { min: 1, unit: 'd' } })).toBe(86_400_000);
        expect(slaMsFrom(null)).toBe(DEFAULT_SLA_MS);
        expect(slaMsFrom({ sla: { min: 0, unit: 'h' } })).toBe(DEFAULT_SLA_MS);
        expect(slaMsFrom({ sla: { min: 2, unit: 'años' } })).toBe(DEFAULT_SLA_MS);
    });
});
