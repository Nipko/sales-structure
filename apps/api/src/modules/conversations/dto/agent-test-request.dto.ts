import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsObject,
    IsString,
    Matches,
    MaxLength,
    Validate,
    ValidateIf,
    ValidateNested,
    ValidatorConstraint,
    type ValidatorConstraintInterface,
} from 'class-validator';
import type { ConversationalChannelType, TestAgentRequest } from '@parallext/shared';

export const AGENT_TEST_OPERATIONAL_CHANNELS: readonly ConversationalChannelType[] = Object.freeze([
    'whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget',
]);

export const AGENT_TEST_MESSAGE_MAX_CHARS = 4_000;
export const AGENT_TEST_HISTORY_MAX_ITEMS = 20;
export const AGENT_TEST_HISTORY_ITEM_MAX_CHARS = 4_000;
export const AGENT_TEST_HISTORY_MAX_CHARS = 24_000;

@ValidatorConstraint({ name: 'agentTestHistoryCharacterBudget', async: false })
class AgentTestHistoryCharacterBudgetConstraint implements ValidatorConstraintInterface {
    validate(value: unknown): boolean {
        if (!Array.isArray(value)) return true;
        return value.reduce((total, item) => {
            const content = typeof item?.content === 'string' ? item.content.length : 0;
            return total + content;
        }, 0) <= AGENT_TEST_HISTORY_MAX_CHARS;
    }

    defaultMessage(): string {
        return `conversationHistory no puede superar ${AGENT_TEST_HISTORY_MAX_CHARS} caracteres en total`;
    }
}

export class AgentTestHistoryMessageDto {
    @IsIn(['user', 'assistant'])
    role!: 'user' | 'assistant';

    @IsString()
    @Matches(/\S/u, { message: 'content no puede estar vacío' })
    @MaxLength(AGENT_TEST_HISTORY_ITEM_MAX_CHARS)
    content!: string;
}

export class AgentTestRequestOptionsDto {
    @ValidateIf((_object, value) => value !== undefined)
    @IsBoolean()
    disableTools?: boolean;
}

/**
 * Runtime contract for the public Agent Test endpoint. Internal-only controls
 * (evalMode and sandboxContactId) deliberately do not exist in this DTO.
 */
export class AgentTestRequestDto implements TestAgentRequest {
    @IsString()
    @Matches(/\S/u, { message: 'message no puede estar vacío' })
    @MaxLength(AGENT_TEST_MESSAGE_MAX_CHARS)
    message!: string;

    @ValidateIf((_object, value) => value !== undefined)
    @IsIn(AGENT_TEST_OPERATIONAL_CHANNELS)
    channelType?: ConversationalChannelType;

    @ValidateIf((_object, value) => value !== undefined)
    @IsArray()
    @ArrayMaxSize(AGENT_TEST_HISTORY_MAX_ITEMS)
    @Validate(AgentTestHistoryCharacterBudgetConstraint)
    @ValidateNested({ each: true })
    @Type(() => AgentTestHistoryMessageDto)
    conversationHistory?: AgentTestHistoryMessageDto[];

    @ValidateIf((_object, value) => value !== undefined)
    @IsObject()
    @ValidateNested()
    @Type(() => AgentTestRequestOptionsDto)
    options?: AgentTestRequestOptionsDto;
}
