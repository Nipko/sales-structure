import { Module } from '@nestjs/common';

@Module({
    // TODO: ConversationsService, ConversationsController
    // - Manage conversation lifecycle (create, resolve, archive)
    // - Orchestrate: receive normalized message → load persona → call LLM Router → generate response → send via channel
    // - Manage conversation stage transitions (greeting → discovery → negotiation → closing)
    // - Track estimated ticket value for routing decisions
})
export class ConversationsModule { }
