import 'dotenv/config';
import { prisma } from '../db/prisma';
import { resetLeaderboardBestScores } from '../services/adminOperations';

const isProd = process.env.NODE_ENV === 'production';
const allowProdReset = process.env.ALLOW_PROD_LEADERBOARD_RESET === 'true';

const run = async (): Promise<void> => {
  if (isProd && !allowProdReset) {
    throw new Error(
      'Refusing to reset leaderboard in production. Set ALLOW_PROD_LEADERBOARD_RESET=true to confirm.'
    );
  }

  const result = await resetLeaderboardBestScores();

  console.info(`[admin] leaderboard reset complete, affected users: ${result.affectedUsers}`);
  console.info(
    `[admin] backupId=${result.backupId} backupMaxScore=${result.backupMaxScore} backupUsers=${result.backupUsers} epochStart=${result.epochStart}`
  );
};

void run()
  .catch((error: unknown) => {
    console.error('[admin] leaderboard reset failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
