import React, { useEffect } from 'react';
import { render, screen } from '@testing-library/react-native';
import { ToastProvider, useToast } from '../Toast';

function Trigger({ msg, kind }: { msg: string; kind: 'success' | 'error' | 'info' }) {
    const toast = useToast();
    useEffect(() => { toast[kind](msg); }, [msg, kind, toast]);
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
});
