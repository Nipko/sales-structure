import { Module } from '@nestjs/common';
import { InternalController } from './internal.controller';
import { ConversationsModule } from '../conversations/conversations.module';

@Module({
  imports: [ConversationsModule],
  controllers: [InternalController],
})
export class InternalModule {}
