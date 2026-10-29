import { RESTAURANTS_TOOLS } from './restaurants-tools';

/**
 * F4300-58 (production QA 28-oct, image 7e28ab93): «¿qué medios de pago aceptan?» was answered «efectivo, tarjeta, enlace de pago,
 * PSE y transferencia» in four languages — the enum of the order tool, not anything the business recorded.
 */
describe('F4300-58 · the order tool payment enum is not the accepted payment methods', () => {
    const description = () => {
        const tool: any = RESTAURANTS_TOOLS.find((t: any) => t.function?.parameters?.properties?.paymentMethod || t.parameters?.properties?.paymentMethod);
        const params = tool.function?.parameters ?? tool.parameters;
        return String(params.properties.paymentMethod.description);
    };

    it('says the values are what an order can record, not what the business accepts', () => {
        expect(description()).toContain('NOT the payment methods this business accepts');
        expect(description()).toContain('only from its FAQs, policies or documents');
    });

    it('keeps the provider rule', () => {
        expect(description()).toContain('never select a provider by name');
    });
});
