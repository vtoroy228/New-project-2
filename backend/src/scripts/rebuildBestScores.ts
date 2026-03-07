import 'dotenv/config';
import { prisma } from '../db/prisma';

const isProd = process.env.NODE_ENV === 'production';
const allowProdRebuild = process.env.ALLOW_PROD_BESTSCORE_REBUILD === 'true';

const run = async (): Promise<void> => {
  if (isProd && !allowProdRebuild) {
    throw new Error(
      'Refusing to rebuild best scores in production. Set ALLOW_PROD_BESTSCORE_REBUILD=true to confirm.'
    );
  }

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
