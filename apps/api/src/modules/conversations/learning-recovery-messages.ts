import { sanitizeToolResultForModel } from '../../common/utils/tool-error-sanitizer.util';

/** Discard this turn's generated prose/arguments after learning revocation.
 * Keep canonical tool outcomes so recovery reports committed effects without
 * replaying them. Synthetic call IDs exist only in this no-tools model request.
 */
export function learningRecoveryMessages(history:any[],executed:Array<{name:string;result:any}>,language:string):any[]{
    const messages=structuredClone(history);
    executed.forEach((tool,index)=>{
        const id=`learning-recovery-${index}`;
        messages.push({role:'assistant',content:'',toolCalls:[{id,type:'function',function:{name:tool.name,arguments:'{}'}}]});
        messages.push({role:'tool',toolCallId:id,content:JSON.stringify(sanitizeToolResultForModel(tool.result,language))});
    });
    return messages;
}
