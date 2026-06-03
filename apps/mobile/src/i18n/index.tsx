import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import * as Localization from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import { translations, SUPPORTED_LOCALES, type Locale } from './translations';

const STORE_KEY = 'app_locale';

function isSupported(code?: string | null): code is Locale {
    return !!code && (SUPPORTED_LOCALES as readonly string[]).includes(code);
}

/** Idioma del dispositivo (OS), recortado a los soportados; fallback 'es'. */
function deviceLocale(): Locale {
    try {
        const code = Localization.getLocales?.()[0]?.languageCode?.toLowerCase();
        return isSupported(code) ? code : 'es';
    } catch {
        return 'es';
    }
}

interface I18nApi {
    locale: Locale;
    t: (key: string, params?: Record<string, string | number>) => string;
    setLocale: (l: Locale) => void;
}

const I18nContext = createContext<I18nApi | null>(null);

/**
 * i18n del chrome del agente. Por defecto sigue el idioma del OS; el usuario puede
 * forzar otro desde "Más" (override persistido en SecureStore). Fallback: español.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
    const [locale, setLocaleState] = useState<Locale>(deviceLocale());

    // Carga el override persistido (si existe) tras el primer render.
    useEffect(() => {
        let active = true;
        SecureStore.getItemAsync(STORE_KEY)
            .then((saved) => { if (active && isSupported(saved)) setLocaleState(saved); })
            .catch(() => {});
        return () => { active = false; };
    }, []);

    const setLocale = useCallback((l: Locale) => {
        setLocaleState(l);
        SecureStore.setItemAsync(STORE_KEY, l).catch(() => {});
    }, []);

    const t = useCallback((key: string, params?: Record<string, string | number>) => {
        const dict = translations[locale] || translations.es;
        let str = dict[key] ?? translations.es[key] ?? key;
        if (params) for (const k of Object.keys(params)) str = str.replace(`{${k}}`, String(params[k]));
        return str;
    }, [locale]);

    const value = useMemo<I18nApi>(() => ({ locale, t, setLocale }), [locale, t, setLocale]);
    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Hook de traducción. Seguro fuera del provider (devuelve la clave / español). */
export function useI18n(): I18nApi {
    const ctx = useContext(I18nContext);
    if (ctx) return ctx;
    return {
        locale: 'es',
        t: (key) => translations.es[key] ?? key,
        setLocale: () => {},
    };
}

export { SUPPORTED_LOCALES, LOCALE_LABELS } from './translations';
export type { Locale } from './translations';
