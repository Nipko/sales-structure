import React from 'react';
import { render } from '@testing-library/react-native';
import { CatalogOrderQuoteCard } from '../CatalogOrderQuoteCard';
import { translations } from '../../i18n/translations';
let mockLocale:'es'|'en'|'pt'|'fr'='es';
jest.mock('../../i18n',()=>({useI18n:()=>({locale:mockLocale,t:(key:string,params:any={})=>{
    const texts=require('../../i18n/translations').translations;
    return texts[mockLocale][key].replace(/\{(\w+)\}/g,(_match:string,key:string)=>String(params[key]??key));
}})}));
describe('Mobile catalog quote',()=>{
    it.each(['es','en','pt','fr'] as const)('shows exact reviewed lines and a separate payment explanation in %s',locale=>{
        mockLocale=locale;
        const view=render(<CatalogOrderQuoteCard review={{fingerprint:'draft',termsHash:'a'.repeat(64),terms:{currency:'USD',totalAmountCents:'87',items:[{productId:'private-product-id',productName:'Product',quantity:3,unitAmountCents:'29',totalAmountCents:'87'}]}}}/>);
        expect(view.getByText(translations[locale]['ops.catalog.review'])).toBeTruthy();
        expect(view.getByText(translations[locale]['ops.catalog.separation'])).toBeTruthy();
        expect(view.getByText(/Product × 3/)).toBeTruthy();expect(view.getByText(/\(USD\)/)).toBeTruthy();
        expect(view.queryByText('private-product-id')).toBeNull();
    });
});
