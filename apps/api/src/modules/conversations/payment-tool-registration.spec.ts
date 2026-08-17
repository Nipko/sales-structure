import { paymentToolsForRuntime } from './payment-tool-registration';

const names = (tools: Array<{ name: string }>) => tools.map(tool => tool.name);

describe('payment tool runtime registration', () => {
    it('requires the explicit agent toggle', () => {
        expect(paymentToolsForRuntime(undefined, {
            planEnabled: true,
            configured: true,
            ready: true,
            statusAvailable: true,
        })).toEqual([]);
    });

    it('keeps status available after downgrade but blocks new links', () => {
        expect(names(paymentToolsForRuntime(
            { enabled: true, canCreateLinks: true },
            {
                planEnabled: false,
                configured: true,
                ready: true,
                statusAvailable: true,
                activeProvider: 'wompi',
            },
        ))).toEqual(['get_payment_status']);
    });

    it('advertises create only with plan, readiness and agent permission', () => {
        const capability = {
            planEnabled: true,
            configured: true,
            ready: true,
            statusAvailable: true,
            activeProvider: 'wompi',
        };
        expect(names(paymentToolsForRuntime(
            { enabled: true, canCreateLinks: false },
            capability,
        ))).toEqual(['get_payment_status']);
        expect(names(paymentToolsForRuntime(
            { enabled: true, canCreateLinks: true },
            capability,
        ))).toEqual(['get_payment_status', 'create_payment_link']);
        expect(names(paymentToolsForRuntime(
            { enabled: true, canCreateLinks: true },
            { ...capability, ready: false },
        ))).toEqual(['get_payment_status']);
    });
});
