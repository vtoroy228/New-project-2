import 'dotenv/config';
import { prisma } from '../db/prisma';
import { rebuildBestScoresFromResults } from '../services/adminOperations';

const isProd = process.env.NODE_ENV === 'production';
const allowProdRebuild = process.env.ALLOW_PROD_BESTSCORE_REBUILD === 'true';

const run = async (): Promise<void> => {
  if (isProd && !allowProdRebuild) {
    throw new Error(
      'Refusing to rebuild best scores in production. Set ALLOW_PROD_BESTSCORE_REBUILD=true to confirm.'
    );
  }

  const { playersWithScore, top, epochStart } = await rebuildBestScoresFromResults();

  console.info(`[admin] epoch start for rebuild: ${epochStart}`);
  console.info(`[admin] best scores rebuilt, users with bestScore>0: ${playersWithScore}`);
  console.info('[admin] top 5 after rebuild:', top);
};

void run()
  .catch((error: unknown) => {
    console.error('[admin] best score rebuild failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
