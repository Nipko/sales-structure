/**
 * Texto del aviso al cliente cuando el dueño responde una consulta pendiente (C0 §1.5, rebanada R5, ADR 0011).
 *
 * Un marco fijo en el idioma del cliente (es/en/pt/fr) con la respuesta del dueño tal cual: sin modelo, así que el aviso
 * no puede inventar nada que el dueño no escribió. Que el agente redacte la respuesta desde el valor guardado (C0 §1.5)
 * queda para la fase D (ADR 0011 §5).
 */
export type PendingLanguage = 'es' | 'en' | 'pt' | 'fr';

export function pendingLanguage(language: unknown, fallback: PendingLanguage = 'es'): PendingLanguage {
    const code = String(language ?? '').toLowerCase().slice(0, 2);
    return code === 'en' || code === 'pt' || code === 'fr' || code === 'es' ? code : fallback;
}

const FRAMES: Readonly<Record<PendingLanguage, (question: string, answer: string) => string>> = Object.freeze({
    es: (q, a) => `Hola, ya tenemos la respuesta a tu consulta «${q}»: ${a}`,
    en: (q, a) => `Hi, we have the answer to your question "${q}": ${a}`,
    pt: (q, a) => `Olá, já temos a resposta para a sua pergunta «${q}»: ${a}`,
    fr: (q, a) => `Bonjour, nous avons la réponse à votre question « ${q} » : ${a}`,
});

const clip = (text: string, max: number) => {
    const t = String(text ?? '').replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export function pendingAnswerText(language: unknown, input: { question: string; answer: string }): string {
    return FRAMES[pendingLanguage(language)](clip(input.question, 140), clip(input.answer, 900));
}

/**
 * Un valor guardado como texto legible cuando el dueño no escribió el mensaje para el cliente: el texto tal cual, una
 * lista separada por comas, un objeto como «campo: valor». Nunca JSON crudo.
 */
export function renderStoredValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.map(renderStoredValue).filter(Boolean).join(', ');
    if (typeof value === 'object') {
        return Object.entries(value as Record<string, unknown>)
            .map(([k, v]) => {
                const text = renderStoredValue(v);
                return text ? `${k.replace(/_/g, ' ')}: ${text}` : '';
            })
            .filter(Boolean).join('; ');
    }
    return '';
}

/** Lo que el agente le dice al cliente al aceptar «lo averiguo»: plazo en horas, redondeado hacia arriba. */
export function slaHours(slaDueAt: string | Date | null | undefined, now = new Date()): number | null {
    if (!slaDueAt) return null;
    const ms = new Date(slaDueAt).getTime() - now.getTime();
    return Number.isFinite(ms) ? Math.max(1, Math.ceil(ms / 3_600_000)) : null;
}
