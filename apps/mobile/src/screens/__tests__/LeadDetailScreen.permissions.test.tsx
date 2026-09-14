import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { LeadDetailScreen } from '../LeadDetailScreen';

const mockArchiveLead = jest.fn();
const mockRestoreLead = jest.fn();
const mockInvalidate = jest.fn();
const mockGoBack = jest.fn();
let mockRole: string | undefined;
let mockArchived = false;

jest.mock('@react-navigation/native', () => ({
    useRoute: () => ({ params: { leadId: 'lead-1' } }),
    useNavigation: () => ({ goBack: mockGoBack }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@tanstack/react-query', () => ({
    useQuery: () => ({
        data: {
            lead: { lead: { id: 'lead-1', first_name: 'Demo', is_archived: mockArchived }, tags: [], opportunities: [] },
            notes: [], tasks: [],
        },
        isLoading: false, isError: false, refetch: jest.fn(),
    }),
    useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));
jest.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({ tenantId: 'tenant-1', user: { id: 'user-1', role: mockRole } }),
}));
jest.mock('../../components/Toast', () => ({
    useToast: () => ({ success: jest.fn(), error: jest.fn() }),
}));
jest.mock('../../lib/api', () => ({
    api: {
        archiveLead: (...args: any[]) => mockArchiveLead(...args),
        restoreLead: (...args: any[]) => mockRestoreLead(...args),
    },
    requireApiSuccess: (result: any) => result,
}));
jest.mock('../../lib/useKeyboardSpace', () => ({ useKeyboardSpace: () => 0 }));
jest.mock('../../lib/haptics', () => ({ haptic: { tap: jest.fn() } }));
jest.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

describe('LeadDetailScreen archive permissions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRole = 'tenant_agent';
        mockArchived = false;
        mockArchiveLead.mockResolvedValue({ success: true });
        mockRestoreLead.mockResolvedValue({ success: true });
        mockInvalidate.mockResolvedValue(undefined);
        jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    });
    afterEach(() => jest.restoreAllMocks());

    it.each(['tenant_agent', 'tenant_viewer', 'unknown', undefined])(
        'no ofrece archivar ni restaurar para %s', (role) => {
            mockRole = role;
            const view = render(<LeadDetailScreen />);
            expect(screen.queryByRole('button', { name: 'crm.archive' })).toBeNull();

            mockArchived = true;
            view.rerender(<LeadDetailScreen />);
            expect(screen.queryByRole('button', { name: 'crm.restore' })).toBeNull();
            expect(mockArchiveLead).not.toHaveBeenCalled();
            expect(mockRestoreLead).not.toHaveBeenCalled();
        },
    );

    it.each([
        ['tenant_admin', false], ['tenant_admin', true],
        ['tenant_supervisor', false], ['tenant_supervisor', true],
        ['super_admin', false], ['super_admin', true],
    ] as const)('permite %s con registro archivado=%s tras confirmar', async (role, archived) => {
        mockRole = role;
        mockArchived = archived;
        render(<LeadDetailScreen />);

        fireEvent.press(screen.getByRole('button', { name: archived ? 'crm.restore' : 'crm.archive' }));
        expect(mockArchiveLead).not.toHaveBeenCalled();
        expect(mockRestoreLead).not.toHaveBeenCalled();
        const confirm = jest.mocked(Alert.alert).mock.calls[0][2]?.[1]?.onPress;
        expect(confirm).toBeDefined();
        await act(async () => { await confirm?.(); });

        expect(archived ? mockRestoreLead : mockArchiveLead).toHaveBeenCalledWith('tenant-1', 'lead-1');
        expect(archived ? mockArchiveLead : mockRestoreLead).not.toHaveBeenCalled();
    });

    it('no ejecuta una confirmación pendiente después de perder el permiso', async () => {
        mockRole = 'tenant_admin';
        const view = render(<LeadDetailScreen />);
        fireEvent.press(screen.getByRole('button', { name: 'crm.archive' }));
        const confirm = jest.mocked(Alert.alert).mock.calls[0][2]?.[1]?.onPress;

        mockRole = 'tenant_agent';
        view.rerender(<LeadDetailScreen />);
        await act(async () => { await confirm?.(); });

        expect(mockArchiveLead).not.toHaveBeenCalled();
        expect(mockRestoreLead).not.toHaveBeenCalled();
    });
});
