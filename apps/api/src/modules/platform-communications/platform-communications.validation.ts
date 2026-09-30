import { BadRequestException } from '@nestjs/common';
import { isEmail, isUUID } from 'class-validator';
import { Prisma } from '@prisma/client';
import { emailLayout } from '../email/email-layouts';

export const LANGUAGES = ['es', 'en', 'pt', 'fr'] as const;
export type Language = typeof LANGUAGES[number];
export interface CommunicationContent { subject: string; body: string; ctaLabel?: string; ctaUrl?: string }
export type LocalizedContent = Partial<Record<Language, CommunicationContent>> & { es: CommunicationContent };
export interface CommunicationDraft {
    name: string;
    audience: 'all' | 'whatsapp_connected';
    recipientRole: 'all' | 'admins';
    tenantIds: string[];
    content: LocalizedContent;
}

export function invalid(code = 'COMMUNICATION_INVALID_INPUT'): never {
    throw new BadRequestException({ error: code, message: code });
}

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    return value as Record<string, unknown>;
}

function text(value: unknown, max: number): string {
    if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) invalid();
    return value.trim();
}

export function revision(value: unknown): number {
    if (!Number.isInteger(value) || Number(value) < 1) invalid();
    return value as number;
}

export function uuid(value: unknown): string {
    if (typeof value !== 'string' || !isUUID(value)) invalid();
    return value;
}

export function parseDraft(input: unknown): CommunicationDraft {
    const data = record(input);
    const name = text(data.name, 120);
    if (data.audience !== 'all' && data.audience !== 'whatsapp_connected') invalid();
    if (data.recipientRole !== 'all' && data.recipientRole !== 'admins') invalid();
    const rawIds = data.tenantIds ?? [];
    if (!Array.isArray(rawIds) || rawIds.length > 5000) invalid();
    const tenantIds = [...new Set(rawIds.map(uuid))];
    const translations = record(data.content);
    const content: Partial<Record<Language, CommunicationContent>> = {};
    for (const language of LANGUAGES) {
        if (translations[language] == null && language !== 'es') continue;
        const item = record(translations[language]);
        const subject = text(item.subject, 180);
        if (/[\r\n]/.test(subject)) invalid();
        const body = text(item.body, 30000);
        const rawUrl = item.ctaUrl || data.ctaUrl;
        let ctaUrl: string | undefined;
        let ctaLabel: string | undefined;
        if (rawUrl || item.ctaLabel) {
            ctaUrl = text(rawUrl, 2048);
            ctaLabel = text(item.ctaLabel, 100);
            let url: URL;
            try { url = new URL(ctaUrl); } catch { invalid('COMMUNICATION_INVALID_CTA'); }
            if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) invalid('COMMUNICATION_INVALID_CTA');
        }
        content[language] = { subject, body, ...(ctaUrl ? { ctaUrl, ctaLabel } : {}) };
    }
    return { name, audience: data.audience, recipientRole: data.recipientRole, tenantIds, content: content as LocalizedContent };
}

export function normalizeEmail(value: string): string | null {
    const email = value.trim().toLowerCase();
    return email.length <= 254 && isEmail(email) ? email : null;
}

export function contentLanguage(locale: string, content: LocalizedContent): Language {
    const code = locale.toLowerCase().split(/[-_]/)[0] as Language;
    return LANGUAGES.includes(code) && content[code] ? code : 'es';
}

export function audienceWhere(draft: Pick<CommunicationDraft, 'audience' | 'recipientRole' | 'tenantIds'>): Prisma.UserWhereInput {
    return {
        isActive: true,
        role: draft.recipientRole === 'admins' ? 'tenant_admin' : { in: ['tenant_admin', 'tenant_supervisor', 'tenant_agent'] },
        tenant: { is: {
            isActive: true,
            ...(draft.tenantIds.length ? { id: { in: draft.tenantIds } } : {}),
            ...(draft.audience === 'whatsapp_connected' ? { channelAccounts: { some: { channelType: 'whatsapp', isActive: true } } } : {}),
        } },
    };
}

export function renderContent(content: CommunicationContent, language: Language): { subject: string; text: string; html: string } {
    const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
    const paragraphs = content.body.split(/\n\s*\n/).map((p) => `<p style="line-height:1.7;color:#333;">${escape(p).replace(/\n/g, '<br>')}</p>`).join('');
    const cta = content.ctaUrl && content.ctaLabel
        ? `<p><a href="${escape(content.ctaUrl)}" style="display:inline-block;background:#3897f0;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;">${escape(content.ctaLabel)}</a></p>` : '';
    return {
        subject: content.subject,
        text: `${content.body}${content.ctaUrl ? `\n\n${content.ctaLabel}: ${content.ctaUrl}` : ''}`,
        html: emailLayout(`<h1 style="font-size:24px;line-height:1.3;">${escape(content.subject)}</h1>${paragraphs}${cta}`, undefined, language),
    };
}

export function pagination(page?: string, pageSize?: string) {
    const p = page === undefined ? 1 : Number(page);
    const size = pageSize === undefined ? 25 : Number(pageSize);
    if (!Number.isInteger(p) || p < 1 || p > 100000 || !Number.isInteger(size) || size < 1 || size > 100) invalid();
    return { page: p, pageSize: size, skip: (p - 1) * size };
}
