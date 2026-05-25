import { BadRequestException } from '@nestjs/common';

const DISPOSABLE_DOMAINS = new Set([
    'yopmail.com', 'yopmail.fr', 'yopmail.net',
    'mailinator.com',
    'tempmail.com', 'temp-mail.org', 'tempmail.net',
    'getnada.com',
    'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org',
    'dispostable.com',
    'sharklasers.com',
    '10minutemail.com',
    'trashmail.com', 'trashmail.de',
    'fakeinbox.com',
    'maildrop.cc',
    'mailnesia.com',
    'mintemail.com',
    'sharklasers.com',
    'guerrillamailblock.com',
    'guerrillamail.de',
    'pokemail.net',
    'grr.la',
]);

/**
 * Check if the email domain is in the disposable/temporary domains list.
 * Throws a BadRequestException if it is disposable.
 */
export function validateEmailDomain(email: string): void {
    if (!email) return;
    const domain = email.trim().toLowerCase().split('@')[1];
    if (domain && DISPOSABLE_DOMAINS.has(domain)) {
        throw new BadRequestException('El uso de correos electrónicos temporales o desechables (como yopmail, mailinator, etc.) está prohibido por razones de seguridad.');
    }
}
