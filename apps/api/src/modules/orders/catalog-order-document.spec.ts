import { catalogOrderDocument } from './catalog-order-document';
describe('Catalog document uses commercial facts without payment claims',()=>{
    const order={id:'order-reference',contact_name:'<script>alert(1)</script>',status:'paid',payment_status:'pending',currency:'USD',total_amount:'24.70',created_at:'2026-09-07',notes:'<img src=x onerror=alert(1)>'};
    it.each(['es','en','pt','fr'])('escapes records and separates operator and payment status in %s',language=>{
        const html=catalogOrderDocument('Business <test>',order,[{product_name:'<unsafe>',quantity:2,unit_price:'12.35',total_price:'24.70'}],language);
        expect(html).not.toContain('<script>');expect(html).not.toContain('<img');expect(html).toContain('&lt;unsafe&gt;');expect(html).toContain(`lang="${language}"`);
        expect(html).not.toContain('COP');expect(html).not.toContain('FACTURA / RECIBO');
    });
    it('does not guess a legacy currency or payment state',()=>{
        const html=catalogOrderDocument('Shop',{...order,currency:null,payment_status:null},[],'en');
        expect(html).toContain('Provider payment: Unknown');expect(html).toContain('Total: Unknown');
    });
});
