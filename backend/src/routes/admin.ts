import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db/prisma';
import { adminMiddleware } from '../middleware/admin';
import { withAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';

interface TelegramBody {
  telegramId: string;
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

    return { ok: true, userId: user.id };
  });

  fastify.post('/reset-leaderboard', { preHandler: adminPreHandlers }, async () => {
    await prisma.user.updateMany({
      data: {
        bestScore: 0
      }
    });

    return { ok: true };
  });
};
