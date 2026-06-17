import type { ChatRepository } from './chat.repository.js';
import type { ChatMessage } from './chat.types.js';
import { badRequest } from '../../shared/errors/httpErrors.js';
import type { UsersService } from '../users/users.service.js';

export class ChatService {
  constructor(private readonly chatRepository: ChatRepository, private readonly usersService?: UsersService) {}

  async postLobbyMessage(authorUserId: string, body: string): Promise<ChatMessage> {
    return this.chatRepository.createLobbyMessage({ authorUserId, body: body.trim() });
  }

  async listLobbyMessages(limit: number): Promise<ChatMessage[]> {
    return this.chatRepository.listLobbyMessages(limit);
  }

  async postDirectMessage(authorUserId: string, recipientUserId: string, body: string): Promise<ChatMessage> {
    if (authorUserId === recipientUserId) throw badRequest('Cannot send a direct message to yourself', 'VALIDATION_ERROR');
    if (this.usersService && (await this.usersService.isBlockedBetween(authorUserId, recipientUserId))) {
      throw badRequest('Message blocked by user settings', 'VALIDATION_ERROR');
    }
    return this.chatRepository.createDirectMessage({ authorUserId, recipientUserId, body: body.trim() });
  }

  async listDirectMessages(leftUserId: string, rightUserId: string, limit: number): Promise<ChatMessage[]> {
    if (this.usersService && (await this.usersService.isBlockedBetween(leftUserId, rightUserId))) {
      throw badRequest('Conversation blocked by user settings', 'VALIDATION_ERROR');
    }
    return this.chatRepository.listDirectMessages(leftUserId, rightUserId, limit);
  }
}
