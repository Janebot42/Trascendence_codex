import { badRequest } from '../../shared/errors/httpErrors.js';
import type { UsersService } from '../users/users.service.js';
import type { MatchesRepository } from './matches.repository.js';
import type { CreateFinishedMatchInput, Match, UserGameStats } from './matches.types.js';

export class MatchesService {
  constructor(private readonly matchesRepository: MatchesRepository, private readonly usersService: UsersService) {}

  async createFinishedMatch(input: CreateFinishedMatchInput): Promise<Match> {
    const uniquePlayers = new Set(input.players.map((player) => player.userId));
    if (input.players.length < 2 || uniquePlayers.size !== input.players.length) {
      throw badRequest('A finished match requires at least two different players', 'VALIDATION_ERROR');
    }

    for (const player of input.players) {
      const user = await this.usersService.findById(player.userId);
      if (!user) throw badRequest('Unknown match player', 'VALIDATION_ERROR');
    }

    return this.matchesRepository.createFinished(input);
  }

  async listUserMatches(userId: string, limit: number): Promise<Match[]> {
    return this.matchesRepository.listByUser(userId, limit);
  }

  async getUserStats(userId: string): Promise<UserGameStats> {
    const matches = await this.matchesRepository.listByUser(userId, 500);
    return calculateStats(userId, matches);
  }

  async getLeaderboard(limit: number): Promise<UserGameStats[]> {
    const users = await this.usersService.listUsers();
    const stats = await Promise.all(users.map((user) => this.getUserStats(user.id)));
    return stats
      .filter((item) => item.matchesPlayed > 0)
      .sort((left, right) => right.rankingPoints - left.rankingPoints || right.winRate - left.winRate)
      .slice(0, limit);
  }
}

function calculateStats(userId: string, matches: Match[]): UserGameStats {
  let wins = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;

  for (const match of matches) {
    const player = match.players.find((item) => item.userId === userId);
    if (!player) continue;
    goalsFor += player.score;
    goalsAgainst += match.players.filter((item) => item.userId !== userId).reduce((total, item) => total + item.score, 0);
    if (match.winnerUserId === userId) wins += 1;
    else losses += 1;
  }

  const matchesPlayed = wins + losses;
  const rankingPoints = wins * 3 + goalsFor - losses;
  return {
    userId,
    matchesPlayed,
    wins,
    losses,
    winRate: matchesPlayed > 0 ? Math.round((wins / matchesPlayed) * 100) : 0,
    goalsFor,
    goalsAgainst,
    rankingPoints,
    level: Math.max(1, Math.floor((wins * 25 + goalsFor * 5) / 100) + 1)
  };
}
