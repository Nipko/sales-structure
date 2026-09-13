import { Injectable } from '@nestjs/common';
import type { NormalizedMessage, OutboundMessage } from '@parallext/shared';
import type { IChannelAdapter } from './channel-gateway.service';
import { WidgetMessageStore } from '../widget/widget-message-store.service';

@Injectable()
export class WidgetChannelAdapter implements IChannelAdapter {
    readonly channelType='web_widget' as const;
    constructor(private readonly messages:WidgetMessageStore){}
    sendOutbound(outbound:OutboundMessage):Promise<string>{return this.messages.sendOutbound(outbound);}
    async handleWebhook():Promise<NormalizedMessage|null>{return null;}
    verifyWebhook():null{return null;}
    async sendTextMessage():Promise<string>{throw new Error('widget_scoped_outbound_required');}
    async sendMediaMessage():Promise<string>{throw new Error('widget_scoped_outbound_required');}
}
