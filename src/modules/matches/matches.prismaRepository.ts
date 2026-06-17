import type { PrismaClient } from '@prisma/client';
import { randomToken } from '../../shared/crypto/randomToken.js';
import type { MatchesRepository } from './matches.repository.js';
import type { CreateFinishedMatchInput, Match } from './matches.types.js';

export class PrismaMatchesRepository implements MatchesRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createFinished(input: CreateFinishedMatchInput): Promise<Match> {
    const now = new Date();
    const id = randomToken(16);
    const topScore = Math.max(...input.players.map((player) => player.score));
    const winners = input.players.filter((player) => player.score === topScore);
    const match = await this.prisma.match.create({
      data: {
        id,
        status: 'FINISHED',
        winnerUserId: winners.length === 1 ? winners[0].userId : null,
        startedAt: now,
        finishedAt: now,
        players: {
          create: input.players.map((player) => ({
            id: randomToken(16),
            userId: player.userId,
            score: player.score
          }))
        }
      },
      include: { players: true }
    });
    return {
      id: match.id,
      status: 'finished',
      winnerUserId: match.winnerUserId,
      startedAt: match.startedAt,
      finishedAt: match.finishedAt,
      createdAt: match.createdAt,
      players: match.players.map((player) => ({
        id: player.id,
        matchId: player.matchId,
        userId: player.userId,
        score: player.score,
        createdAt: player.createdAt
      }))
    };
  }

  async listByUser(userId: string, limit: number): Promise<Match[]> {
    const matches = await this.prisma.match.findMany({
      where: { players: { some: { userId } } },
      include: { players: true },
      orderBy: { finishedAt: 'desc' },
      take: limit
    });
    return matches.map(mapMatch);
  }

  async listRecent(limit: number): Promise<Match[]> {
    const matches = await this.prisma.match.findMany({
      include: { players: true },
      orderBy: { finishedAt: 'desc' },
      take: limit
    });
    return matches.map(mapMatch);
  }
}

function mapMatch(match: {
  id: string;
  winnerUserId: string | null;
  startedAt: Date;
  finishedAt: Date;
  createdAt: Date;
  players: Array<{ id: string; matchId: string; userId: string; score: number; createdAt: Date }>;
}): Match {
  return {
      id: match.id,
      status: 'finished',
      winnerUserId: match.winnerUserId,
      startedAt: match.startedAt,
      finishedAt: match.finishedAt,
      createdAt: match.createdAt,
      players: match.players.map((player) => ({
        id: player.id,
        matchId: player.matchId,
        userId: player.userId,
        score: player.score,
        createdAt: player.createdAt
      }))
  };
}
