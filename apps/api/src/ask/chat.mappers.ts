import { ChatMessage, Conversation } from '@prisma/client';
import type { ChatMessageDto, Citation, ConversationDto, GraphPath, ToolCallTrace } from '@app-starter/shared';

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

export function toChatMessageDto(message: ChatMessage): ChatMessageDto {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    citations: asArray<Citation>(message.citations),
    toolTrace: asArray<ToolCallTrace>(message.toolTrace),
    graphPaths: asArray<GraphPath>(message.graphPaths),
    hydraRequestId: message.hydraRequestId,
    feedback: message.feedback === 1 || message.feedback === -1 ? message.feedback : null,
    viewAsEmail: message.viewAsEmail,
    createdAt: message.createdAt.toISOString(),
  };
}

export function toConversationDto(conversation: Conversation & { messages?: ChatMessage[] }): ConversationDto {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    ...(conversation.messages ? { messages: conversation.messages.map(toChatMessageDto) } : {}),
  };
}
