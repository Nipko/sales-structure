export const locales = ['es', 'en', 'pt', 'fr'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'es';

export const localeNames: Record<Locale, string> = {
    es: 'Español',
    en: 'English',
    pt: 'Português',
    fr: 'Français',
};

export const localeFlags: Record<Locale, string> = {
    es: '🇪🇸',
    en: '🇺🇸',
    pt: '🇧🇷',
    fr: '🇫🇷',
};
