/**
 * F4300-58 (production QA 28-oct): «¿qué medios de pago aceptan?» was answered «efectivo, tarjeta, enlace de pago, PSE y
 * transferencia» at the restaurant (the order tool's enum) and «cash, credit/debit cards and possibly bank transfers» at the dental
 * clinic, in es/en/pt/fr — no FAQ, policy or document of either business says how it is paid. What the business accepts is a
 * fact of the business: said only when a read of the turn names it.
 *
 * When the customer asks how they can pay and the reply names payment methods none of the turn's reads mentions, the sentences
 * that name them (and the one that asks which of them the customer prefers) are replaced by «not recorded».
 */

export interface ToolRead { name?: string; result?: any }

const PAYMENT_ASK = /(?<!\p{L})(?:medios?\s+de\s+pago|formas?\s+de\s+pago|m[eé]todos?\s+de\s+pago|c[oó]mo\s+(?:se\s+)?(?:puedo\s+)?pag(?:o|ar)|aceptan\s+(?:tarjeta|efectivo|transferencia)|payment\s+methods?|ways?\s+to\s+pay|how\s+(?:can\s+I\s+|do\s+I\s+)?pay|(?:accept|take)\s+(?:cards?|cash)|formas?\s+de\s+pagamento|meios?\s+de\s+pagamento|como\s+(?:posso\s+)?pagar|aceitam\s+(?:cart[aã]o|pix|dinheiro)|moyens?\s+de\s+paiement|modes?\s+de\s+paiement|comment\s+(?:puis-je\s+)?payer|acceptez-vous\s+(?:la\s+)?carte)(?!\p{L})/iu;

const METHOD = /(?<!\p{L})(?:efectivo|tarjetas?|transferencias?(?:\s+bancarias?)?|pse|nequi|daviplata|enlace\s+de\s+pago|cash|cards?|credit|debit|bank\s+transfers?|transfers?|payment\s+link|dinheiro|cart[aã]o|cart[õo]es|pix|boleto|transfer[eê]ncias?|esp[eè]ces|cartes?\s+(?:bancaires?|de\s+cr[eé]dit)|carte|virements?|paypal)(?!\p{L})/iu;

const WHICH = /(?<!\p{L})(?:cu[aá]l\s+medio\s+de\s+pago|qu[eé]\s+medio\s+de\s+pago|which\s+(?:payment\s+method|one)\s+would\s+you|qual\s+forma\s+de\s+pagamento|quel\s+moyen\s+de\s+paiement)(?!\p{L})/iu;

const TEXT: Record<string, string> = {
    es: 'No consta en la información registrada qué medios de pago acepta el negocio.',
    en: 'The payment methods this business accepts are not recorded in the information I have.',
    pt: 'Não consta na informação registrada quais formas de pagamento o negócio aceita.',
    fr: 'Les informations enregistrées ne précisent pas les moyens de paiement acceptés.',
};

const fold = (text: string) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The text of everything the turn read (FAQs, policies, documents, records): where a method could be backed. */
function readText(reads: ReadonlyArray<ToolRead>): string {
    const parts: string[] = [];
    for (const read of reads || []) {
        if (!read?.result || read.result.error) continue;
        try { parts.push(JSON.stringify(read.result)); } catch { /* unserialisable read: no backing */ }
    }
    return fold(parts.join(' '));
}

export function unbackedPaymentCorrection(reply: string, customerText: string, reads: ReadonlyArray<ToolRead>, lang?: string): string | null {
    const text = String(reply || '');
    if (!PAYMENT_ASK.test(String(customerText || '')) || !METHOD.test(text)) return null;
    const backing = readText(reads);
    const sentences = text.split(/(?<=[.!?])\s+/);
    const named = sentences.flatMap(sentence => [...sentence.matchAll(new RegExp(METHOD.source, 'giu'))].map(m => fold(m[0])));
    // One method a read names is backing: the business recorded how it is paid.
    if (named.some(method => backing.includes(method.split(/\s+/)[0]))) return null;
    const code = String(lang || 'es').slice(0, 2);
    let placed = false;
    const out: string[] = [];
    for (const sentence of sentences) {
        if (METHOD.test(sentence) || WHICH.test(sentence)) {
            if (!placed) { out.push(TEXT[code] ?? TEXT.es); placed = true; }
            continue;
        }
        out.push(sentence);
    }
    return out.join(' ').trim();
}
