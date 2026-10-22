import { claimsIdentityCodeSent, identityCodeSendBacked } from '../../common/utils/outcome-claim.util';
import { policyPersonOfferText } from './human-offer';

/**
 * F4300-02. A protected read answered `identity_verification_required` and the reply asked for «el código de 6 dígitos
 * que le fue enviado a su correo o teléfono» — no code had left (SMS retired, Telegram contact with no e-mail). The
 * customer could never complete it.
 *
 * A reply may say a verification code was sent only when a provider accepted one: a result of this turn says so
 * (`codeSent`, `request_identity_code` → `sent`), or a delivered code is still live for this conversation (a code sent in
 * an earlier turn). Anything else is replaced by the honest situation, in the customer's language, from what the turn's
 * results say: no channel to verify here, a send not confirmed yet, or no code sent at all. A person is OFFERED (a
 * question) when one is available; nothing is opened without the customer's yes.
 */
export type IdentityCodeSituation = 'unverifiable' | 'pending' | 'not_sent';

const UNVERIFIABLE_ERRORS = new Set(['identity_unverifiable', 'identity_locked', 'identity_context_required']);

export function identityCodeSituation(executed: ReadonlyArray<{ name?: string; result?: any }> | undefined): IdentityCodeSituation {
    const results = (executed || []).map(tool => tool?.result).filter(result => result && typeof result === 'object');
    if (results.some(result => UNVERIFIABLE_ERRORS.has(String(result.error)))) return 'unverifiable';
    if (results.some(result => result.codeDeliveryPending === true || result.pending === true && result.codeSent === false)) return 'pending';
    return 'not_sent';
}

const TEXTS: Record<string, Record<IdentityCodeSituation, string>> = {
    es: {
        unverifiable: 'Por seguridad necesito verificar su identidad antes de consultar esa información, y por este chat no puedo hacerlo en este momento, así que no le he enviado ningún código.',
        pending: 'Para consultar esa información necesito verificar su identidad, pero todavía no puedo confirmar que el código de verificación haya salido. Si le llega, escríbalo aquí.',
        not_sent: 'Para consultar esa información necesito verificar su identidad, y todavía no le he enviado ningún código de verificación.',
    },
    en: {
        unverifiable: 'For your security I need to verify your identity before checking that information, and I cannot do it in this chat right now, so I have not sent you any code.',
        pending: 'To check that information I need to verify your identity, but I cannot confirm yet that the verification code went out. If it reaches you, type it here.',
        not_sent: 'To check that information I need to verify your identity, and I have not sent you any verification code yet.',
    },
    pt: {
        unverifiable: 'Por segurança preciso verificar sua identidade antes de consultar essa informação, e por este chat não consigo fazer isso agora, então não enviei nenhum código.',
        pending: 'Para consultar essa informação preciso verificar sua identidade, mas ainda não consigo confirmar que o código de verificação foi enviado. Se ele chegar, escreva-o aqui.',
        not_sent: 'Para consultar essa informação preciso verificar sua identidade, e ainda não enviei nenhum código de verificação.',
    },
    fr: {
        unverifiable: 'Pour votre sécurité, je dois vérifier votre identité avant de consulter cette information, et je ne peux pas le faire dans ce chat pour le moment, je ne vous ai donc envoyé aucun code.',
        pending: 'Pour consulter cette information, je dois vérifier votre identité, mais je ne peux pas encore confirmer que le code de vérification est parti. S’il vous parvient, saisissez-le ici.',
        not_sent: 'Pour consulter cette information, je dois vérifier votre identité, et je ne vous ai encore envoyé aucun code de vérification.',
    },
};

const NO_PERSON: Record<string, string> = {
    es: 'Puede consultarlo directamente con el negocio.',
    en: 'You can check it directly with the business.',
    pt: 'Você pode consultar diretamente com o negócio.',
    fr: 'Vous pouvez le vérifier directement auprès de l’établissement.',
};

export function identityCodeHonestText(situation: IdentityCodeSituation, lang: string | undefined, canOfferPerson: boolean): string {
    const code = String(lang || 'es').slice(0, 2).toLowerCase();
    const texts = TEXTS[code] || TEXTS.es;
    return `${texts[situation]} ${canOfferPerson ? policyPersonOfferText(code) : (NO_PERSON[code] || NO_PERSON.es)}`;
}

export interface IdentityCodeClaimInput {
    reply: string;
    /** Every tool result of this turn (the model's loop, the engine, the pending-confirmation path). */
    executed: ReadonlyArray<{ name?: string; result?: any }> | undefined;
    lang?: string;
    canOfferPerson: boolean;
    /** A code a provider accepted is still live for this conversation and contact (a send of an earlier turn). */
    delivered: () => Promise<boolean>;
}

/** The reply, or the honest replacement when it claims a code that no provider accepted. */
export async function guardIdentityCodeClaim(input: IdentityCodeClaimInput): Promise<{ text: string; replaced: boolean; situation?: IdentityCodeSituation }> {
    if (!claimsIdentityCodeSent(input.reply) || identityCodeSendBacked(input.executed)) return { text: input.reply, replaced: false };
    let delivered = false;
    try { delivered = await input.delivered(); } catch { delivered = false; }
    if (delivered) return { text: input.reply, replaced: false };
    const situation = identityCodeSituation(input.executed);
    return { text: identityCodeHonestText(situation, input.lang, input.canOfferPerson), replaced: true, situation };
}
