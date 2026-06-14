/**
 * Client-facing i18n strings for recall.service.ts (re-engagement messages).
 * 4-language support: es / en / pt / fr
 * Fallback to 'es' for any unknown language code.
 *
 * Convention mirrors appointment-notifications-i18n.ts (APPT_MESSAGES + apptMsg).
 * Do NOT translate: log strings, technical keys, SQL, brand names.
 */

const RECALL_MESSAGES: Record<string, {
    defaultMessage: string;
    nameFallback: string;
}> = {
    es: {
        /**
         * Default re-engagement template.
         * Supports {name} and {months} placeholders.
         */
        defaultMessage: 'Hola {name}, ya pasaron {months} meses desde tu última visita. ¿Quieres agendar tu cita de control?',
        /**
         * Fallback greeting when the contact has no stored name.
         */
        nameFallback: 'estimado/a',
    },
    en: {
        defaultMessage: 'Hi {name}, it\'s been {months} months since your last visit. Would you like to book a follow-up appointment?',
        nameFallback: 'there',
    },
    pt: {
        defaultMessage: 'Olá {name}, já faz {months} meses desde a sua última visita. Gostaria de agendar uma consulta de acompanhamento?',
        nameFallback: 'prezado(a)',
    },
    fr: {
        defaultMessage: 'Bonjour {name}, cela fait {months} mois depuis votre dernière visite. Souhaitez-vous prendre un rendez-vous de suivi ?',
        nameFallback: 'cher(e) client(e)',
    },
};

/**
 * Normalise an arbitrary locale/language value to a 2-char code (es/en/pt/fr).
 * e.g. "es-CO" → "es", "EN" → "en", null → "es"
 */
export function normaliseRecallLang(raw: string | null | undefined): string {
    const code = (raw || 'es').substring(0, 2).toLowerCase();
    return RECALL_MESSAGES[code] ? code : 'es';
}

/**
 * Returns the default recall message template for the given language.
 * The caller is responsible for replacing {name} and {months}.
 */
export function recallDefaultMessage(lang: string | null | undefined): string {
    const code = normaliseRecallLang(lang);
    return RECALL_MESSAGES[code].defaultMessage;
}

/**
 * Returns the fallback name string for the given language (used when the
 * contact has no stored name).
 */
export function recallNameFallback(lang: string | null | undefined): string {
    const code = normaliseRecallLang(lang);
    return RECALL_MESSAGES[code].nameFallback;
}
