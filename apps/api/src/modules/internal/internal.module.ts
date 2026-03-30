import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InternalController } from './internal.controller';
import { ConversationsModule } from '../conversations/conversations.module';

@Module({
  imports: [ConfigModule, ConversationsModule],
  controllers: [InternalController],
})
export class InternalModule {}
