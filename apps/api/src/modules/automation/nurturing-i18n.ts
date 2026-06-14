/**
 * Client-facing i18n strings for the nurturing (follow-up) service.
 *
 * Pattern mirrors HANDOFF_MSG / APPOINTMENT_REPLIES in conversations.service.ts:
 *   - Keyed by 2-letter language code (es | en | pt | fr).
 *   - Arrow functions for strings with placeholders.
 *   - `nurtureMsg(lang)` normalises the code and falls back to 'es'.
 *   - `LANG_NAME` maps codes to their natural-language name for LLM prompts.
 */

// ────────────────────────────────────────────────────────────────────────────
// Language names — used to instruct the LLM to reply in the customer's tongue.
// ────────────────────────────────────────────────────────────────────────────
export const LANG_NAME: Record<'es' | 'en' | 'pt' | 'fr', string> = {
    es: 'español',
    en: 'English',
    pt: 'português',
    fr: 'français',
};

// ────────────────────────────────────────────────────────────────────────────
// Message map
// ────────────────────────────────────────────────────────────────────────────
export const NURTURE_MSG: Record<'es' | 'en' | 'pt' | 'fr', {
    // generateBookingFollowUpText — fallback when LLM unavailable
    bookingFollowUpWithService: (name: string, svc: string, date?: string, time?: string) => string;
    bookingFollowUpNoService: (name: string) => string;

    // executeAttempt1 — no-persona default message
    attempt1Default: string;

    // executeAttempt1 — success fallback (LLM returned empty)
    attempt1SuccessFallback: string;

    // executeAttempt1 — catch fallback (LLM threw)
    attempt1CatchFallback: string;

    // executeAttempt2 — template text (outbound content)
    attempt2TemplateText: (name: string) => string;

    // executeAttempt2 — saved log text after template send
    attempt2SavedText: (name: string) => string;

    // executeAttempt2 — catch fallback (template send failed)
    attempt2CatchFallback: (name: string) => string;

    // executeAttempt3 — final message to customer
    attempt3FinalText: (name: string) => string;
}> = {
    // ── Español (neutro, LatAm) ───────────────────────────────────────────
    es: {
        bookingFollowUpWithService: (name, svc, date?, time?) =>
            `¡Hola${name}! 👋 Vi que estabas por agendar *${svc}*${date ? ` para el ${date}` : ''}${time ? ` a las ${time}` : ''} pero no llegamos a confirmarlo. ¿Quieres que lo terminemos de reservar?`,
        bookingFollowUpNoService: (name) =>
            `¡Hola${name}! 👋 Vi que estabas agendando una cita pero quedó a medias. ¿Seguimos? Estoy para ayudarte.`,

        attempt1Default:
            '¡Hola! Solo quería saber si tienes alguna duda adicional. Estoy aquí para ayudarte.',

        attempt1SuccessFallback:
            '¡Hola! ¿Pudiste revisar la información que te envié? Estoy aquí para resolver cualquier duda.',

        attempt1CatchFallback:
            '¡Hola! ¿Pudiste revisar la información que te envié? Quedo atento a cualquier pregunta.',

        attempt2TemplateText: (name) =>
            `Hola ${name}, queríamos recordarte que estamos aquí para ayudarte. ¿Tienes alguna pregunta adicional?`,

        attempt2SavedText: (name) =>
            `[Plantilla de seguimiento enviada] Hola ${name}, ¿pudiste revisar nuestra propuesta? Tenemos opciones que pueden interesarte.`,

        attempt2CatchFallback: (name) =>
            `Hola ${name}. Quería compartirte que tenemos opciones especiales disponibles. ¿Te gustaría que te cuente más? Estoy aquí para ayudarte a encontrar lo que necesitas.`,

        attempt3FinalText: (name) =>
            `Hola ${name}. Entendemos que estás ocupado/a. Si en algún momento necesitas información o tienes alguna pregunta, no dudes en escribirnos. ¡Estamos aquí para ayudarte!`,
    },

    // ── English ────────────────────────────────────────────────────────────
    en: {
        bookingFollowUpWithService: (name, svc, date?, time?) =>
            `Hi${name}! 👋 I noticed you were about to book *${svc}*${date ? ` for ${date}` : ''}${time ? ` at ${time}` : ''} but we didn't quite finish. Would you like to complete the booking?`,
        bookingFollowUpNoService: (name) =>
            `Hi${name}! 👋 I noticed you started booking an appointment but it wasn't completed. Shall we continue? I'm here to help.`,

        attempt1Default:
            `Hi! I just wanted to check if you have any additional questions. I'm here to help.`,

        attempt1SuccessFallback:
            `Hi! Were you able to review the information I sent you? I'm here to answer any questions.`,

        attempt1CatchFallback:
            `Hi! Were you able to review the information I sent you? I'm here for any questions you may have.`,

        attempt2TemplateText: (name) =>
            `Hello ${name}, we just wanted to remind you that we're here to help. Do you have any additional questions?`,

        attempt2SavedText: (name) =>
            `[Follow-up template sent] Hello ${name}, were you able to review our proposal? We have options that might interest you.`,

        attempt2CatchFallback: (name) =>
            `Hello ${name}. I wanted to let you know we have some special options available. Would you like to hear more? I'm here to help you find what you need.`,

        attempt3FinalText: (name) =>
            `Hello ${name}. We understand you've been busy. Whenever you need information or have any questions, don't hesitate to reach out. We're here to help!`,
    },

    // ── Português ──────────────────────────────────────────────────────────
    pt: {
        bookingFollowUpWithService: (name, svc, date?, time?) =>
            `Olá${name}! 👋 Percebi que você estava prestes a agendar *${svc}*${date ? ` para ${date}` : ''}${time ? ` às ${time}` : ''} mas não chegamos a confirmar. Quer que a gente finalize o agendamento?`,
        bookingFollowUpNoService: (name) =>
            `Olá${name}! 👋 Percebi que você começou a agendar uma consulta mas ficou pela metade. Continuamos? Estou aqui para ajudar.`,

        attempt1Default:
            'Olá! Só queria saber se você tem alguma dúvida adicional. Estou aqui para ajudar.',

        attempt1SuccessFallback:
            'Olá! Conseguiu revisar as informações que enviei? Estou aqui para responder qualquer dúvida.',

        attempt1CatchFallback:
            'Olá! Conseguiu revisar as informações que enviei? Fico à disposição para qualquer pergunta.',

        attempt2TemplateText: (name) =>
            `Olá ${name}, queríamos lembrá-lo(a) de que estamos aqui para ajudar. Tem alguma pergunta adicional?`,

        attempt2SavedText: (name) =>
            `[Modelo de acompanhamento enviado] Olá ${name}, conseguiu revisar nossa proposta? Temos opções que podem te interessar.`,

        attempt2CatchFallback: (name) =>
            `Olá ${name}. Queria te contar que temos opções especiais disponíveis. Gostaria de saber mais? Estou aqui para ajudar você a encontrar o que precisa.`,

        attempt3FinalText: (name) =>
            `Olá ${name}. Entendemos que você está ocupado(a). Sempre que precisar de informações ou tiver alguma dúvida, não hesite em nos escrever. Estamos aqui para ajudar!`,
    },

    // ── Français ───────────────────────────────────────────────────────────
    fr: {
        bookingFollowUpWithService: (name, svc, date?, time?) =>
            `Bonjour${name} ! 👋 J'ai remarqué que vous étiez sur le point de réserver *${svc}*${date ? ` pour le ${date}` : ''}${time ? ` à ${time}` : ''} mais nous n'avons pas finalisé. Souhaitez-vous terminer la réservation ?`,
        bookingFollowUpNoService: (name) =>
            `Bonjour${name} ! 👋 J'ai remarqué que vous avez commencé à prendre un rendez-vous mais il n'a pas été finalisé. On continue ? Je suis là pour vous aider.`,

        attempt1Default:
            'Bonjour ! Je voulais juste vérifier si vous avez des questions supplémentaires. Je suis là pour vous aider.',

        attempt1SuccessFallback:
            'Bonjour ! Avez-vous pu consulter les informations que je vous ai envoyées ? Je suis là pour répondre à vos questions.',

        attempt1CatchFallback:
            'Bonjour ! Avez-vous pu consulter les informations que je vous ai envoyées ? Je reste disponible pour toute question.',

        attempt2TemplateText: (name) =>
            `Bonjour ${name}, nous voulions vous rappeler que nous sommes là pour vous aider. Avez-vous des questions supplémentaires ?`,

        attempt2SavedText: (name) =>
            `[Modèle de suivi envoyé] Bonjour ${name}, avez-vous pu examiner notre proposition ? Nous avons des options qui pourraient vous intéresser.`,

        attempt2CatchFallback: (name) =>
            `Bonjour ${name}. Je voulais vous faire savoir que nous avons des options spéciales disponibles. Souhaitez-vous en savoir plus ? Je suis là pour vous aider à trouver ce qu'il vous faut.`,

        attempt3FinalText: (name) =>
            `Bonjour ${name}. Nous comprenons que vous êtes occupé(e). Quand vous aurez besoin d'informations ou si vous avez des questions, n'hésitez pas à nous écrire. Nous sommes là pour vous aider !`,
    },
};

// ────────────────────────────────────────────────────────────────────────────
// Getter — normalises lang to 2 chars, falls back to 'es'.
// ────────────────────────────────────────────────────────────────────────────
type SupportedLang = 'es' | 'en' | 'pt' | 'fr';
const SUPPORTED = new Set<SupportedLang>(['es', 'en', 'pt', 'fr']);

export function nurtureMsg(lang?: string): typeof NURTURE_MSG['es'] {
    const code = (lang || 'es').slice(0, 2).toLowerCase() as SupportedLang;
    return NURTURE_MSG[SUPPORTED.has(code) ? code : 'es'];
}
