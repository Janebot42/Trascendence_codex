import { conflict } from '../../shared/errors/httpErrors.js';
import { randomToken } from '../../shared/crypto/randomToken.js';
import type { CreateUserInput, Friendship, UpdateProfileInput, User } from './users.types.js';

export interface UsersRepository {
  create(input: CreateUserInput): Promise<User>;
  updateProfile(userId: string, input: UpdateProfileInput): Promise<User>;
  findById(id: string): Promise<User | null>;
  findByUsername(username: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  list(): Promise<User[]>;
  createFriendRequest(requesterId: string, addresseeId: string): Promise<Friendship>;
  acceptFriendRequest(userId: string, requesterId: string): Promise<Friendship>;
  removeFriendship(userId: string, otherUserId: string): Promise<void>;
  listFriendships(userId: string): Promise<Friendship[]>;
  blockUser(blockerId: string, blockedUserId: string): Promise<void>;
  unblockUser(blockerId: string, blockedUserId: string): Promise<void>;
  isBlockedBetween(leftUserId: string, rightUserId: string): Promise<boolean>;
}

export class InMemoryUsersRepository implements UsersRepository {
  private readonly users = new Map<string, User>();

  async create(input: CreateUserInput): Promise<User> {
    const normalizedUsername = input.username.trim().toLowerCase();
    for (const user of this.users.values()) {
      if (user.username === normalizedUsername) throw conflict('Username already exists');
      if (input.email && user.email === input.email.toLowerCase()) throw conflict('Email already exists');
    }

    const now = new Date();
    const user: User = {
      id: randomToken(16),
      username: normalizedUsername,
      email: input.email?.toLowerCase() ?? null,
      displayName: input.displayName ?? null,
      avatarUrl: null,
      bio: null,
      role: 'user',
      status: 'active',
      createdAt: now,
      updatedAt: now
    };
    this.users.set(user.id, user);
    return user;
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<User> {
    const user = this.users.get(userId);
    if (!user) throw conflict('User does not exist');
    const updated: User = {
      ...user,
      displayName: input.displayName !== undefined ? input.displayName : user.displayName,
      avatarUrl: input.avatarUrl !== undefined ? input.avatarUrl : user.avatarUrl,
      bio: input.bio !== undefined ? input.bio : user.bio,
      updatedAt: new Date()
    };
    this.users.set(userId, updated);
    return updated;
  }

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const normalizedUsername = username.trim().toLowerCase();
    return [...this.users.values()].find((user) => user.username === normalizedUsername) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const normalizedEmail = email.trim().toLowerCase();
    return [...this.users.values()].find((user) => user.email === normalizedEmail) ?? null;
  }

  async list(): Promise<User[]> {
    return [...this.users.values()];
  }

  private readonly friendships = new Map<string, Friendship>();
  private readonly blocks = new Set<string>();

  async createFriendRequest(requesterId: string, addresseeId: string): Promise<Friendship> {
    const existing = [...this.friendships.values()].find(
      (friendship) =>
        (friendship.requesterId === requesterId && friendship.addresseeId === addresseeId) ||
        (friendship.requesterId === addresseeId && friendship.addresseeId === requesterId)
    );
    if (existing) return existing;

    const now = new Date();
    const friendship: Friendship = {
      id: randomToken(16),
      requesterId,
      addresseeId,
      status: 'pending',
      createdAt: now,
      updatedAt: now
    };
    this.friendships.set(friendship.id, friendship);
    return friendship;
  }

  async acceptFriendRequest(userId: string, requesterId: string): Promise<Friendship> {
    const friendship = [...this.friendships.values()].find(
      (item) => item.requesterId === requesterId && item.addresseeId === userId
    );
    if (!friendship) throw conflict('Friend request does not exist');
    friendship.status = 'accepted';
    friendship.updatedAt = new Date();
    return friendship;
  }

  async removeFriendship(userId: string, otherUserId: string): Promise<void> {
    for (const [id, friendship] of this.friendships.entries()) {
      const matches =
        (friendship.requesterId === userId && friendship.addresseeId === otherUserId) ||
        (friendship.requesterId === otherUserId && friendship.addresseeId === userId);
      if (matches) this.friendships.delete(id);
    }
  }

  async listFriendships(userId: string): Promise<Friendship[]> {
    return [...this.friendships.values()].filter(
      (friendship) => friendship.requesterId === userId || friendship.addresseeId === userId
    );
  }

  async blockUser(blockerId: string, blockedUserId: string): Promise<void> {
    this.blocks.add(`${blockerId}:${blockedUserId}`);
    await this.removeFriendship(blockerId, blockedUserId);
  }

  async unblockUser(blockerId: string, blockedUserId: string): Promise<void> {
    this.blocks.delete(`${blockerId}:${blockedUserId}`);
  }

  async isBlockedBetween(leftUserId: string, rightUserId: string): Promise<boolean> {
    return this.blocks.has(`${leftUserId}:${rightUserId}`) || this.blocks.has(`${rightUserId}:${leftUserId}`);
  }
}
