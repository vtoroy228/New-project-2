import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { invalidateGlobalLeaderboardCache } from './leaderboardService';

const GLOBAL_LEADERBOARD_STATE_ID = 'global';

type DbClient = Prisma.TransactionClient | typeof prisma;

export interface AdminResolvedUser {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  bestScore: number;
}

export interface AdminRecentGame {
  id: string;
  createdAt: Date;
  score: number;
  playTime: number;
  obstacles: number;
  sessionId: string | null;
  user: AdminResolvedUser;
}

export interface RebuildBestScoresResult {
  playersWithScore: number;
  epochStart: string;
  top: Array<{
    id: string;
    bestScore: number;
  }>;
}

export interface ResetLeaderboardOptions {
  createdByTelegramId?: bigint;
  confirmationMaxScore?: number;
  resetAt?: Date;
}

export interface ResetLeaderboardResult {
  affectedUsers: number;
  backupId: string;
  backupMaxScore: number;
  backupUsers: number;
  epochStart: string;
}

export interface LatestLeaderboardBackupMeta {
  backupId: string;
  createdAt: string;
  maxScore: number;
  usersCount: number;
  restoredAt: string | null;
}

export interface RestoreLeaderboardOptions {
  restoredByTelegramId?: bigint;
  expectedMaxScore?: number;
}

export type RestoreLeaderboardResult =
  | {
      restored: false;
      reason: 'no_backup';
    }
  | {
      restored: false;
      reason: 'confirmation_mismatch';
      expectedMaxScore: number;
      providedMaxScore: number;
    }
  | {
      restored: true;
      backupId: string;
      restoredUsers: number;
      backupMaxScore: number;
      epochStart: string;
    };

const toAdminUser = (user: {
  id: string;
  telegramId: bigint;
  username: string | null;
  firstName: string;
  lastName: string | null;
  bestScore: number;
}): AdminResolvedUser => {
  return {
    id: user.id,
    telegramId: user.telegramId.toString(),
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    bestScore: user.bestScore
  };
};

const clampScore = (value: number): number => {
  const normalized = Math.trunc(Number.isFinite(value) ? value : 0);
  return Math.max(0, normalized);
};

const normalizeUserRef = (reference: string): string => {
  return reference.trim().replace(/\s+/g, '');
};

const parseTelegramId = (value: string): bigint | null => {
  if (!/^-?\d+$/.test(value)) {
    return null;
  }

  try {
    return BigInt(value);
  } catch {
    return null;
  }
};

const normalizeOptionalScore = (value: number | undefined): number | null => {
  if (value === undefined || !Number.isFinite(value)) {
    return null;
  }

  return clampScore(value);
};

const ensureLeaderboardState = async (db: DbClient) => {
  return db.leaderboardState.upsert({
    where: {
      id: GLOBAL_LEADERBOARD_STATE_ID
    },
    update: {},
    create: {
      id: GLOBAL_LEADERBOARD_STATE_ID,
      epochStart: new Date(0)
    }
  });
};

const findLatestBackup = async (db: DbClient, latestBackupId: string | null) => {
  if (latestBackupId) {
    const backup = await db.leaderboardBackup.findUnique({
      where: {
        id: latestBackupId
      }
    });
    if (backup) {
      return backup;
    }
  }

  return db.leaderboardBackup.findFirst({
    orderBy: [{ createdAt: 'desc' }]
  });
};

export const getLeaderboardEpochStart = async (): Promise<Date> => {
  const state = await ensureLeaderboardState(prisma);
  return state.epochStart;
};

export const getCurrentLeaderboardMaxScore = async (): Promise<number> => {
  const aggregate = await prisma.user.aggregate({
    _max: {
      bestScore: true
    },
    where: {
      isBanned: false
    }
  });

  return aggregate._max.bestScore ?? 0;
};

export const getLatestLeaderboardBackupMeta = async (): Promise<LatestLeaderboardBackupMeta | null> => {
  const state = await ensureLeaderboardState(prisma);
  const backup = await findLatestBackup(prisma, state.latestBackupId ?? null);
  if (!backup) {
    return null;
  }

  return {
    backupId: backup.id,
    createdAt: backup.createdAt.toISOString(),
    maxScore: backup.maxScore,
    usersCount: backup.usersCount,
    restoredAt: backup.restoredAt ? backup.restoredAt.toISOString() : null
  };
};

