import type { RequiredField } from '@parallext/shared';

/**
 * Los datos que el agente tiene que pedir antes de cerrar algo.
 *
 * El contrato es `Record<contexto, RequiredField[]>` y el renderer salta
 * cualquier valor que no sea un arreglo. Trece plantillas verticales guardaban
 * en cambio `{ name: { required: true }, phone: { required: true } }` — una
 * forma que nunca fue la del contrato — así que se descartaban en silencio: NI
 * UN SOLO `requiredField` vertical llegaba al prompt efectivo. Y aunque la
 * forma hubiera sido correcta, la sección entera se suprimía cuando Agenda
 * estaba activa, que es el caso de casi todas esas plantillas.
 *
 * Este normalizador acepta las dos formas y traduce la vieja usando preguntas
 * de identidad que ya son las mismas en todos los rubros. Una clave heredada
 * que no esté en la tabla se descarta: inventarle una pregunta al dueño sería
 * poner en boca del agente algo que nadie escribió.
 */

/** Contexto por defecto de una declaración heredada, que no traía ninguno. */
export const LEGACY_REQUIRED_FIELD_CONTEXT = 'general';

/**
 * Datos que el motor determinista de reservas ya recolecta por su cuenta.
 *
 * Con Agenda activa, repetirlos en el prompt es pedirle al modelo que compita
 * con el motor por el mismo turno — que es la razón por la que la sección se
 * suprimía entera. Suprimir SOLO estos deja pasar lo que el motor no pregunta
 * (un correo, un NIT, una dirección) en vez de tirar todo.
 */
export const APPOINTMENT_ENGINE_OWNED_FIELDS: readonly string[] = Object.freeze(['name', 'phone']);

/** Preguntas de identidad, iguales en cualquier rubro. */
const LEGACY_FIELD_QUESTIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
    name: {
        es: '¿A nombre de quién lo registro?',
        en: 'What name should I put it under?',
        pt: 'Em nome de quem eu registro?',
        fr: 'À quel nom dois-je l’enregistrer ?',
    },
    phone: {
        es: '¿A qué número te escribimos?',
        en: 'What number should we reach you on?',
        pt: 'Para qual número falamos com você?',
        fr: 'À quel numéro pouvons-nous vous joindre ?',
    },
    email: {
        es: '¿A qué correo te lo enviamos?',
        en: 'Which email should we send it to?',
        pt: 'Para qual e-mail enviamos?',
        fr: 'À quelle adresse e-mail devons-nous l’envoyer ?',
    },
});

function questionFor(field: string, language: string): string | null {
    const questions = LEGACY_FIELD_QUESTIONS[field];
    if (!questions) return null;
    return questions[language] || questions.es;
}

function isRequiredFieldArray(value: unknown): value is RequiredField[] {
    return Array.isArray(value)
        && value.every((entry) => !!entry && typeof entry === 'object'
            && typeof (entry as any).field === 'string'
            && typeof (entry as any).question === 'string');
}

export interface NormalizeRequiredFieldsOptions {
    /** Idioma del agente, para las preguntas de la forma heredada. */
    language?: string;
    /**
     * Con Agenda activa se descartan los campos que el motor ya pregunta.
     * El resto pasa: un correo sigue haciendo falta y el motor no lo pide.
     */
    appointmentsEnabled?: boolean;
}

export function normalizeRequiredFields(
    value: unknown,
    options: NormalizeRequiredFieldsOptions = {},
): Record<string, RequiredField[]> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const language = (options.language || 'es').trim().slice(0, 2).toLowerCase();
    const dropEngineOwned = options.appointmentsEnabled === true;

    const normalized: Record<string, RequiredField[]> = {};
    const legacy: RequiredField[] = [];

    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (isRequiredFieldArray(entry)) {
            const fields = entry.filter(
                (field) => !dropEngineOwned || !APPOINTMENT_ENGINE_OWNED_FIELDS.includes(field.field),
            );
            if (fields.length) normalized[key] = fields;
            continue;
        }
        // Forma heredada: la clave ES el campo y el valor dice si es obligatorio.
        if (entry && typeof entry === 'object' && 'required' in (entry as any)) {
            if ((entry as any).required !== true) continue;
            if (dropEngineOwned && APPOINTMENT_ENGINE_OWNED_FIELDS.includes(key)) continue;
            const question = questionFor(key, language);
            if (!question) continue;
            legacy.push({ field: key, question });
        }
    }

    if (legacy.length) {
        normalized[LEGACY_REQUIRED_FIELD_CONTEXT] = [
            ...(normalized[LEGACY_REQUIRED_FIELD_CONTEXT] || []),
            ...legacy,
        ];
    }
    return normalized;
}
