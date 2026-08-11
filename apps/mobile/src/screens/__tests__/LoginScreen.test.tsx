import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { LoginScreen } from '../LoginScreen';

const mockLogin = jest.fn();

jest.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({
        login: mockLogin,
        loginWithGoogle: jest.fn(),
        verifyTwoFactor: jest.fn(),
        sendTwoFactorEmail: jest.fn(),
    }),
}));

jest.mock('../../lib/useKeyboardSpace', () => ({ useKeyboardSpace: () => 0 }));
jest.mock('../../i18n', () => ({
    useI18n: () => ({
        t: (key: string) => ({
            'login.subtitle': 'Ingresa a tu cuenta',
            'login.email': 'Correo',
            'login.password': 'Contraseña',
            'login.signIn': 'Iniciar sesión',
            'login.signInError': 'No se pudo iniciar sesión',
            'login.forgot': 'Olvidé mi contraseña',
            'login.noAccount': '¿No tienes cuenta?',
            'login.noAccountCta': 'Crear cuenta',
        } as Record<string, string>)[key] || key,
    }),
}));
jest.mock('expo-constants', () => ({
    __esModule: true,
    default: { expoConfig: { extra: {} }, executionEnvironment: 'storeClient' },
}));
jest.mock('@react-native-google-signin/google-signin', () => ({
    GoogleSignin: { configure: jest.fn() },
    statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED' },
}));

describe('LoginScreen', () => {
    beforeEach(() => jest.clearAllMocks());

    it('si autenticación rechaza por cuerpo truncado, muestra error y siempre libera loading', async () => {
        mockLogin.mockRejectedValueOnce(new SyntaxError('Unexpected end of JSON input'));
        render(<LoginScreen />);

        fireEvent.changeText(screen.getByPlaceholderText('Correo'), 'agent@example.com');
        fireEvent.changeText(screen.getByPlaceholderText('Contraseña'), 'secret');
        fireEvent.press(screen.getByText('Iniciar sesión'));

        expect(await screen.findByText('No se pudo iniciar sesión')).toBeTruthy();
        await waitFor(() => expect(screen.getByText('Iniciar sesión')).toBeTruthy());
        expect(mockLogin).toHaveBeenCalledWith('agent@example.com', 'secret');
    });
});
