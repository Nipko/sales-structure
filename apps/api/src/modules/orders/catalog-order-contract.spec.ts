import { catalogActionError, catalogCents, catalogDecimal, catalogHash, catalogItems, catalogTerms } from './catalog-order-contract';
const id='11111111-1111-4111-8111-111111111111';
describe('Catalog customer terms',()=>{
    it.each([0,-1,1.1,'2',NaN,Infinity,10001])('rejects quantity %s without coercion',(quantity)=>{
        expect(()=>catalogItems([{productId:id,quantity}])).toThrow('catalog_items_invalid');
    });
    it('rejects duplicated product lines and normalizes UUID case',()=>{
        expect(()=>catalogItems([{productId:id,quantity:1},{productId:id,quantity:1}])).toThrow();
        expect(catalogItems([{productId:id.toUpperCase(),quantity:2}])).toEqual([{productId:id,quantity:2}]);
    });
    it('prices using exact decimal cents, including numeric(15,2) boundaries',()=>{
        expect(catalogCents('0.29')).toBe(29n);expect(catalogDecimal(catalogCents('9999999999999.99'))).toBe('9999999999999.99');
        expect(()=>catalogCents('0.001')).toThrow();expect(()=>catalogDecimal(1000000000000000n)).toThrow();
        const terms=catalogTerms([{id,name:'Real',stock:null,price:'0.29',currency:'USD',is_available:true}],[{productId:id,quantity:3}],'','agent');
        expect(terms).toMatchObject({currency:'USD',totalAmountCents:'87',items:[{tracksStock:false,unitAmountCents:'29'}]});
    });
    it('does not infer a missing currency or zero price from malformed data',()=>{
        const product={id,name:'Real',stock:5,price:'10',currency:'USD',is_available:true};
        for(const override of [{currency:null},{price:null},{is_available:null}]) expect(()=>catalogTerms([{...product,...override}],[{productId:id,quantity:1}],'','agent')).toThrow();
    });
    it('keeps a stable exact digest and never exposes arbitrary database error content',()=>{
        expect(catalogHash({b:2,a:'A'})).toBe(catalogHash({a:'A',b:2}));
        expect(catalogHash({a:'A'})).not.toBe(catalogHash({a:'a'}));
        const result=catalogActionError(new Error('tenant_private secret SQL SELECT password'));
        expect(JSON.stringify(result)).not.toContain('secret');expect(result.error).toBe('catalog_operation_unavailable');
    });
});
