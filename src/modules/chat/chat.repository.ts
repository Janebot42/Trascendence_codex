import { randomToken } from '../../shared/crypto/randomToken.js';
import type { ChatMessage, CreateChatMessageInput } from './chat.types.js';

export interface ChatRepository {
  createLobbyMessage(input: CreateChatMessageInput): Promise<ChatMessage>;
  createDirectMessage(input: Required<CreateChatMessageInput>): Promise<ChatMessage>;
  listLobbyMessages(limit: number): Promise<ChatMessage[]>;
  listDirectMessages(leftUserId: string, rightUserId: string, limit: number): Promise<ChatMessage[]>;
}

export class InMemoryChatRepository implements ChatRepository {
  private readonly messages: ChatMessage[] = [];

  async createLobbyMessage(input: CreateChatMessageInput): Promise<ChatMessage> {
    const message: ChatMessage = {
      id: randomToken(16),
      authorUserId: input.authorUserId,
      recipientUserId: null,
      body: input.body,
      scope: 'lobby',
      readAt: null,
      createdAt: new Date()
    };
    this.messages.push(message);
    return message;
  }

  async listLobbyMessages(limit: number): Promise<ChatMessage[]> {
    return [...this.messages].reverse().slice(0, limit);
  }

  async createDirectMessage(input: Required<CreateChatMessageInput>): Promise<ChatMessage> {
    const message: ChatMessage = {
      id: randomToken(16),
      authorUserId: input.authorUserId,
      recipientUserId: input.recipientUserId,
      body: input.body,
      scope: 'direct',
      readAt: null,
      createdAt: new Date()
    };
    this.messages.push(message);
    return message;
  }

  async listDirectMessages(leftUserId: string, rightUserId: string, limit: number): Promise<ChatMessage[]> {
    return this.messages
      .filter(
        (message) =>
          message.scope === 'direct' &&
          ((message.authorUserId === leftUserId && message.recipientUserId === rightUserId) ||
            (message.authorUserId === rightUserId && message.recipientUserId === leftUserId))
      )
      .reverse()
      .slice(0, limit);
  }
}
