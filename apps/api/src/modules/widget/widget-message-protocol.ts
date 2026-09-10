import type { WidgetStoredMessage } from './widget-message-store.service';

/** Never expose internal ledger, approval or agent metadata to the public widget. */
export function widgetPublicMessage(message:WidgetStoredMessage){
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
