import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db/prisma';
import { adminMiddleware } from '../middleware/admin';
import { withAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { resetLeaderboardBestScores, restoreLatestLeaderboardBackup } from '../services/adminOperations';
import { invalidateGlobalLeaderboardCache } from '../services/leaderboardService';

interface TelegramBody {
  telegramId: string;
}

interface RestoreLeaderboardBody {
  expectedMaxScore: number;
}

const parseTelegramId = (body: unknown): bigint | null => {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const payload = body as Partial<TelegramBody>;
  if (!payload.telegramId || typeof payload.telegramId !== 'string') {
    return null;
  }

  try {
    return BigInt(payload.telegramId);
  } catch {
    return null;
  }
};

const parseExpectedMaxScore = (body: unknown): number | null => {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const payload = body as Partial<RestoreLeaderboardBody>;
  if (typeof payload.expectedMaxScore !== 'number' || !Number.isFinite(payload.expectedMaxScore)) {
    return null;
  }

  const score = Math.trunc(payload.expectedMaxScore);
  if (score < 0) {
    return null;
  }

  return score;
};

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  const adminPreHandlers = [rateLimit('admin', { windowMs: 60_000, max: 30 }), withAuth(), adminMiddleware];

  fastify.post('/ban-user', { preHandler: adminPreHandlers }, async (request, reply) => {
    const telegramId = parseTelegramId(request.body);
    if (!telegramId) {
      reply.code(400).send({ error: 'Invalid telegramId' });
      return;
    }

    const existingUser = await prisma.user.findUnique({ where: { telegramId } });
    if (!existingUser) {
      reply.code(404).send({ error: 'User not found' });
      return;
    }

    const user = await prisma.user.update({
      where: { telegramId },
      data: { isBanned: true }
    });
    invalidateGlobalLeaderboardCache();

    return { ok: true, userId: user.id };
  });

  fastify.post('/unban-user', { preHandler: adminPreHandlers }, async (request, reply) => {
    const telegramId = parseTelegramId(request.body);
    if (!telegramId) {
      reply.code(400).send({ error: 'Invalid telegramId' });
      return;
    }

    const existingUser = await prisma.user.findUnique({ where: { telegramId } });
    if (!existingUser) {
      reply.code(404).send({ error: 'User not found' });
      return;
    }

    const user = await prisma.user.update({
      where: { telegramId },
      data: { isBanned: false }
    });
    invalidateGlobalLeaderboardCache();

    return { ok: true, userId: user.id };
  });

  fastify.post('/reset-leaderboard', { preHandler: adminPreHandlers }, async (request) => {
    const result = await resetLeaderboardBestScores({
      createdByTelegramId: request.user?.telegramId
    });

    return {
      ok: true,
      affectedUsers: result.affectedUsers,
      backupId: result.backupId,
      backupMaxScore: result.backupMaxScore,
      backupUsers: result.backupUsers,
      epochStart: result.epochStart
    };
  });

  fastify.post('/restore-leaderboard', { preHandler: adminPreHandlers }, async (request, reply) => {
    const expectedMaxScore = parseExpectedMaxScore(request.body);
    if (expectedMaxScore === null) {
      reply.code(400).send({ error: 'Invalid expectedMaxScore' });
      return;
    }

    const result = await restoreLatestLeaderboardBackup({
      expectedMaxScore,
      restoredByTelegramId: request.user?.telegramId
    });

    if (!result.restored) {
      if (result.reason === 'no_backup') {
        reply.code(404).send({ error: 'No leaderboard backup found' });
        return;
      }

      reply.code(409).send({
        error: 'Backup confirmation mismatch',
        expectedMaxScore: result.expectedMaxScore
      });
      return;
    }

    return {
      ok: true,
      backupId: result.backupId,
      restoredUsers: result.restoredUsers,
      backupMaxScore: result.backupMaxScore,
      epochStart: result.epochStart
    };
  });
};
