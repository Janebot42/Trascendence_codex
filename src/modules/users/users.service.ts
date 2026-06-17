import { badRequest } from '../../shared/errors/httpErrors.js';
import type { CreateUserInput, Friendship, PublicUserProfile, UpdateProfileInput, User } from './users.types.js';
import type { UsersRepository } from './users.repository.js';

export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  createUser(input: CreateUserInput): Promise<User> {
    return this.usersRepository.create(input);
  }

  findById(id: string): Promise<User | null> {
    return this.usersRepository.findById(id);
  }

  findByUsername(username: string): Promise<User | null> {
    return this.usersRepository.findByUsername(username);
  }

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findByEmail(email);
  }

  updateProfile(userId: string, input: UpdateProfileInput): Promise<User> {
    return this.usersRepository.updateProfile(userId, {
      displayName: input.displayName?.trim() || null,
      avatarUrl: input.avatarUrl?.trim() || null,
      bio: input.bio?.trim() || null
    });
  }

  listUsers(): Promise<User[]> {
    return this.usersRepository.list();
  }

  async listPublicProfiles(onlineUserIds: Set<string>): Promise<PublicUserProfile[]> {
    const users = await this.usersRepository.list();
    return users.map((user) => ({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      createdAt: user.createdAt,
      online: onlineUserIds.has(user.id)
    }));
  }

  async getPublicProfile(userId: string, onlineUserIds: Set<string>): Promise<PublicUserProfile> {
    const user = await this.usersRepository.findById(userId);
    if (!user) throw badRequest('Unknown user', 'VALIDATION_ERROR');
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      createdAt: user.createdAt,
      online: onlineUserIds.has(user.id)
    };
  }

  async sendFriendRequest(requesterId: string, addresseeId: string): Promise<Friendship> {
    if (requesterId === addresseeId) throw badRequest('You cannot add yourself as a friend', 'VALIDATION_ERROR');
    if (!(await this.usersRepository.findById(addresseeId))) throw badRequest('Unknown user', 'VALIDATION_ERROR');
    if (await this.usersRepository.isBlockedBetween(requesterId, addresseeId)) {
      throw badRequest('Friend request is blocked', 'VALIDATION_ERROR');
    }
    return this.usersRepository.createFriendRequest(requesterId, addresseeId);
  }

  acceptFriendRequest(userId: string, requesterId: string): Promise<Friendship> {
    return this.usersRepository.acceptFriendRequest(userId, requesterId);
  }

  removeFriendship(userId: string, otherUserId: string): Promise<void> {
    return this.usersRepository.removeFriendship(userId, otherUserId);
  }

  listFriendships(userId: string): Promise<Friendship[]> {
    return this.usersRepository.listFriendships(userId);
  }

  async blockUser(blockerId: string, blockedUserId: string): Promise<void> {
    if (blockerId === blockedUserId) throw badRequest('You cannot block yourself', 'VALIDATION_ERROR');
    if (!(await this.usersRepository.findById(blockedUserId))) throw badRequest('Unknown user', 'VALIDATION_ERROR');
    await this.usersRepository.blockUser(blockerId, blockedUserId);
  }

  unblockUser(blockerId: string, blockedUserId: string): Promise<void> {
    return this.usersRepository.unblockUser(blockerId, blockedUserId);
  }

  isBlockedBetween(leftUserId: string, rightUserId: string): Promise<boolean> {
    return this.usersRepository.isBlockedBetween(leftUserId, rightUserId);
  }
}
