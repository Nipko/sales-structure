/**
 * Parallly — Intake module i18n
 *
 * Lang-keyed message map for user-facing strings in intake flows.
 * Mirrors the MESSAGES + msg() pattern from booking-engine.service.ts.
 *
 * Conventions:
 *  - imsg() normalises the lang (first 2 chars, e.g. "es-CO" → "es") and falls back to "es".
 *  - Placeholders use single braces: {field}.
 *  - Logs / internal strings are intentionally NOT translated.
 *
 * Opt-out patterns:
 *  - OPT_OUT_WORDS   — single words matched with word boundaries (\b) to avoid false positives.
 *  - OPT_OUT_PHRASES — multi-word phrases matched as substrings (specific enough to be safe).
 *  - All languages are merged into a single flat list so one call covers every locale.
 *  - The "stop" word is shared across EN / FR / PT and is already in the ES list.
 */

// ─── Message map ────────────────────────────────────────────────────────────

const INTAKE_MSG: Record<'es' | 'en' | 'pt' | 'fr', Record<string, string>> = {
    es: {
        // Form validation — processFormSubmission / captureFromForm
        'form.notFound':     'Definición de formulario no encontrada.',
        'form.missingFields': 'Faltan campos requeridos (nombre, email, teléfono).',
        'form.consentRequired': 'El consentimiento es requerido para capturar el lead.',
        'form.invalidPhone': 'El número de teléfono no tiene un formato válido.',
        'form.thankYou':     '¡Gracias por registrarte!',
        'form.genericError': 'Se produjo un error al procesar el formulario.',
    },
    en: {
        'form.notFound':     'Form definition not found.',
        'form.missingFields': 'Missing required fields (name, email, phone).',
        'form.consentRequired': 'Consent is required to capture the lead.',
        'form.invalidPhone': 'The phone number format is not valid.',
        'form.thankYou':     'Thanks for signing up!',
        'form.genericError': 'An error occurred while processing the form.',
    },
    pt: {
        'form.notFound':     'Definição de formulário não encontrada.',
        'form.missingFields': 'Campos obrigatórios ausentes (nome, e-mail, telefone).',
        'form.consentRequired': 'O consentimento é necessário para capturar o lead.',
        'form.invalidPhone': 'O formato do número de telefone não é válido.',
        'form.thankYou':     'Obrigado por se cadastrar!',
        'form.genericError': 'Ocorreu um erro ao processar o formulário.',
    },
    fr: {
        'form.notFound':     'Définition de formulaire introuvable.',
        'form.missingFields': 'Champs obligatoires manquants (nom, e-mail, téléphone).',
        'form.consentRequired': 'Le consentement est requis pour capturer le lead.',
        'form.invalidPhone': 'Le format du numéro de téléphone n\'est pas valide.',
        'form.thankYou':     'Merci pour votre inscription !',
        'form.genericError': 'Une erreur s\'est produite lors du traitement du formulaire.',
    },
};

/** Supported intake languages after normalisation. */
type IntakeLang = keyof typeof INTAKE_MSG;

/**
 * Resolve a translated intake string.
 *
 * @param lang  Raw language tag (e.g. "es-CO", "en", "pt-BR"). First 2 chars are used.
 * @param key   Message key (e.g. "form.missingFields").
 * @returns     Translated string. Falls back to "es", then to the key itself.
 */
export function imsg(lang: string | undefined | null, key: string): string {
    const code = ((lang ?? 'es').substring(0, 2).toLowerCase()) as IntakeLang;
    const dict = INTAKE_MSG[code] ?? INTAKE_MSG.es;
    return dict[key] ?? INTAKE_MSG.es[key] ?? key;
}

// ─── Multi-language opt-out patterns ────────────────────────────────────────
//
// Strategy: one flat pattern list covers ALL supported languages.
// This means a customer can opt out regardless of the language they write in —
// no language detection needed before the compliance check.
//
// Word-boundary (\b) is used for single words to prevent false positives:
//   "baja" must not match "trabajan", "stop" must not match "stoppage".
//
// Phrases are escaped and matched as substrings (they're specific enough).

/** Single words — each is wrapped in \b…\b word-boundary anchors. */
const OPT_OUT_WORDS: string[] = [
    // ── Spanish ──────────────────────────────────
    'stop',           // also shared EN/FR (universal SMS opt-out keyword)
    'baja',           // "darme de baja"
    'parar',
    'salir',
    'quitar',
    'desuscribir',
    // ── English ──────────────────────────────────
    'unsubscribe',
    // ── French ───────────────────────────────────
    'desabonner',     // "se désabonner"
    // NOTE: ambiguous bare verbs (cancelar / sair / arreter) are intentionally
    // NOT single-word triggers — in the live all-channels pipeline they usually
    // mean "cancel my appointment", "I'm leaving now" or "stop working", not
    // "stop messaging me". The qualified phrases below ('cancelar inscricao',
    // 'quero sair da lista', 'arreter les messages', …) capture the real opt-out
    // intent in each language without those false positives.
];

/** Multi-word phrases — matched as literal substrings (case-insensitive). */
const OPT_OUT_PHRASES: string[] = [
    // ── Spanish ──────────────────────────────────
    'no quiero recibir',
    'no quiero que me contacten',
    'no quiero mensajes',
    'no me contactes',
    'no contactar',
    'no me escribas',
    'no me escriban',
    'darme de baja',
    'cancelar suscripcion',
    'quiero salir',
    'eliminar mis datos',
    'borrar mis datos',
    'desuscribirme',
    // ── English ──────────────────────────────────
    'opt out',
    'opt-out',
    'do not contact',
    'remove me',
    'stop messaging',
    'stop contacting',
    'unsubscribe me',
    'take me off',
    'do not send',
    'no more messages',
    'cancel subscription',
    // ── Portuguese ───────────────────────────────
    'nao me contate',          // "não me contate"
    'nao me envie',            // "não me envie"
    'remover meu cadastro',
    'cancelar inscricao',      // "cancelar inscrição"
    'quero sair da lista',
    'quero me descadastrar',
    'parar de receber',
    'nao receber mais',
    // ── French ───────────────────────────────────
    'ne pas contacter',
    'ne plus contacter',
    'arreter les messages',    // "arrêter les messages"
    'se desabonner',           // "se désabonner"
    'desabonnement',           // "désabonnement"
    'supprimer mes donnees',   // "supprimer mes données"
    'retirer mon consentement',
    'ne plus recevoir',
    'plus de messages',
];

/** Deduplicate the words list (e.g. "parar" was listed twice for clarity). */
const uniqueWords = [...new Set(OPT_OUT_WORDS)];

/**
 * Compiled opt-out regex patterns — multi-language, built once at startup.
 *
 * Exported so callers (intake.service.ts, compliance.service.ts) can reuse
 * the same compiled list without duplicating the word/phrase arrays.
 */
export const OPT_OUT_INTAKE_PATTERNS: RegExp[] = [
    // Single words with word-boundary anchors
    ...uniqueWords.map(w => new RegExp(`\\b${w}\\b`, 'i')),
    // Multi-word phrases escaped and matched as substrings
    ...OPT_OUT_PHRASES.map(p =>
        new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
    ),
];

/**
 * Return true if the message text contains an opt-out signal in ANY supported language.
 */
export function isOptOutMessage(text: string): boolean {
    if (!text) return false;
    const trimmed = text.trim();
    return OPT_OUT_INTAKE_PATTERNS.some(p => p.test(trimmed));
}
