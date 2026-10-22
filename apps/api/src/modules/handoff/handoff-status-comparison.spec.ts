import { HandoffService } from './handoff.service';
import { policyTopicsIn } from './handoff-policy-classifier';

const exactRequest = "Liste hasta 20 pedidos de catalogo de mi propia ficha e indique cuantos hay y su estado. No interprete cancelado como reembolsado ni como entregado. No cree, cancele ni pague nada; no guarde notas ni transfiera la conversacion. Referencia QA-ORDER-2984-QA02-LISTA.";
const config = { behavior: { handoffTriggers: [] } } as any;
function harness() {
    const service: any = Object.create(HandoffService.prototype);
    service.llmRouter = { execute: jest.fn().mockResolvedValue({content: JSON.stringify({label:'personal_case'})}) };
    service.logger = { warn: jest.fn(), log: jest.fn() };
    return service;
}
describe('denied order status inferences do not request a refund', () => {
    it('answers the exact order-history request without consulting a refund classifier', async () => {
        const service = harness();
        expect(await service.decideHandoff(exactRequest, {metadata:{}}, config, 'CO', 'tenant')).toBeNull();
        expect(service.llmRouter.execute).not.toHaveBeenCalled();
    });
    it.each([
        'Liste mis pedidos. No interprete cancelado como reembolsado ni como entregado.',
        'Muestre el estado. No confunda cancelado con reembolsado.',
        'List my orders. Do not interpret cancelled as refunded.',
        'List my orders. Do not confuse cancelled with refunded.',
        'Liste meus pedidos. Nao interprete cancelado como reembolsado.',
        'Listez mes commandes. Ne confondez pas annule avec rembourse.',
    ])('does not classify the denied comparison: %s', message => {
        expect(policyTopicsIn(message)).toBeNull();
    });
    it.each([
        'Liste mis pedidos. No interprete cancelado como reembolsado. Quiero mi reembolso.',
        'Liste mis pedidos. No interprete cancelado como reembolsado. Me cobraron dos veces, quiero mi reembolso.',
        'Do not interpret cancelled as refunded. I want a refund.',
        'No confunda cancelado con reembolsado. Quiero hablar con una persona.',
        'No interprete cancelado como reembolsado. Esto es una estafa.',
    ])('preserves separate real requests or grievances: %s', async message => {
        expect(await harness().decideHandoff(message, {metadata:{}}, config, 'CO','tenant')).not.toBeNull();
    });
    it('preserves an explicit owner custom trigger', async () => {
        expect(await harness().decideHandoff(exactRequest, {metadata:{}}, {behavior:{handoffTriggers:['pedidos']}}, 'CO','tenant')).not.toBeNull();
    });
});
