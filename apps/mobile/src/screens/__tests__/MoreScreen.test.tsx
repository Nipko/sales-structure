import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { MoreScreen } from '../MoreScreen';

const mockToastError = jest.fn();
const mockLogout = jest.fn();
const mockQueryResult = { data: { tasks: [] }, isLoading: false };

jest.mock('@react-navigation/native', () => ({
    useNavigation: () => ({ navigate: jest.fn() }),
}));

jest.mock('@tanstack/react-query', () => ({
    useQuery: () => mockQueryResult,
}));

jest.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({
        user: { id: 'agent-1', name: 'Agente demo', email: 'agent@example.com', role: 'tenant_agent' },
        tenantId: 'tenant-1',
        logout: mockLogout,
    }),
}));

jest.mock('../../components/Toast', () => ({
    useToast: () => ({ success: jest.fn(), error: mockToastError }),
}));

jest.mock('../../lib/api', () => ({ api: {} }));
jest.mock('../../lib/haptics', () => ({ haptic: { tap: jest.fn() } }));

jest.mock('../../i18n', () => {
    const labels: Record<string, string> = {
        'more.privacyPolicy': 'Política de privacidad',
        'more.requestAccountDeletion': 'Solicitar eliminación de cuenta y datos',
        'more.openLinkError': 'No se pudo abrir el enlace.',
    };
    return {
        useI18n: () => ({
            t: (key: string) => labels[key] || key,
            locale: 'es',
            setLocale: jest.fn(),
        }),
        SUPPORTED_LOCALES: ['es', 'en', 'pt', 'fr'],
        LOCALE_LABELS: { es: 'Español', en: 'English', pt: 'Português', fr: 'Français' },
    };
});

describe('MoreScreen legal links', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('expone y abre privacidad y eliminación de cuenta desde Cuenta', async () => {
        render(<MoreScreen />);

        fireEvent.press(screen.getByRole('link', { name: 'Política de privacidad' }));
        fireEvent.press(screen.getByRole('link', { name: 'Solicitar eliminación de cuenta y datos' }));

        await waitFor(() => {
            expect(Linking.openURL).toHaveBeenNthCalledWith(1, 'https://parallly-chat.cloud/privacy');
            expect(Linking.openURL).toHaveBeenNthCalledWith(2, 'https://parallly-chat.cloud/data-deletion');
        });
        expect(mockLogout).not.toHaveBeenCalled();
    });

    it('muestra un error localizado si el navegador no puede abrirse', async () => {
        jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error('unavailable'));
        render(<MoreScreen />);

        fireEvent.press(screen.getByRole('link', { name: 'Política de privacidad' }));

        await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('No se pudo abrir el enlace.'));
    });
});
