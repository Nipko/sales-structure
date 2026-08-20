import { discountToolsForRuntime, paymentToolsForRuntime } from './payment-tool-registration';
import type { PaymentRuntimeCapability } from './payment-operation.service';

const names = (tools: Array<{ name: string }>) => tools.map(tool => tool.name);

const LIVE: PaymentRuntimeCapability = {
    planEnabled: true,
    configured: true,
    ready: true,
    statusAvailable: true,
    activeProvider: 'wompi',
    // The live provider does payment links and nothing else. This is the whole
    // reason `apply_discount` must not be advertised from a saved toggle.
    discountsAvailable: false,
};

describe('payment tool runtime registration', () => {
    it('requires the explicit agent toggle', () => {
        expect(paymentToolsForRuntime(undefined, LIVE)).toEqual([]);
    });

    it('keeps status available after downgrade but blocks new links', () => {
        expect(names(paymentToolsForRuntime(
            { enabled: true, canCreateLinks: true },
            { ...LIVE, planEnabled: false },
        ))).toEqual(['get_payment_status']);
    });

    it('advertises create only with plan, readiness and agent permission', () => {
        expect(names(paymentToolsForRuntime(
            { enabled: true, canCreateLinks: false },
            LIVE,
        ))).toEqual(['get_payment_status']);
        expect(names(paymentToolsForRuntime(
            { enabled: true, canCreateLinks: true },
            LIVE,
        ))).toEqual(['get_payment_status', 'create_payment_link']);
        expect(names(paymentToolsForRuntime(
            { enabled: true, canCreateLinks: true },
            { ...LIVE, ready: false },
        ))).toEqual(['get_payment_status']);
    });
});

/**
 * `apply_discount` se publicaba desde un toggle guardado mientras el único
 * proveedor vivo soporta enlaces de pago y nada más. Cada llamada terminaba en
 * `handoffUnavailable`: el agente ofrecía un descuento que jamás podía otorgar,
 * y el dueño veía la capacidad encendida en el panel.
 */
describe('el descuento solo se publica si alguien puede aplicarlo', () => {
    it('no se publica sin el toggle del agente', () => {
        expect(discountToolsForRuntime(undefined, { ...LIVE, discountsAvailable: true })).toEqual([]);
        expect(discountToolsForRuntime({ canApplyDiscount: false }, { ...LIVE, discountsAvailable: true })).toEqual([]);
    });

    it('no se publica cuando el proveedor no sabe aplicar descuentos', () => {
        expect(discountToolsForRuntime({ canApplyDiscount: true, maxDiscountPercent: 15 }, LIVE)).toEqual([]);
    });

    it('no se publica con techo cero: el negocio no autoriza descuentos', () => {
        expect(discountToolsForRuntime(
            { canApplyDiscount: true, maxDiscountPercent: 0 },
            { ...LIVE, discountsAvailable: true },
        )).toEqual([]);
    });

    it('se publica cuando el toggle, el techo y el proveedor coinciden', () => {
        expect(names(discountToolsForRuntime(
            { canApplyDiscount: true, maxDiscountPercent: 15 },
            { ...LIVE, discountsAvailable: true },
        ))).toEqual(['apply_discount']);
    });

    it('un techo sin definir no bloquea si el proveedor puede', () => {
        expect(names(discountToolsForRuntime(
            { canApplyDiscount: true },
            { ...LIVE, discountsAvailable: true },
        ))).toEqual(['apply_discount']);
    });
});
