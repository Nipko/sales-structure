import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrderStockEvidenceReview,stockEvidenceComplete } from './OrderStockEvidenceReview';
import { currentCatalogReview } from '@/lib/catalog-order-review';
import { formatMoney } from '@/lib/format-money';
let mockLocale='es';
const mockMessages:Record<string,any>=Object.fromEntries(['es','en','pt','fr'].map(locale=>[locale,require(`../../../messages/${locale}.json`).orders.integrity]));
jest.mock('next-intl',()=>({useTranslations:()=>{
    return(key:string,values?:Record<string,unknown>)=>{
        const text=mockMessages[mockLocale][key];if(typeof text!=='string')throw new Error(`translation_missing:${key}`);
        return text.replace(/\{(\w+)\}/g,(_match:string,key:string)=>String(values?.[key]??key));
    };
}}));
jest.mock('@/lib/api',()=>({api:{}}));
const order={id:'private-order-id',version:4,items:[{id:'line',productName:'<Product>',quantity:2,stockDeducted:null}]};
describe('Reviewed catalogue facts and historical recovery',()=>{
    it.each(['es','en','pt','fr'])('shows unknown stock and evidence requirements without a preselected decision in %s',locale=>{
        mockLocale=locale;const html=renderToStaticMarkup(createElement(OrderStockEvidenceReview,{tenantId:'tenant',order,onClose:jest.fn(),onSaved:jest.fn()}));
        expect(html).toContain('role="dialog"');expect(html).toContain(mockMessages[locale].stockUnknown);expect(html).toContain('selected=""');
        expect(html).toContain(mockMessages[locale].evidenceSource);expect(html).toContain('disabled=""');
        expect(html).toContain('&lt;Product&gt;');expect(html).not.toContain('private-order-id');
    });
    it('distinguishes zero reviewed units from unknown and requires every line plus source and reason',()=>{
        expect(stockEvidenceComplete(order,{},'receipt','checked')).toBe(false);
        expect(stockEvidenceComplete(order,{line:''},'receipt','checked')).toBe(false);
        expect(stockEvidenceComplete(order,{line:'0'},'receipt','checked')).toBe(true);
        expect(stockEvidenceComplete(order,{line:'2'},'receipt','checked')).toBe(true);
        expect(stockEvidenceComplete(order,{line:'1'},'receipt','checked')).toBe(false);
        expect(stockEvidenceComplete(order,{line:'2'},'','checked')).toBe(false);
    });
    it('invalidates a quote on any form change and rejects malformed or inconsistent totals',()=>{
        const review={fingerprint:'original',termsHash:'a'.repeat(64),terms:{currency:'USD',totalAmountCents:'87',items:[{productId:'product',productName:'Product',quantity:3,unitAmountCents:'29',totalAmountCents:'87'}]}};
        expect(currentCatalogReview(review,'original')).toBe(review);expect(currentCatalogReview(review,'changed')).toBeNull();
        expect(currentCatalogReview({...review,terms:{...review.terms,totalAmountCents:'1'}},'original')).toBeNull();
        expect(currentCatalogReview({...review,terms:{...review.terms,currency:''}},'original')).toBeNull();
        expect(currentCatalogReview(null,'original')).toBeNull();
        expect(formatMoney(0.87,'USD',{locale:'en',maximumFractionDigits:2})).toBe('$0.87');
    });
});
