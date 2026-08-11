import React, { useEffect } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { ToastProvider, useToast } from '../Toast';
import { Modal } from '../AppModal';

function Trigger({ msg, kind }: { msg: string; kind: 'success' | 'error' | 'info' }) {
    const toast = useToast();
    useEffect(() => { toast[kind](msg); }, [msg, kind, toast]);
    return null;
}

function ActionTrigger({ onPress }: { onPress: () => void }) {
    const toast = useToast();
    useEffect(() => {
        toast.error('No se pudo guardar la operación', { label: 'Reintentar', onPress });
    }, [onPress, toast]);
    return null;
}

describe('Toast', () => {
    it('muestra un toast de error con su mensaje', async () => {
        render(
            <ToastProvider>
                <Trigger msg="No se pudo enviar el mensaje" kind="error" />
            </ToastProvider>,
        );
        expect(await screen.findByText('No se pudo enviar el mensaje')).toBeTruthy();
    });

    it('useToast fuera del provider no rompe (no-op)', () => {
        // Render a trigger without provider: should not throw.
        expect(() => render(<Trigger msg="x" kind="info" />)).not.toThrow();
    });

    it('renderiza errores sobre un Modal nativo y conserva alerta + acción accesibles', async () => {
        const retry = jest.fn();
        render(
            <ToastProvider>
                <Modal visible transparent onRequestClose={() => {}}>
                    <ActionTrigger onPress={retry} />
                </Modal>
            </ToastProvider>,
        );

        const modal = screen.getByTestId('app-modal-content');
        expect(await within(modal).findByRole('alert', { name: 'No se pudo guardar la operación' })).toBeTruthy();
        fireEvent.press(within(modal).getByRole('button', { name: 'Reintentar' }));
        expect(retry).toHaveBeenCalledTimes(1);
    });
});
