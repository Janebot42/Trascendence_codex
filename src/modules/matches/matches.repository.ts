import { randomToken } from '../../shared/crypto/randomToken.js';
import type { CreateFinishedMatchInput, Match } from './matches.types.js';

export interface MatchesRepository {
  createFinished(input: CreateFinishedMatchInput): Promise<Match>;
  listByUser(userId: string, limit: number): Promise<Match[]>;
  listRecent(limit: number): Promise<Match[]>;
}

export class InMemoryMatchesRepository implements MatchesRepository {
  private readonly matches = new Map<string, Match>();

  async createFinished(input: CreateFinishedMatchInput): Promise<Match> {
    const now = new Date();
    const id = randomToken(16);
    const topScore = Math.max(...input.players.map((player) => player.score));
    const winners = input.players.filter((player) => player.score === topScore);
    const match: Match = {
      id,
      status: 'finished',
      winnerUserId: winners.length === 1 ? winners[0].userId : null,
      startedAt: now,
      finishedAt: now,
      createdAt: now,
      players: input.players.map((player) => ({
        id: randomToken(16),
        matchId: id,
        userId: player.userId,
        score: player.score,
        createdAt: now
      }))
    };
    this.matches.set(id, match);
    return match;
  }

  async listByUser(userId: string, limit: number): Promise<Match[]> {
    return [...this.matches.values()]
      .filter((match) => match.players.some((player) => player.userId === userId))
      .sort((left, right) => right.finishedAt.getTime() - left.finishedAt.getTime())
      .slice(0, limit);
  }

  async listRecent(limit: number): Promise<Match[]> {
    return [...this.matches.values()]
      .sort((left, right) => right.finishedAt.getTime() - left.finishedAt.getTime())
      .slice(0, limit);
  }
}
