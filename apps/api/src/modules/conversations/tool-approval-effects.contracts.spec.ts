import { approvedEffectDescriptors, approvalDeliveryState } from './tool-approval-effects.contracts';
describe('trusted approved delivery descriptors',()=>{
    it('never treats read MCP content or technical guard failures as delivery instructions',()=>{
        for (const name of ['mcp:catalog.read','mcp__catalog_read']) expect(approvedEffectDescriptors(name,'succeeded',{
            success:true,_mediaToSend:[{url:'https://example.test'}],shouldHandoff:true,
        })).toEqual([]);
        expect(approvedEffectDescriptors('send_product_image','succeeded',{success:true,controlBlocked:true,shouldHandoff:true})).toEqual([]);
    });
    it('keeps failed execution distinct from a domain-requested handoff and never dispatches failed media',()=>{
        expect(approvedEffectDescriptors('send_product_image','failed',{success:false,_mediaToSend:{url:'bad'},shouldHandoff:true}))
            .toEqual([{kind:'handoff',itemIndex:0}]);
        expect(approvedEffectDescriptors('search_products','succeeded',{success:true,_mediaToSend:{url:'bad'}})).toEqual([]);
    });
    it('does not confuse provider acceptance with receipt and keeps unresolved effects visible',()=>{
        expect(approvalDeliveryState([])).toBe('not_required');
        expect(approvalDeliveryState([{id:'a',kind:'media',state:'sent'}])).toBe('completed');
        expect(approvalDeliveryState([{id:'a',kind:'media',state:'sent'},{id:'b',kind:'handoff',state:'reconciliation_required'}])).toBe('reconciliation_required');
    });
});
