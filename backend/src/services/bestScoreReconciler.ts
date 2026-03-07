import { prisma } from '../db/prisma';
import { invalidateGlobalLeaderboardCache } from './leaderboardService';

interface Cursor {
  createdAt: Date;
  id: string;
}

interface ReconcilerLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return fallback;
};

const RECONCILE_ENABLED = parseBoolean(process.env.BEST_SCORE_RECONCILE_ENABLED, true);
const RECONCILE_INTERVAL_MS = parsePositiveInt(process.env.BEST_SCORE_RECONCILE_INTERVAL_MS, 10 * 60 * 1000);
const RECONCILE_BATCH_SIZE = parsePositiveInt(process.env.BEST_SCORE_RECONCILE_BATCH_SIZE, 600);
const BOOT_LOOKBACK_MINUTES = parsePositiveInt(process.env.BEST_SCORE_RECONCILE_BOOT_LOOKBACK_MINUTES, 30);

let timer: NodeJS.Timeout | null = null;
let running = false;
let cursor: Cursor | null = null;

const getBaseWhere = () => {
  if (cursor) {
    return {
      OR: [
        {
          createdAt: {
            gt: cursor.createdAt
          }
        },
        {
          createdAt: cursor.createdAt,
          id: {
            gt: cursor.id
          }
        }
      ]
    };
  }

  return {
    createdAt: {
      gte: new Date(Date.now() - BOOT_LOOKBACK_MINUTES * 60_000)
    }
  };
};

const reconcileOnce = async (logger: ReconcilerLogger): Promise<void> => {
  if (running) {
    logger.warn('[best-score-reconciler] skipped run because previous run is still active');
    return;
  }

  running = true;

  try {
    let leaderboardChanged = false;

    while (true) {
      const batch = await prisma.gameResult.findMany({
        where: getBaseWhere(),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          userId: true,
          createdAt: true
        },
        take: RECONCILE_BATCH_SIZE
      });

      if (batch.length === 0) {
        break;
      }

      const last = batch[batch.length - 1]!;
      cursor = {
        createdAt: last.createdAt,
        id: last.id
      };

      const userIds = Array.from(new Set(batch.map((row) => row.userId)));
      if (userIds.length === 0) {
        if (batch.length < RECONCILE_BATCH_SIZE) {
          break;
        }
        continue;
      }

      const maxScores = await prisma.gameResult.groupBy({
        by: ['userId'],
        where: {
          userId: {
            in: userIds
          }
        },
        _max: {
          score: true
        }
      });

      for (const item of maxScores) {
        const maxScore = item._max.score;
        if (maxScore === null) {
          continue;
        }

        const updated = await prisma.user.updateMany({
          where: {
            id: item.userId,
            bestScore: {
              lt: maxScore
            }
          },
          data: {
            bestScore: maxScore
          }
        });

        if (updated.count > 0) {
          leaderboardChanged = true;
        }
      }

      if (batch.length < RECONCILE_BATCH_SIZE) {
        break;
      }
    }

    if (leaderboardChanged) {
      invalidateGlobalLeaderboardCache();
      logger.info('[best-score-reconciler] bestScore corrections applied');
    }
  } catch (error) {
    logger.error({ error }, '[best-score-reconciler] run failed');
  } finally {
    running = false;
  }
};

export const startBestScoreReconciler = (logger: ReconcilerLogger): void => {
  if (!RECONCILE_ENABLED || timer) {
    return;
  }

  logger.info(
    {
      intervalMs: RECONCILE_INTERVAL_MS,
      batchSize: RECONCILE_BATCH_SIZE,
      bootLookbackMinutes: BOOT_LOOKBACK_MINUTES
    },
    '[best-score-reconciler] started'
  );

  void reconcileOnce(logger);

  timer = setInterval(() => {
    void reconcileOnce(logger);
  }, RECONCILE_INTERVAL_MS);

  timer.unref();
};

export const stopBestScoreReconciler = (): void => {
  if (!timer) {
    return;
  }

  clearInterval(timer);
  timer = null;
};
