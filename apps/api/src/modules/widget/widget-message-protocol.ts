import type { WidgetStoredMessage } from './widget-message-store.service';
import { stripInternalMarkers } from '../../common/utils/internal-markers.util';

/** Never expose internal ledger, approval or agent metadata to the public widget. */
export function widgetPublicMessage(stored:WidgetStoredMessage){
    // History and replay re-send what was stored, and rows written before the
    // strip existed (or by another producer) may still carry the internal
    // `[Article: …]` citation. Only the assistant's words are touched.
    const message=stored.direction==='outbound'&&stored.metadata?.source!=='agent'
        ?{...stored,content_text:stripInternalMarkers(stored.content_text as any) as any,caption:stripInternalMarkers(stored.caption as any) as any}
        :stored;
    return {
        id:message.id,messageId:message.id,direction:message.direction,
        role:message.direction==='inbound'?'user':message.metadata?.source==='agent'?'agent':'assistant',
        content_type:message.content_type,type:message.content_type,
        content_text:message.content_text,content:message.content_text||message.caption||message.media_url||'',
        media_url:message.media_url,mediaUrl:message.media_url,caption:message.caption,
        filename:typeof message.metadata?.filename==='string'?message.metadata.filename:undefined,
        created_at:message.created_at,timestamp:message.created_at,
        receiptRequired:message.direction==='outbound'&&message.status==='pending',
    };
}
