/**
 * WhatsApp notification messages for appointment-notifications.service.ts
 * 4-language support: es / en / pt / fr
 * Fallback to 'es' for any unknown language code.
 *
 * Convention mirrors booking-engine.service.ts MESSAGES + msg().
 * Do NOT translate: log strings, technical keys, brand names.
 */

const APPT_MESSAGES: Record<string, Record<string, string>> = {
    es: {
        confirmTitle:   '✅ *Cita confirmada*',
        confirmGreeting: 'Hola {name}! Tu cita ha sido agendada:',
        confirmLocation: '📍 {location}',
        confirmMeeting:  '💻 Enlace de reunión: {url}',
        confirmFooter:   'Si necesitas cancelar o reprogramar, escríbenos con anticipación.',

        cancelTitle:    '❌ *Cita cancelada*',
        cancelBody:     'Tu cita de *{service}* del {date} ha sido cancelada.',
        cancelReason:   'Motivo: {reason}',
        cancelFooter:   'Si deseas reprogramar, no dudes en escribirnos.',
    },
    en: {
        confirmTitle:   '✅ *Appointment confirmed*',
        confirmGreeting: 'Hi {name}! Your appointment has been scheduled:',
        confirmLocation: '📍 {location}',
        confirmMeeting:  '💻 Meeting link: {url}',
        confirmFooter:   'If you need to cancel or reschedule, please let us know in advance.',

        cancelTitle:    '❌ *Appointment cancelled*',
        cancelBody:     'Your *{service}* appointment on {date} has been cancelled.',
        cancelReason:   'Reason: {reason}',
        cancelFooter:   'Feel free to reach out if you would like to reschedule.',
    },
    pt: {
        confirmTitle:   '✅ *Consulta confirmada*',
        confirmGreeting: 'Olá {name}! Seu agendamento foi realizado:',
        confirmLocation: '📍 {location}',
        confirmMeeting:  '💻 Link da reunião: {url}',
        confirmFooter:   'Se precisar cancelar ou reagendar, entre em contato com antecedência.',

        cancelTitle:    '❌ *Agendamento cancelado*',
        cancelBody:     'Seu agendamento de *{service}* do dia {date} foi cancelado.',
        cancelReason:   'Motivo: {reason}',
        cancelFooter:   'Se desejar reagendar, não hesite em nos escrever.',
    },
    fr: {
        confirmTitle:   '✅ *Rendez-vous confirmé*',
        confirmGreeting: 'Bonjour {name} ! Votre rendez-vous a été planifié :',
        confirmLocation: '📍 {location}',
        confirmMeeting:  '💻 Lien de réunion : {url}',
        confirmFooter:   'Si vous devez annuler ou reporter, contactez-nous à l\'avance.',

        cancelTitle:    '❌ *Rendez-vous annulé*',
        cancelBody:     'Votre rendez-vous *{service}* du {date} a été annulé.',
        cancelReason:   'Motif : {reason}',
        cancelFooter:   'N\'hésitez pas à nous écrire si vous souhaitez reporter.',
    },
};

/**
 * Normalise an arbitrary locale/language value to a 2-char code (es/en/pt/fr).
 * e.g. "es-CO" → "es", "EN" → "en", null → "es"
 */
export function normaliseLang(raw: string | null | undefined): string {
    const code = (raw || 'es').substring(0, 2).toLowerCase();
    return APPT_MESSAGES[code] ? code : 'es';
}

/**
 * Locale string for toLocaleDateString / toLocaleTimeString, keyed by 2-char lang.
 */
export const LANG_LOCALE: Record<string, string> = {
    es: 'es-CO',
    en: 'en-US',
    pt: 'pt-BR',
    fr: 'fr-FR',
};

/**
 * Retrieve a message for the given language with simple {placeholder} substitution.
 * Falls back to 'es' when the language is unknown or the key is missing.
 */
export function apptMsg(
    lang: string,
    key: string,
    vars: Record<string, string> = {},
): string {
    const code = normaliseLang(lang);
    const map = APPT_MESSAGES[code] ?? APPT_MESSAGES['es'];
    let text = map[key] ?? APPT_MESSAGES['es'][key] ?? key;

    for (const [k, v] of Object.entries(vars)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
    return text;
}
