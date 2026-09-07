import React from 'react';
import { act,fireEvent,render,waitFor } from '@testing-library/react-native';
import { OperationCreateModal } from '../OperationCreateModal';
import { api } from '../../lib/api';
jest.mock('../../lib/api',()=>({api:{getInventoryProducts:jest.fn(),getOrderContacts:jest.fn(),quoteOrder:jest.fn(),createOrder:jest.fn()}}));
jest.mock('expo-crypto',()=>({randomUUID:jest.fn(()=> 'synthetic-request-key')}));
jest.mock('@expo/vector-icons',()=>({Ionicons:()=>null}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View,useSafeAreaInsets:()=>({top:0,right:0,bottom:0,left:0})}));
jest.mock('../../lib/haptics',()=>({haptic:{tap:jest.fn(),success:jest.fn()}}));
jest.mock('../../components/Toast',()=>({useToast:()=>({success:jest.fn(),error:jest.fn()}),ToastViewport:()=>null}));
jest.mock('../../components/AppModal',()=>({Modal:({children}:any)=>require('react').createElement(require('react-native').View,null,children)}));
jest.mock('../../i18n',()=>({useI18n:()=>({locale:'es',t:(key:string,params:any={})=>{
    const text=require('../../i18n/translations').translations.es[key];
    if(typeof text!=='string')throw new Error(`missing_translation:${key}`);
    return text.replace(/\{(\w+)\}/g,(_match:string,key:string)=>String(params[key]??key));
}})}));
describe('Mobile order uses the reviewed server contract',()=>{
    beforeEach(()=>{
        jest.clearAllMocks();
        (api.getInventoryProducts as jest.Mock).mockResolvedValue({success:true,data:[{id:'product',name:'Product',price:0.29,currency:'USD',stock:null,isActive:true}]});
        (api.getOrderContacts as jest.Mock).mockResolvedValue({success:true,data:{items:[{id:'11111111-1111-4111-8111-111111111111',name:'Alex'}],total:1,hasMore:false}});
        (api.quoteOrder as jest.Mock).mockImplementation(async(_tenant,input)=>({success:true,data:{termsHash:'a'.repeat(64),terms:{currency:'USD',totalAmountCents:String(input.items[0].quantity*29),items:[{...input.items[0],productName:'Product',unitAmountCents:'29',totalAmountCents:String(input.items[0].quantity*29)}]}}}));
    });
    it('requires a new review after an edit and retains the creation key after a failed acknowledgement',async()=>{
        (api.createOrder as jest.Mock).mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValue({success:true,data:{id:'order'}});
        const onCreated=jest.fn(),view=render(<OperationCreateModal visible kind="orders" tenantId="tenant" role="tenant_supervisor" onClose={jest.fn()} onCreated={onCreated}/>);
        await view.findByText('Alex');fireEvent.press(view.getByLabelText('Agregar una unidad de Product'));
        fireEvent.press(view.getByLabelText('Revisar precios'));await view.findByLabelText('Confirmar pedido');
        expect(api.createOrder).not.toHaveBeenCalled();expect(view.getByLabelText('Confirmar pedido')).toBeTruthy();
        fireEvent.press(view.getByLabelText('Agregar una unidad de Product'));expect(view.queryByLabelText('Confirmar pedido')).toBeNull();
        fireEvent.press(view.getByLabelText('Revisar precios'));await view.findByLabelText('Confirmar pedido');
        fireEvent.press(view.getByLabelText('Confirmar pedido'));await waitFor(()=>expect(api.createOrder).toHaveBeenCalledTimes(1));
        expect(onCreated).not.toHaveBeenCalled();expect(view.queryByLabelText('Confirmar pedido')).toBeNull();
        fireEvent.press(view.getByLabelText('Revisar precios'));await view.findByLabelText('Confirmar pedido');
        fireEvent.press(view.getByLabelText('Confirmar pedido'));await waitFor(()=>expect(onCreated).toHaveBeenCalledTimes(1));
        expect(api.createOrder).toHaveBeenCalledTimes(2);
        const first=(api.createOrder as jest.Mock).mock.calls[0][1],retry=(api.createOrder as jest.Mock).mock.calls[1][1];
        expect(first).toMatchObject({expectedTermsHash:'a'.repeat(64),items:[{productId:'product',quantity:2}]});
        expect(retry.idempotencyKey).toBe(first.idempotencyKey);expect(first.items[0].unitPrice).toBeUndefined();
        expect(onCreated).toHaveBeenCalledTimes(1);
    });
    it('does not fabricate an empty usable catalog when loading products fails',async()=>{
        (api.getInventoryProducts as jest.Mock).mockRejectedValue(new Error('unavailable'));
        const view=render(<OperationCreateModal visible kind="orders" tenantId="tenant" onClose={jest.fn()} onCreated={jest.fn()}/>);
        const error=require('../../i18n/translations').translations.es['ops.create.referencesError'];
        await view.findByText(error);await waitFor(()=>expect(api.getInventoryProducts).toHaveBeenCalled());
        fireEvent.press(view.getByLabelText('Revisar precios'));expect(api.quoteOrder).not.toHaveBeenCalled();expect(api.createOrder).not.toHaveBeenCalled();
    });
});
