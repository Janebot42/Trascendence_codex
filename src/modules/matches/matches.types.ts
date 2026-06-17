export type MatchStatus = 'finished';

export type MatchPlayer = {
  id: string;
  matchId: string;
  userId: string;
  score: number;
  createdAt: Date;
};

export type Match = {
  id: string;
  status: MatchStatus;
  winnerUserId: string | null;
  startedAt: Date;
  finishedAt: Date;
  createdAt: Date;
  players: MatchPlayer[];
};

export type CreateFinishedMatchInput = {
  players: Array<{
    userId: string;
    score: number;
  }>;
};

export type UserGameStats = {
  userId: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  goalsFor: number;
  goalsAgainst: number;
  rankingPoints: number;
  level: number;
};
