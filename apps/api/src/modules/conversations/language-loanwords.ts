/**
 * English loanwords that Spanish, Portuguese and French customers and replies use every day in hospitality and commerce.
 * They are no evidence of ANY language. F4300-16 residual (production 24-oct, image b168adb0): «a qué hora es el
 * check-in?» after an English case was answered in English — «check-in» split into «check» and «in», and «in» counted
 * as an English word, so the stored English stayed.
 *
 * Hyphenated, spaced and joined spellings are all covered («check-in», «check in», «checkin», «e-mail», «wi-fi»).
 */
const LOANWORDS = /(?<![\p{L}\d])(?:check[\s-]?(?:in|out)s?|late[\s-]?check[\s-]?out|early[\s-]?check[\s-]?in|tours?|delivery|deliveries|on-?line|e-?mails?|wi-?fi|spas?|ok(?:ay|ey|i)?)(?![\p{L}\d])/giu;

/** The text with every loanword replaced by a space. */
export function withoutLoanwords(text: string): string {
    return String(text || '').replace(LOANWORDS, ' ');
}
