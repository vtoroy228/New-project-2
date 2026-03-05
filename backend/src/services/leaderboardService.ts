import { prisma } from '../db/prisma';

export interface LeaderboardEntry {
  rank: number;
  telegramId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  avatarUrl: string | null;
  score: number;
}

export interface LeaderboardYou {
  rank: number;
  score: number;
}

export interface GlobalLeaderboardResponse {
  top: LeaderboardEntry[];
  you: LeaderboardYou | null;
  totalPlayers: number;
}

export const getGlobalLeaderboard = async (
  currentUserId?: string
): Promise<GlobalLeaderboardResponse> => {
  const [totalPlayers, topUsers] = await Promise.all([
    prisma.user.count({
      where: {
        isBanned: false,
        bestScore: {
          gt: 0
        }
      }
    }),
    prisma.user.findMany({
      where: {
        isBanned: false,
        bestScore: {
          gt: 0
        }
      },
      orderBy: [{ bestScore: 'desc' }, { updatedAt: 'asc' }],
      take: 10
    })
  ]);

  const top = topUsers.map((user, index) => ({
    rank: index + 1,
    telegramId: user.telegramId.toString(),
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl,
    score: user.bestScore
  }));

  let you: LeaderboardYou | null = null;

  if (currentUserId) {
    const currentUser = await prisma.user.findUnique({
      where: { id: currentUserId }
    });

    if (currentUser && !currentUser.isBanned && currentUser.bestScore > 0) {
      const rankAhead = await prisma.user.count({
        where: {
          isBanned: false,
          bestScore: {
            gt: currentUser.bestScore
          }
        }
      });

      you = {
        rank: rankAhead + 1,
        score: currentUser.bestScore
      };
    }
  }

  return {
    top,
    you,
    totalPlayers
  };
};