export const resetLeaderboardBestScores = async (
  options: ResetLeaderboardOptions = {}
): Promise<ResetLeaderboardResult> => {
  const result = await prisma.$transaction(async (tx) => {
    const state = await ensureLeaderboardState(tx);
    const usersWithScore = await tx.user.findMany({
      where: {
        bestScore: {
          gt: 0
        }
      },
      select: {
        id: true,
        telegramId: true,
        username: true,
        avatarUrl: true,
        firstName: true,
        lastName: true,
        bestScore: true
      }
    });

    const backupMaxScore = usersWithScore.reduce((max, user) => {
      return user.bestScore > max ? user.bestScore : max;
    }, 0);

    const backup = await tx.leaderboardBackup.create({
      data: {
        createdByTelegramId: options.createdByTelegramId,
        confirmationMaxScore: normalizeOptionalScore(options.confirmationMaxScore),
        maxScore: backupMaxScore,
        usersCount: usersWithScore.length,
        previousEpochStart: state.epochStart
      }
    });

    if (usersWithScore.length > 0) {
      await tx.leaderboardBackupEntry.createMany({
        data: usersWithScore.map((user) => {
          return {
            backupId: backup.id,
            userId: user.id,
            telegramId: user.telegramId,
            username: user.username,
            avatarUrl: user.avatarUrl,
            firstName: user.firstName,
            lastName: user.lastName,
            bestScore: user.bestScore
          };
        })
      });
    }

    const resetAt = options.resetAt ?? new Date();
    const [updateManyResult] = await Promise.all([
      tx.user.updateMany({
        data: {
          bestScore: 0
        }
      }),
      tx.leaderboardState.update({
        where: {
          id: GLOBAL_LEADERBOARD_STATE_ID
        },
        data: {
          epochStart: resetAt,
          latestBackupId: backup.id
        }
      })
    ]);

    return {
      affectedUsers: updateManyResult.count,
      backupId: backup.id,
      backupMaxScore,
      backupUsers: usersWithScore.length,
      epochStart: resetAt.toISOString()
    };
  });

  invalidateGlobalLeaderboardCache();
  return result;
};

export const restoreLatestLeaderboardBackup = async (
  options: RestoreLeaderboardOptions = {}
): Promise<RestoreLeaderboardResult> => {
  const result = await prisma.$transaction(async (tx) => {
    const state = await ensureLeaderboardState(tx);
    const backup = await findLatestBackup(tx, state.latestBackupId ?? null);
    if (!backup) {
      return {
        restored: false as const,
        reason: 'no_backup' as const
      };
    }

    const expectedScore = normalizeOptionalScore(options.expectedMaxScore);
    if (expectedScore !== null && expectedScore !== backup.maxScore) {
      return {
        restored: false as const,
        reason: 'confirmation_mismatch' as const,
        expectedMaxScore: backup.maxScore,
        providedMaxScore: expectedScore
      };
    }

    await tx.user.updateMany({
      data: {
        bestScore: 0
      }
    });

    const restoredRaw = await tx.$executeRaw`
      UPDATE "User" AS u
      SET "bestScore" = src.score
      FROM (
        SELECT "userId", "bestScore"::int AS score
        FROM "LeaderboardBackupEntry"
        WHERE "backupId" = ${backup.id}
      ) AS src
      WHERE u.id = src."userId"
    `;

    await Promise.all([
      tx.leaderboardBackup.update({
        where: {
          id: backup.id
        },
        data: {
          restoredAt: new Date(),
          restoredByTelegramId: options.restoredByTelegramId
        }
      }),
      tx.leaderboardState.update({
        where: {
          id: GLOBAL_LEADERBOARD_STATE_ID
        },
        data: {
          epochStart: backup.previousEpochStart,
          latestBackupId: backup.id
        }
      })
    ]);

    return {
      restored: true as const,
      backupId: backup.id,
      restoredUsers: typeof restoredRaw === 'number' ? restoredRaw : backup.usersCount,
      backupMaxScore: backup.maxScore,
      epochStart: backup.previousEpochStart.toISOString()
    };
  });

  if (result.restored) {
    invalidateGlobalLeaderboardCache();
  }

  return result;
};

