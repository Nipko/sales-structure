import React from 'react';
import { Alert, Linking } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { VerticalOperationsScreen } from '../OperationsScreen';
import { OperationCreateModal } from '../OperationCreateModal';
import { api } from '../../lib/api';

let mockRole = 'tenant_agent';
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({
    tenantId: 'tenant', user: { role: mockRole }, verticalConfig: {},
}) }));
jest.mock('../../lib/api', () => ({ api: {
    getResourceRentals: jest.fn(), updateResourceRentalStatus: jest.fn(),
    getServiceRequests: jest.fn(), getBookableServices: jest.fn(), updateServiceRequest: jest.fn(),
    getOrderContacts: jest.fn(), createServiceRequest: jest.fn(),
} }));
jest.mock('../../lib/config', () => ({ DASHBOARD_URL: 'https://admin.parallly-chat.cloud' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({
    SafeAreaView: require('react-native').View,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../../lib/haptics', () => ({ haptic: { tap: jest.fn(), success: jest.fn() } }));
jest.mock('../../components/Toast', () => ({ useToast: () => ({ success: jest.fn(), error: jest.fn() }) }));
jest.mock('../../components/AppModal', () => ({ Modal: ({ visible, children }: any) => visible
    ? require('react').createElement(require('react-native').View, null, children) : null }));
jest.mock('../AppointmentsScreen', () => ({ AppointmentsScreen: () => null }));
jest.mock('../ReservationsScreen', () => ({ ReservationsScreen: () => null }));
jest.mock('../../i18n', () => ({ useI18n: () => ({ locale: 'es', t: (key: string, params: any = {}) => {
    const text = require('../../i18n/translations').translations.es[key];
    if (typeof text !== 'string') throw new Error(`missing_translation:${key}`);
    return text.replace(/\{(\w+)\}/g, (_match: string, name: string) => String(params[name] ?? name));
} }) }));

const SERVICE_ID = '11111111-1111-4111-8111-111111111111';
const service = { id: SERVICE_ID, name: 'Visita de plomería', category: 'plomeria', durationMinutes: 60, isActive: true };
const request = { id: 'request', service_type: 'Plomería', customer_name: 'Alex', status: 'quoted', service_id: null };
const rental = { id: 'rental', resource_name: 'Toyota', customer_name: 'Alex', status: 'reserved', start_date: '2026-09-18', end_date: '2026-09-20' };

function renderOperations(kind: 'vehicle_rentals' | 'service_requests') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    return render(<QueryClientProvider client={client}><VerticalOperationsScreen kind={kind} /></QueryClientProvider>);
}

describe('mobile operations follow current API requirements', () => {
    beforeAll(() => notifyManager.setNotifyFunction(callback => act(callback)));
    afterAll(() => notifyManager.setNotifyFunction(callback => callback()));
    beforeEach(() => {
        jest.clearAllMocks();
        mockRole = 'tenant_agent';
        jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
        (api.getResourceRentals as jest.Mock).mockResolvedValue({ success: true, data: [rental] });
        (api.updateResourceRentalStatus as jest.Mock).mockResolvedValue({ success: true });
        (api.getServiceRequests as jest.Mock).mockResolvedValue({ success: true, data: [request] });
        (api.getBookableServices as jest.Mock).mockResolvedValue({ success: true, data: [service] });
        (api.updateServiceRequest as jest.Mock).mockResolvedValue({ success: true });
        (api.getOrderContacts as jest.Mock).mockResolvedValue({ success: true, data: { items: [{ id: SERVICE_ID, name: 'Alex' }], total: 1, hasMore: false } });
        (api.createServiceRequest as jest.Mock).mockResolvedValue({ success: true });
    });

    afterEach(() => jest.restoreAllMocks());

    it.each([
        ['pending_review', 'La solicitud aún no está aprobada'],
        ['reserved', 'La entrega requiere una inspección'],
        ['picked_up', 'La devolución requiere una inspección'],
    ])('shows the actionable web step for %s without sending an unsupported status', async (status, heading) => {
        (api.getResourceRentals as jest.Mock).mockResolvedValue({ success: true, data: [{ ...rental, status }] });
        const view = renderOperations('vehicle_rentals');
        fireEvent.press(await view.findByText('Toyota'));
        expect(view.getByText(heading)).toBeTruthy();
        expect(view.queryByText('Registrar entrega')).toBeNull();
        expect(view.queryByText('Registrar devolución')).toBeNull();
        fireEvent.press(view.getByLabelText('Abrir alquileres en la web'));
        expect(Linking.openURL).toHaveBeenCalledWith('https://admin.parallly-chat.cloud/admin/resource-rentals');
        expect(api.updateResourceRentalStatus).not.toHaveBeenCalled();
    });

    it('preserves a supervisor cancellation with the exact accepted API payload', async () => {
        mockRole = 'tenant_supervisor';
        const confirmation = jest.spyOn(Alert, 'alert');
        const view = renderOperations('vehicle_rentals');
        fireEvent.press(await view.findByText('Toyota'));
        fireEvent.press(view.getByText('Cancelar'));
        const confirm = confirmation.mock.calls[0][2]?.find(button => button.style === 'destructive');
        expect(confirm?.onPress).toBeDefined();
        await act(async () => { confirm?.onPress?.(); });
        await waitFor(() => expect(api.updateResourceRentalStatus).toHaveBeenCalledWith('tenant', 'rental', 'cancelled'));
        expect(api.updateResourceRentalStatus).toHaveBeenCalledTimes(1);
    });

    it('requires an explicit catalog choice before scheduling a legacy request without serviceId', async () => {
        const view = renderOperations('service_requests');
        await view.findByText('Plomería');
        fireEvent.press(view.getByText('Programar'));
        await view.findByText(service.name);
        expect(view.getByRole('button', { name: 'Guardar y programar' })).toBeDisabled();
        expect(api.updateServiceRequest).not.toHaveBeenCalled();
        fireEvent.press(view.getByText(service.name));
        fireEvent.changeText(view.getByLabelText('Fecha'), '2026-09-18');
        fireEvent.changeText(view.getByLabelText('Hora'), '09:30');
        fireEvent.press(view.getByText('Guardar y programar'));
        await waitFor(() => expect(api.updateServiceRequest).toHaveBeenCalledWith('tenant', 'request', {
            status: 'scheduled', serviceId: SERVICE_ID, scheduledAt: '2026-09-18T09:30:00',
        }));
    });

    it('keeps scheduling disabled if catalog lookup fails, instead of fabricating a service', async () => {
        (api.getBookableServices as jest.Mock).mockResolvedValue({ success: false, error: 'forbidden' });
        const view = renderOperations('service_requests');
        await view.findByText('Plomería');
        fireEvent.press(view.getByText('Programar'));
        await view.findByText('No se pudo consultar el catálogo. Reintenta antes de programar.');
        expect(view.getByRole('button', { name: 'Guardar y programar' })).toBeDisabled();
        expect(api.updateServiceRequest).not.toHaveBeenCalled();
    });

    it('creates the request with the chosen service identity and canonical category', async () => {
        const view = render(<OperationCreateModal visible kind="service_requests" tenantId="tenant" role="tenant_agent" onClose={jest.fn()} onCreated={jest.fn()} />);
        await view.findByText(service.name);
        await view.findByText('Alex');
        fireEvent.press(view.getByLabelText('Crear operación'));
        expect(api.createServiceRequest).not.toHaveBeenCalled();
        fireEvent.press(view.getByText(service.name));
        fireEvent.press(view.getByLabelText('Crear operación'));
        await waitFor(() => expect(api.createServiceRequest).toHaveBeenCalledWith('tenant', expect.objectContaining({
            serviceId: SERVICE_ID, serviceType: 'plomeria', contactId: SERVICE_ID,
        })));
    });

    it.each([false, true])('preserves unscheduled intake without inventing a service (catalog failed: %s)', async failed => {
        (api.getBookableServices as jest.Mock).mockResolvedValue(failed ? { success: false, error: 'unavailable' } : { success: true, data: [] });
        const view = render(<OperationCreateModal visible kind="service_requests" tenantId="tenant" role="tenant_agent" onClose={jest.fn()} onCreated={jest.fn()} />);
        await view.findByText('Alex');
        if (failed) {
            await view.findByText('No se pudo consultar el catálogo. Reintenta antes de programar.');
            expect(view.queryByText('No hay servicios activos con duración definida. Pide a un administrador o supervisor que configure el catálogo de servicios en la web.')).toBeNull();
        }
        fireEvent.changeText(view.getByLabelText('Tipo de servicio'), 'Revisar fuga');
        fireEvent.press(view.getByLabelText('Crear operación'));
        await waitFor(() => expect(api.createServiceRequest).toHaveBeenCalledTimes(1));
        const payload = (api.createServiceRequest as jest.Mock).mock.calls[0][1];
        expect(payload.serviceType).toBe('Revisar fuga');
        expect(payload.serviceId).toBeUndefined();
        expect(payload.status).toBeUndefined();
        expect(payload.scheduledAt).toBeUndefined();
    });
});
