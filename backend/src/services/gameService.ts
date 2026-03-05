import { prisma } from '../db/prisma';

export interface SubmitGameResultInput {
  score: number;
  playTime: number;
  obstacles: number;
  sessionId?: string;
}

export interface SubmitGameResultOutput {
  suspicious: boolean;
  scoreAccepted: boolean;
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

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });

    await tx.gameResult.create({
      data: {
        userId,
        score,
        playTime,
        obstacles,
        sessionId
      }
    });

    if (suspicious) {
      await tx.user.update({
        where: { id: userId },
        data: {
          totalGames: {
            increment: 1
          },
          totalPlayTime: {
            increment: playTime
          }
        }
      });

      return;
    }

    await tx.user.update({
      where: { id: userId },
      data: {
        totalGames: {
          increment: 1
        },
        totalScore: {
          increment: BigInt(score)
        },
        totalPlayTime: {
          increment: playTime
        },
        bestScore: Math.max(user.bestScore, score)
      }
    });
  });

  if (suspicious) {
    console.warn(`[anti-cheat] Suspicious result ignored for leaderboard. userId=${userId} score=${score}`);
  }

  return {
    suspicious,
    scoreAccepted: !suspicious
  };
};