export const rebuildBestScoresFromResults = async (): Promise<RebuildBestScoresResult> => {
  const epochStart = await getLeaderboardEpochStart();

  await prisma.$transaction(async (tx) => {
    await tx.user.updateMany({
      data: {
        bestScore: 0
      }
    });

    await tx.$executeRaw`
      UPDATE "User" AS u
      SET "bestScore" = src.max_score
      FROM (
        SELECT "userId", MAX("score")::int AS max_score
        FROM "GameResult"
        WHERE "createdAt" >= ${epochStart}
        GROUP BY "userId"
      ) AS src
      WHERE u.id = src."userId"
    `;
  });

  const [playersWithScore, top] = await Promise.all([
    prisma.user.count({
      where: {
        bestScore: {
          gt: 0
        }
      }
    }),
    prisma.user.findMany({
      where: {
        bestScore: {
          gt: 0
        }
      },
      orderBy: [{ bestScore: 'desc' }, { updatedAt: 'asc' }],
      take: 5,
      select: {
        id: true,
        bestScore: true
      }
    })
  ]);

  invalidateGlobalLeaderboardCache();

  return {
    playersWithScore,
    epochStart: epochStart.toISOString(),
    top
  };
};

export const resolveUserForAdmin = async (reference: string): Promise<AdminResolvedUser | null> => {
  const normalized = normalizeUserRef(reference);
  if (!normalized) {
    return null;
  }

  const telegramId = parseTelegramId(normalized);
  if (telegramId !== null) {
    const byId = await prisma.user.findUnique({
      where: { telegramId },
      select: {
        id: true,
        telegramId: true,
        username: true,
        firstName: true,
        lastName: true,
        bestScore: true
      }
    });
    return byId ? toAdminUser(byId) : null;
  }

  const username = normalized.startsWith('@') ? normalized.slice(1) : normalized;
  if (!username) {
    return null;
  }

  const byUsername = await prisma.user.findFirst({
    where: {
      username: {
        equals: username,
        mode: 'insensitive'
      }
    },
    select: {
      id: true,
      telegramId: true,
      username: true,
      firstName: true,
      lastName: true,
      bestScore: true
    }
  });

  return byUsername ? toAdminUser(byUsername) : null;
};

export const setUserBestScoreById = async (
  userId: string,
  newBestScore: number
): Promise<AdminResolvedUser> => {
  const bestScore = clampScore(newBestScore);

  const updatedUser = await prisma.user.update({
    where: {
      id: userId
    },
    data: {
      bestScore
    },
    select: {
      id: true,
      telegramId: true,
      username: true,
      firstName: true,
      lastName: true,
      bestScore: true
    }
  });

  invalidateGlobalLeaderboardCache();
  return toAdminUser(updatedUser);
};

export const setUserBestScoreByReference = async (
  reference: string,
  newBestScore: number
): Promise<AdminResolvedUser | null> => {
  const user = await resolveUserForAdmin(reference);
  if (!user) {
    return null;
  }

  return setUserBestScoreById(user.id, newBestScore);
};

export const getRecentGameResults = async (limit = 15): Promise<AdminRecentGame[]> => {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);

  const rows = await prisma.gameResult.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: safeLimit,
    select: {
      id: true,
      createdAt: true,
      score: true,
      playTime: true,
      obstacles: true,
      sessionId: true,
      user: {
        select: {
          id: true,
          telegramId: true,
          username: true,
          firstName: true,
          lastName: true,
          bestScore: true
        }
      }
    }
  });

  return rows.map((row) => {
    return {
      id: row.id,
      createdAt: row.createdAt,
      score: row.score,
      playTime: row.playTime,
      obstacles: row.obstacles,
      sessionId: row.sessionId,
      user: toAdminUser(row.user)
    };
  });
};
