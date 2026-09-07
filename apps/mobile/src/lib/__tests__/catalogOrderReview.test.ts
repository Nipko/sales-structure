import { catalogMoney,catalogPaymentKey,catalogRequestKey,currentOrderReview } from '../catalogOrderReview';
describe('Mobile catalog review authority',()=>{
    const review={fingerprint:'tenant/contact/cart',termsHash:'a'.repeat(64),terms:{currency:'USD',totalAmountCents:'87',items:[{productId:'product',productName:'Product',quantity:3,unitAmountCents:'29',totalAmountCents:'87'}]}};
    it('invalidates reviewed facts on an edited form, contact or tenant',()=>{
        expect(currentOrderReview(review,review.fingerprint)).toBe(review);
        for(const changed of ['newtenant/contact/cart','tenant/newcontact/cart','tenant/contact/newcart'])expect(currentOrderReview(review,changed)).toBeNull();
    });
    it('rejects malformed or inconsistent prices before showing a confirm action',()=>{
        for(const patch of [{currency:''},{totalAmountCents:'1'},{items:[]},{items:[{...review.terms.items[0],quantity:1.5}]}])expect(currentOrderReview({...review,terms:{...review.terms,...patch}},review.fingerprint)).toBeNull();
        expect(currentOrderReview({...review,termsHash:'forged'},review.fingerprint)).toBeNull();
    });
    it('retains one request key across quote and network retries but changes it for a new draft',()=>{
        const generate=jest.fn().mockReturnValueOnce('first').mockReturnValueOnce('second');
        const key=catalogRequestKey(null,'draft',generate);
        expect(catalogRequestKey(key,'draft',generate)).toBe(key);expect(generate).toHaveBeenCalledTimes(1);
        expect(catalogRequestKey(key,'edited',generate)).toEqual({fingerprint:'edited',key:'second'});
    });
    it('keeps cents and currency visible and never infers provider payment from commercial status',()=>{
        expect(catalogMoney(0.87,'USD','en')).toBe('$0.87');expect(catalogMoney(0.87,null,'en')).toBe('—');
        expect(catalogPaymentKey(undefined)).toBe('ops.catalog.payment.unknown');expect(catalogPaymentKey('pending')).toBe('ops.catalog.payment.pending');
    });
});
