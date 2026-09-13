import 'reflect-metadata';
import { OperationalNoticeController } from './operational-notice.controller';
import { noticeReviewInput, noticeReviewHash, NOTICE_REVIEW_ROLES } from './operational-notice-review.contracts';

const request={action:'observe',expectedRevision:'a'.repeat(32),idempotencyKey:'11111111-1111-4111-8111-111111111111',reason:'  Reviewed the outcome  '};
describe('Operational notice review HTTP contracts',()=>{
    it.each(['list','detail','review'] as const)('restricts %s to tenant administrators/supervisors',method=>{
        expect(Reflect.getMetadata('roles',OperationalNoticeController.prototype[method])).toEqual(NOTICE_REVIEW_ROLES);
    });
    it('takes the actor from authenticated context and retains explicit tenant and notice scope',async()=>{
        const notices={review:jest.fn().mockResolvedValue({reviewId:'review'})},controller=new OperationalNoticeController(notices as any);
        await controller.review('tenant','notice',{user:{id:'authenticated'}},{...request,actorId:'forged'});
        expect(notices.review).toHaveBeenCalledWith('tenant','notice','authenticated',expect.objectContaining({actorId:'forged'}));
        // Only the authenticated actor is passed as the authorization argument.
    });
    it.each([null,{}, {...request,action:'resend'},{...request,reason:'ok'},{...request,expectedRevision:'stale'},
        {...request,idempotencyKey:'arbitrary'}, {...request,humanReference:42}])('rejects unsupported or malformed decisions',value=>{
        expect(()=>noticeReviewInput(value)).toThrow('notice_review_invalid');
    });
    it('normalizes review input and binds the exact version, reason and reference to replay identity',()=>{
        const input=noticeReviewInput({...request,actorId:'ignored',humanReference:' receipt '});
        expect(input).toMatchObject({reason:'Reviewed the outcome',humanReference:'receipt'});
        expect(input).not.toHaveProperty('actorId');
        expect(noticeReviewHash(input)).not.toBe(noticeReviewHash({...input,reason:'Another explanation'}));
    });
});
