import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { MoreScreen } from '../MoreScreen';

const mockToastError = jest.fn();
const mockLogout = jest.fn();
const mockSetAvailability = jest.fn();
const mockRefetch = jest.fn();
const mockResolutionStats = jest.fn();
const mockOverviewKpis = jest.fn();
const mockAgentsStatus = jest.fn();
const mockTasks = jest.fn();
let mockQueryResult: any;
let mockQueryOptions: any;
let mockRole: string | undefined;

jest.mock('@react-navigation/native', () => ({
    useNavigation: () => ({ navigate: jest.fn() }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@tanstack/react-query', () => ({
    useQuery: (options: any) => { mockQueryOptions = options; return mockQueryResult; },
}));

jest.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({
        user: { id: 'agent-1', name: 'Agente demo', email: 'agent@example.com', role: mockRole },
        tenantId: 'tenant-1',
        logout: mockLogout,
    }),
}));

jest.mock('../../components/Toast', () => ({
    useToast: () => ({ success: jest.fn(), error: mockToastError }),
}));

jest.mock('../../lib/api', () => ({
    api: {
        setAvailability: (...args: any[]) => mockSetAvailability(...args),
        getResolutionStats: (...args: any[]) => mockResolutionStats(...args),
        getOverviewKpis: (...args: any[]) => mockOverviewKpis(...args),
        getAgentsStatus: (...args: any[]) => mockAgentsStatus(...args),
        getTasks: (...args: any[]) => mockTasks(...args),
    },
    requireApiSuccess: (result: any) => {
        if (!result?.success) throw new Error(result?.error || 'request_failed');
        return result;
    },
}));
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
        mockRole = 'tenant_agent';
        mockResolutionStats.mockResolvedValue({ success: true, data: { summary: { aiResolutionRate: 80 } } });
        mockOverviewKpis.mockResolvedValue({ success: true, data: { totalConversations: 5 } });
        mockAgentsStatus.mockResolvedValue({ success: true, data: [] });
        mockTasks.mockResolvedValue({ success: true, data: [] });
        mockQueryResult = { data: { tasks: [], analyticsError: false }, isLoading: false, isError: false, refetch: mockRefetch };
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

    it('revierte la disponibilidad y no acepta un success:false como éxito', async () => {
        mockSetAvailability.mockResolvedValueOnce({ success: false, error: 'server_rejected' });
        render(<MoreScreen />);

        fireEvent.press(screen.getByRole('button', { name: 'more.status.away' }));

        await waitFor(() => {
            expect(mockToastError).toHaveBeenCalledWith('more.availabilityError');
            expect(screen.getByRole('button', { name: 'more.status.online' }).props.accessibilityState.selected).toBe(true);
            expect(screen.getByRole('button', { name: 'more.status.away' }).props.accessibilityState.selected).toBe(false);
        });
    });

    it('no presenta un fallo del loader como estado online o lista de tareas vacía', () => {
        mockQueryResult = { data: undefined, isLoading: false, isError: true, refetch: mockRefetch };
        render(<MoreScreen />);

        expect(screen.getByText('common.loadError')).toBeTruthy();
        expect(screen.queryByText('more.noTasks')).toBeNull();
        expect(screen.queryByRole('button', { name: 'more.status.online' })).toBeNull();

        fireEvent.press(screen.getByRole('button', { name: 'common.retry' }));
        expect(mockRefetch).toHaveBeenCalledTimes(1);
    });

    it.each(['tenant_agent', 'tenant_viewer', 'unknown', undefined])(
        'no consulta ni muestra analítica para el rol %s', async (role) => {
            mockRole = role;
            // Even cached privileged data must not reveal the performance section.
            mockQueryResult.data.stats = { aiResolutionRate: 80 };
            render(<MoreScreen />);

            const result = await mockQueryOptions.queryFn();

            expect(mockResolutionStats).not.toHaveBeenCalled();
            expect(mockOverviewKpis).not.toHaveBeenCalled();
            expect(mockAgentsStatus).toHaveBeenCalledWith('tenant-1');
            expect(mockTasks).toHaveBeenCalledWith('tenant-1', 'assignedTo=agent-1&status=pending');
            expect(result.analyticsError).toBe(false);
            expect(result.stats).toBeNull();
            expect(screen.queryByText('more.performance')).toBeNull();
            expect(screen.getByText('more.availability')).toBeTruthy();
        },
    );

    it.each(['tenant_admin', 'tenant_supervisor', 'super_admin'])(
        'mantiene la consulta y sección de analítica para %s', async (role) => {
            mockRole = role;
            render(<MoreScreen />);

            await mockQueryOptions.queryFn();

            expect(mockResolutionStats).toHaveBeenCalledWith('tenant-1', expect.any(String), expect.any(String));
            expect(mockOverviewKpis).toHaveBeenCalledWith('tenant-1', expect.any(String), expect.any(String));
            expect(screen.getByText('more.performance')).toBeTruthy();
        },
    );

    it('separa la caché por rol y oculta analítica al perder permisos', () => {
        mockRole = 'tenant_admin';
        const view = render(<MoreScreen />);
        const adminQueryKey = mockQueryOptions.queryKey;

        mockRole = 'tenant_agent';
        view.rerender(<MoreScreen />);

        expect(mockQueryOptions.queryKey).not.toEqual(adminQueryKey);
        expect(screen.queryByText('more.performance')).toBeNull();
    });
});
