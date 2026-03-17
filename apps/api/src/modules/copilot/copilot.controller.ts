import { Controller, Post, Body, UseGuards, Req, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CopilotService, CopilotChatRequest } from './copilot.service';

/**
 * Copilot Controller
 *
 * Handles AI-powered Copilot chat for internal platform users (agents/admins).
 * Business logic is delegated to CopilotService.
 */
@Controller('copilot')
export class CopilotController {
    private readonly logger = new Logger(CopilotController.name);

    constructor(private readonly copilotService: CopilotService) { }

    @Post('chat')
    @UseGuards(AuthGuard('jwt'))
    async chat(
        @Body() body: CopilotChatRequest,
        @Req() req: any,
    ) {
        this.logger.log(`Copilot chat from user ${body.context.userName} on ${body.context.page}`);
        return this.copilotService.chat(body);
    }
}
