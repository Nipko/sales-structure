import React from 'react';
import { Text, Pressable } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';

// Deterministic device locale + no native SecureStore in tests.
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'es' }] }));
jest.mock('expo-secure-store', () => ({
    getItemAsync: jest.fn().mockResolvedValue(null),
    setItemAsync: jest.fn().mockResolvedValue(undefined),
    deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

import { I18nProvider, useI18n } from '..';

function Probe() {
    const { t, setLocale } = useI18n();
    return (
        <>
            <Text>{t('login.signIn')}</Text>
            <Text>{t('crm.score', { n: 7 })}</Text>
            <Text>{t('clave.inexistente')}</Text>
            <Pressable onPress={() => setLocale('en')}><Text>switch</Text></Pressable>
        </>
    );
}

describe('i18n provider', () => {
    it('traduce (es por defecto), interpola y cae a la clave si no existe', () => {
        render(<I18nProvider><Probe /></I18nProvider>);
        expect(screen.getByText('Iniciar sesión')).toBeTruthy();
        expect(screen.getByText('score 7')).toBeTruthy();      // interpolación {n}
        expect(screen.getByText('clave.inexistente')).toBeTruthy(); // fallback a la clave
    });

    it('cambia de idioma con setLocale', () => {
        render(<I18nProvider><Probe /></I18nProvider>);
        fireEvent.press(screen.getByText('switch'));
        expect(screen.getByText('Sign in')).toBeTruthy();
    });
});
