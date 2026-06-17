import { Prisma, type PrismaClient } from '@prisma/client';
import { mapUser } from '../../db/prismaMappers.js';
import { randomToken } from '../../shared/crypto/randomToken.js';
import { conflict } from '../../shared/errors/httpErrors.js';
import type { UsersRepository } from './users.repository.js';
import type { CreateUserInput, Friendship, UpdateProfileInput, User } from './users.types.js';

export class PrismaUsersRepository implements UsersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateUserInput): Promise<User> {
    try {
      const user = await this.prisma.user.create({
        data: {
          id: randomToken(16),
          username: input.username.trim().toLowerCase(),
          email: input.email?.trim().toLowerCase() ?? null,
          displayName: input.displayName ?? null
        }
      });
      return mapUser(user);
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('User already exists');
      throw error;
    }
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<User> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        displayName: input.displayName,
        avatarUrl: input.avatarUrl,
        bio: input.bio
      }
    });
    return mapUser(user);
  }

  async findById(id: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    return user ? mapUser(user) : null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({ where: { username: username.trim().toLowerCase() } });
    return user ? mapUser(user) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    return user ? mapUser(user) : null;
  }

  async list(): Promise<User[]> {
    const users = await this.prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
    return users.map(mapUser);
  }

  async createFriendRequest(requesterId: string, addresseeId: string): Promise<Friendship> {
    const existing = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId, addresseeId },
          { requesterId: addresseeId, addresseeId: requesterId }
        ]
      }
    });
    if (existing) return mapFriendship(existing);

    const friendship = await this.prisma.friendship.create({
      data: { id: randomToken(16), requesterId, addresseeId }
    });
    return mapFriendship(friendship);
  }

  async acceptFriendRequest(userId: string, requesterId: string): Promise<Friendship> {
    const friendship = await this.prisma.friendship.update({
      where: { requesterId_addresseeId: { requesterId, addresseeId: userId } },
      data: { status: 'ACCEPTED' }
    });
    return mapFriendship(friendship);
  }

  async removeFriendship(userId: string, otherUserId: string): Promise<void> {
    await this.prisma.friendship.deleteMany({
      where: {
        OR: [
          { requesterId: userId, addresseeId: otherUserId },
          { requesterId: otherUserId, addresseeId: userId }
        ]
      }
    });
  }

  async listFriendships(userId: string): Promise<Friendship[]> {
    const friendships = await this.prisma.friendship.findMany({
      where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
      orderBy: { updatedAt: 'desc' }
    });
    return friendships.map(mapFriendship);
  }

  async blockUser(blockerId: string, blockedUserId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.userBlock.upsert({
        where: { blockerId_blockedUserId: { blockerId, blockedUserId } },
        create: { id: randomToken(16), blockerId, blockedUserId },
        update: {}
      }),
      this.prisma.friendship.deleteMany({
        where: {
          OR: [
            { requesterId: blockerId, addresseeId: blockedUserId },
            { requesterId: blockedUserId, addresseeId: blockerId }
          ]
        }
      })
    ]);
  }

  async unblockUser(blockerId: string, blockedUserId: string): Promise<void> {
    await this.prisma.userBlock.deleteMany({ where: { blockerId, blockedUserId } });
  }

  async isBlockedBetween(leftUserId: string, rightUserId: string): Promise<boolean> {
    const block = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: leftUserId, blockedUserId: rightUserId },
          { blockerId: rightUserId, blockedUserId: leftUserId }
        ]
      }
    });
    return Boolean(block);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function mapFriendship(row: {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: 'PENDING' | 'ACCEPTED';
  createdAt: Date;
  updatedAt: Date;
}): Friendship {
  return {
    id: row.id,
    requesterId: row.requesterId,
    addresseeId: row.addresseeId,
    status: row.status === 'ACCEPTED' ? 'accepted' : 'pending',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}
