import { prisma } from '../db/prisma';
import { invalidateGlobalLeaderboardCache } from './leaderboardService';

export interface SubmitGameResultInput {
  score: number;
  playTime: number;
  obstacles: number;
  sessionId?: string;
}

export interface SubmitGameResultOutput {
  suspicious: boolean;
  scoreAccepted: boolean;
  userBestScore: number;
}

const clampInt = (value: number): number => {
  return Math.trunc(Number.isFinite(value) ? value : 0);
};

const isSuspiciousScore = (score: number, playTime: number, obstacles: number): boolean => {
  if (score < 0 || playTime < 0 || obstacles < 0) {
    return true;
  }

  const expectedMaxScore = playTime * 200 + obstacles * 500;
  const allowedMaxScore = Math.floor(expectedMaxScore * 1.2) + 500;

  return score > allowedMaxScore;
};

export const submitGameResult = async (
  userId: string,
  payload: SubmitGameResultInput
): Promise<SubmitGameResultOutput> => {
  const score = clampInt(payload.score);
  const playTime = clampInt(payload.playTime);
  const obstacles = clampInt(payload.obstacles);
  const sessionId = payload.sessionId?.slice(0, 128);

  const suspicious = isSuspiciousScore(score, playTime, obstacles);

  if (sessionId) {
    const duplicate = await prisma.gameResult.findFirst({
      where: {
        userId,
        sessionId
      }
    });

    if (duplicate) {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { bestScore: true }
      });

      return {
        suspicious,
        scoreAccepted: !suspicious,
        userBestScore: user.bestScore
      };
    }
  }

  const { userBestScore, leaderboardChanged } = await prisma.$transaction(async (tx) => {
    await tx.gameResult.create({
      data: {
        userId,
        score,
        playTime,
        obstacles,
        sessionId
      }
    });

    await tx.user.update({
      where: { id: userId },
      data: {
        totalGames: {
          increment: 1
        },
        ...(suspicious
          ? {}
          : {
              totalScore: {
                increment: BigInt(score)
              }
            }),
        totalPlayTime: {
          increment: playTime
        }
      }
    });

    let bestScoreChanged = false;
    if (!suspicious) {
      const promote = await tx.user.updateMany({
        where: {
          id: userId,
          bestScore: {
            lt: score
          }
        },
        data: {
          bestScore: score
        }
      });

      bestScoreChanged = promote.count > 0;
    }

    const updated = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { bestScore: true }
    });

    return {
      userBestScore: updated.bestScore,
      leaderboardChanged: bestScoreChanged
    };
  }).catch(async (error: unknown) => {
    const knownRequestError = error as { code?: string };
    if (sessionId && knownRequestError.code === 'P2002') {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { bestScore: true }
      });
      return {
        userBestScore: user.bestScore,
        leaderboardChanged: false
      };
    }

    throw error;
  });

  if (suspicious) {
    console.warn(`[anti-cheat] Suspicious result ignored for leaderboard. userId=${userId} score=${score}`);
  }

  if (leaderboardChanged) {
    invalidateGlobalLeaderboardCache();
  }

  return {
    suspicious,
    scoreAccepted: !suspicious,
    userBestScore
  };
};
