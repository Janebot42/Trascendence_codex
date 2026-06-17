import type { PrismaClient } from '@prisma/client';
import { randomToken } from '../../shared/crypto/randomToken.js';
import type { ChatRepository } from './chat.repository.js';
import type { ChatMessage, CreateChatMessageInput } from './chat.types.js';

export class PrismaChatRepository implements ChatRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createLobbyMessage(input: CreateChatMessageInput): Promise<ChatMessage> {
    const message = await this.prisma.chatMessage.create({
      data: {
        id: randomToken(16),
        authorUserId: input.authorUserId,
        recipientUserId: null,
        body: input.body,
        scope: 'LOBBY'
      }
    });
    return mapChatMessage(message);
  }

  async listLobbyMessages(limit: number): Promise<ChatMessage[]> {
    const messages = await this.prisma.chatMessage.findMany({
      where: { scope: 'LOBBY' },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
    return messages.map(mapChatMessage);
  }

  async createDirectMessage(input: Required<CreateChatMessageInput>): Promise<ChatMessage> {
    const message = await this.prisma.chatMessage.create({
      data: {
        id: randomToken(16),
        authorUserId: input.authorUserId,
        recipientUserId: input.recipientUserId,
        body: input.body,
        scope: 'DIRECT'
      }
    });
    return mapChatMessage(message);
  }

  async listDirectMessages(leftUserId: string, rightUserId: string, limit: number): Promise<ChatMessage[]> {
    const messages = await this.prisma.chatMessage.findMany({
      where: {
        scope: 'DIRECT',
        OR: [
          { authorUserId: leftUserId, recipientUserId: rightUserId },
          { authorUserId: rightUserId, recipientUserId: leftUserId }
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
    return messages.map(mapChatMessage);
  }
}

function mapChatMessage(message: {
  id: string;
  authorUserId: string;
  recipientUserId: string | null;
  body: string;
  scope: 'LOBBY' | 'DIRECT' | 'SYSTEM';
  readAt: Date | null;
  createdAt: Date;
}): ChatMessage {
  const scope = message.scope === 'DIRECT' ? 'direct' : message.scope === 'SYSTEM' ? 'system' : 'lobby';
  return {
    id: message.id,
    authorUserId: message.authorUserId,
    recipientUserId: message.recipientUserId,
    body: message.body,
    scope,
    readAt: message.readAt,
    createdAt: message.createdAt
  };
}
