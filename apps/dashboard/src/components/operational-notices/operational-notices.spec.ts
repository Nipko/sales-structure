import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NoticeLoadState, OperationalNoticeReviewCard } from './OperationalNoticeWorkspace';
import { canRecoverNoticeReview, noticeActions, noticeEvidenceKey, reviewNoticeAndRefresh, type OperationalNotice, type NoticeReviewRequest } from '@/lib/operational-notices';
import { canAccessPath } from '@/lib/roles';
import { resolveNavigationRoute } from '@/lib/navigation-contract';

let mockLocale='es';
const mockMessages:Record<string,any>=Object.fromEntries(['es','en','pt','fr'].map(locale=>[locale,require(`../../../messages/${locale}.json`).operationalNotices]));
jest.mock('next-intl',()=>({useLocale:()=>mockLocale,useTranslations:()=>{
    const lookup=(key:string)=>key.split('.').reduce((node:any,part)=>node?.[part],mockMessages[mockLocale]);
    const t=(key:string)=>{const value=lookup(key);if(typeof value!=='string')throw new Error(`missing_translation:${mockLocale}:${key}`);return value;};
    t.has=(key:string)=>typeof lookup(key)==='string';return t;
}}));
jest.mock('@/lib/api',()=>({api:{}}));
const notice=(overrides:Partial<OperationalNotice>={}):OperationalNotice=>({
    id:'notice',kind:'education.waitlist_promoted',entity_id:'entity',contact_id:'contact',contact_name:'<Customer>',conversation_id:'conversation',state:'reconciliation_required',route:'telegram',provider_reference:null,
    attempts:1,error_code:'notice_delivery_outcome_unknown',created_at:'2026-09-07T13:00:00Z',updated_at:'2026-09-07T13:00:00Z',completed_at:null,
    revision:'a'.repeat(32),verification:{status:'unknown',source:'none',checkedAt:'2026-09-07T13:00:00Z'},latestReview:null,reviewable:true,reviews:[],...overrides,
});
const render=(item=notice(),role='tenant_admin',verified=true)=>renderToStaticMarkup(createElement(OperationalNoticeReviewCard,{notice:item,role,verified,onReview:jest.fn(),onClose:jest.fn()}));
beforeEach(()=>{mockLocale='es';});
describe('Operational notice review is explicit about evidence and authority',()=>{
    it.each(['es','en','pt','fr'])('renders operational state and every receipt level independently in %s',locale=>{
        mockLocale=locale;
        for(const status of ['unknown','provider_accepted','web_stored','web_received'] as const){
            const html=render(notice({state:'stored',verification:{status,source:'widget_message',checkedAt:'2026-09-07T13:00:00Z'}}));
            expect(html).toContain(mockMessages[locale].states.stored);
            expect(html).toContain(mockMessages[locale].evidenceStates[status]);
            expect(html).toContain(mockMessages[locale].evidenceHints[status]);
            expect(html).toContain('&lt;Customer&gt;');
        }
    });
    it.each(['tenant_agent','tenant_viewer','','unrecognized'])('does not expose review data or controls to %s',role=>{
        expect(noticeActions(notice(),role)).toEqual([]);expect(render(notice(),role)).toBe('');
        expect(canAccessPath('/admin/operational-notices',role,false)).toBe(false);
    });
    it('lets supervisors observe while only administrators resolve or suppress',()=>{
        expect(noticeActions(notice(),'tenant_supervisor')).toEqual(['observe']);
        const html=render(notice(),'tenant_supervisor');expect(html).toContain(mockMessages.es.actions.observe);
        expect(html).not.toContain(mockMessages.es.actions.suppress);expect(html).not.toContain(mockMessages.es.actions.verify);
        expect(html).toContain(mockMessages.es.resolutionAdminOnly);
        expect(noticeActions(notice(),'tenant_admin')).toEqual(['verify','observe','suppress']);
        expect(noticeActions(notice({state:'sent'}),'tenant_admin')).not.toContain('suppress');
        expect(noticeActions(notice({state:'suppressed'}),'tenant_admin')).not.toContain('suppress');
        expect(canRecoverNoticeReview('suppress','tenant_admin')).toBe(true);
        expect(canRecoverNoticeReview('suppress','tenant_supervisor')).toBe(false);
    });
    it('cannot turn an asserted receipt or human success note into verified delivery',()=>{
        const item=notice({provider_reference:'human-provided-looking-reference',latestReview:{id:'review',action:'observe',actor_role:'tenant_admin',reason:'Client received it!',human_reference:'receipt',resulting_state:'reconciliation_required',evidence:{status:'unknown',source:'none',checkedAt:'today'},created_at:'today'}});
        expect(noticeEvidenceKey(item)).toBe('unknown');expect(render(item)).toContain(mockMessages.es.evidenceStates.unknown);
        expect(render(item)).not.toContain(mockMessages.es.evidenceStates.provider_accepted);
    });
    it.each(['es','en','pt','fr'])('keeps loading and failures distinct from no notices in %s',locale=>{
        mockLocale=locale;
        for(const props of [{loading:true,error:false,empty:true},{loading:false,error:true,empty:true}]){
            const html=renderToStaticMarkup(createElement(NoticeLoadState,props));
            expect(html).not.toContain(mockMessages[locale].empty);
            expect(html).toContain(props.error?mockMessages[locale].loadError:mockMessages[locale].loading);
        }
        expect(renderToStaticMarkup(createElement(NoticeLoadState,{loading:false,error:false,empty:true}))).toContain(mockMessages[locale].empty);
    });
    it('provides a registered, role-protected route and disables decisions after a failed detail refresh',()=>{
        expect(resolveNavigationRoute('/admin/operational-notices')?.definition.titleKey).toBe('operationalNotices.title');
        expect(canAccessPath('/admin/operational-notices','tenant_supervisor',false)).toBe(true);
        expect(canAccessPath('/admin/operational-notices','super_admin',false)).toBe(false);
        expect(render(notice(),'tenant_admin',false)).toContain(mockMessages.es.notVerified);
        expect(noticeActions(notice({reviewable:false}),'tenant_admin')).toEqual([]);
    });
});
describe('Review mutation always reconsults authority',()=>{
    const request:NoticeReviewRequest={action:'observe',expectedRevision:'a'.repeat(32),idempotencyKey:'11111111-1111-4111-8111-111111111111',reason:'Reviewed existing records'};
    it('refreshes after an uncertain POST and retains the exact request/version/key for recovery',async()=>{
        const events:string[]=[],item=notice({revision:'b'.repeat(32)});
        const client={reviewOperationalNotice:jest.fn(async()=>{events.push('review');throw new Error('network_timeout');}),getOperationalNotice:jest.fn(async()=>{events.push('read');return {success:true,data:item};})};
        expect(await reviewNoticeAndRefresh(client,'tenant','notice',request)).toMatchObject({verified:true,error:'network_timeout',notice:item});
        await reviewNoticeAndRefresh(client,'tenant','notice',request);
        expect(events).toEqual(['review','read','review','read']);expect(client.reviewOperationalNotice.mock.calls[0]).toEqual(client.reviewOperationalNotice.mock.calls[1]);
        expect(request.expectedRevision).toBe('a'.repeat(32));
    });
    it('never treats a successful POST with failed refresh as a verified current view',async()=>{
        const client={reviewOperationalNotice:jest.fn().mockResolvedValue({success:true}),getOperationalNotice:jest.fn().mockRejectedValue(new Error('read_failed'))};
        expect(await reviewNoticeAndRefresh(client,'tenant','notice',request)).toMatchObject({notice:null,verified:false,error:'notice_detail_unavailable'});
    });
    it('preserves a CAS rejection after refreshing the actual current record',async()=>{
        const client={reviewOperationalNotice:jest.fn().mockResolvedValue({success:false,error:'notice_revision_changed'}),getOperationalNotice:jest.fn().mockResolvedValue({success:true,data:notice()})};
        expect(await reviewNoticeAndRefresh(client,'tenant','notice',request)).toMatchObject({verified:true,error:'notice_revision_changed'});
    });
});
