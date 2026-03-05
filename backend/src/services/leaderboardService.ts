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

interface GlobalTopSnapshot {
  top: LeaderboardEntry[];
  totalPlayers: number;
  expiresAt: number;
}

let globalTopSnapshot: GlobalTopSnapshot | null = null;

const getLeaderboardCacheTtlMs = (): number => {
  const raw = Number.parseInt(process.env.LEADERBOARD_CACHE_TTL_MS ?? '3000', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 3000;
};

export const invalidateGlobalLeaderboardCache = (): void => {
  globalTopSnapshot = null;
};

const fetchGlobalTopSnapshot = async (): Promise<GlobalTopSnapshot> => {
  const now = Date.now();
  if (globalTopSnapshot && globalTopSnapshot.expiresAt > now) {
    return globalTopSnapshot;
  }

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

  globalTopSnapshot = {
    top,
    totalPlayers,
    expiresAt: now + getLeaderboardCacheTtlMs()
  };

  return globalTopSnapshot;
};

export const getGlobalLeaderboard = async (
  currentUserId?: string
): Promise<GlobalLeaderboardResponse> => {
  const snapshot = await fetchGlobalTopSnapshot();
  const top = snapshot.top;
  const totalPlayers = snapshot.totalPlayers;

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
