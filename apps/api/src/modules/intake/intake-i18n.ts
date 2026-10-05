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

/**
 * Unambiguous single words — an opt-out in any message, of any length.
 * Each is wrapped in … word-boundary anchors.
 */
const OPT_OUT_WORDS: string[] = [
    'unsubscribe',
    'desuscribir',
    'desuscribirme',
    'desuscribanme',
    'desabonner',     // "se désabonner"
    'descadastrar',
];

/**
 * Ambiguous opt-out words. Policy while the owner decides: WHEN IN DOUBT,
 * OPT OUT (the record stays "pending" for review and an admin can reject it).
 * They count only when the message is, apart from courtesy filler, nothing but
 * that word (<= OPT_OUT_BARE_MAX_TOKENS tokens, no question mark): "stop",
 * "BAJA por favor gracias", "quiero salir". Any other content word ("salir
 * temprano", "baja temporada", "parar motores", "presion baja", "exit 5")
 * makes it ordinary vocabulary; those messages need an explicit phrase from
 * OPT_OUT_PHRASES. (cancelar is excluded: alone it means "cancel my appointment".)
 */
const OPT_OUT_BARE_WORDS: string[] = [
    'stop', 'baja', 'parar', 'salir', 'quitar', 'basta', 'exit', 'sair', 'arreter', 'arretez',
    'pare', 'parem',
];

/** Courtesy words that may accompany a bare opt-out word without changing its meaning. */
const OPT_OUT_BARE_FILLERS = new Set([
    'por', 'favor', 'please', 'pls', 'plz', 'ya', 'ahora', 'now', 'ja', 'agora',
    'svp', 'maintenant', 'merci', 'gracias', 'thanks', 'thank', 'you', 'obrigado', 'obrigada',
    'todo', 'todos', 'all', 'it', 'bye', 'chao', 'adios', 'hola', 'hi', 'hello', 'ok', 'okay',
    'tchau', 'si', 'yes', 'sim', 'oui',
    // lead-ins: "quiero salir", "i want to stop", "je veux arreter"
    'quiero', 'quero', 'necesito', 'want', 'to', 'i', 'me', 'je', 'veux', 'voudrais',
]);

/** A bare-word opt-out is at most this many tokens long. */
export const OPT_OUT_BARE_MAX_TOKENS = 5;

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
    'dar de baja',
    'dame de baja',
    'denme de baja',
    'quiero la baja',
    'deja de escribirme',
    'dejen de escribirme',
    'no me manden mas',
    'no quiero mas mensajes',
    'quitenme de la lista',
    'detener promociones',
    'no molesten mas',
    'no molestes mas',
    'parar promociones',
    'cancelar suscripcion',
    'quiero salir de la lista',
    'salir de la lista',
    'quitarme de la lista',
    'sacarme de la lista',
    'dejar de recibir',
    'eliminar mis datos',
    'borrar mis datos',
    'desuscribirme',
    // ── English ──────────────────────────────────
    'opt out',
    'opt-out',
    'do not contact',
    'remove me',
    'stop messaging',
    'stop promotions',
    'stop contacting',
    'stop sending',
    'stop texting',
    'leave me alone',
    'remove me from',
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
    'sair da lista',
    'quero parar de receber',
    'me tire da lista',
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
    'sortir de la liste',
    'me desinscrire',
    'retirer de la liste',
    'plus de messages',
];

/** Deduplicate the words list. */
const uniqueWords = [...new Set(OPT_OUT_WORDS)];
const uniqueBareWords = [...new Set(OPT_OUT_BARE_WORDS)];

/**
 * Compiled opt-out regex patterns — multi-language, built once at startup.
 * These are the patterns that count in a message of ANY length; the ambiguous
 * bare words are handled separately by `isOptOutMessage`.
 */
export const OPT_OUT_INTAKE_PATTERNS: RegExp[] = [
    // Unambiguous single words with word-boundary anchors
    ...uniqueWords.map(w => new RegExp(`\\b${w}\\b`, 'i')),
    // Multi-word phrases escaped and matched as substrings
    ...OPT_OUT_PHRASES.map(p =>
        new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
    ),
];

/**
 * Return true if the message text contains an opt-out signal in ANY supported language.
 *
 * - Explicit phrases and unambiguous words ("unsubscribe") count at any length.
 * - Ambiguous bare words ("stop", "baja", "salir", "sair", "arrêter"…) count
 *   only when the message is essentially just that word (<= 3 tokens, the
 *   rest being courtesy filler like "por favor").
 */
export function isOptOutMessage(text: string): boolean {
    if (!text) return false;
    // The patterns are written WITHOUT accents, and the input was tested raw —
    // so `não me contate` and `cancelar inscrição`, the ordinary spellings,
    // never matched. A withdrawal of consent that goes unheard is a compliance
    // failure, not a cosmetic one.
    const normalized = text
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .trim();
    if (OPT_OUT_INTAKE_PATTERNS.some(p => p.test(normalized))) return true;

    // A stop sign emoji on its own is a request to stop.
    if (/\u{1F6D1}/u.test(text) && normalized.replace(/[^a-zA-Z0-9]/g, '').length <= 12) return true;

    const tokens = normalized
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
    if (tokens.length === 0 || tokens.length > OPT_OUT_BARE_MAX_TOKENS) return false;
    // A question is a question, not a request ("puedo salir?", "stop?").
    if (/[?¿]/.test(text)) return false;
    // Courtesy filler carries no meaning; what is left must be only the keyword.
    const rest = tokens.filter(t => !OPT_OUT_BARE_FILLERS.has(t) || uniqueBareWords.includes(t));
    return rest.length > 0 && rest.every(t => uniqueBareWords.includes(t));
}
