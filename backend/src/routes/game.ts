import type { FastifyPluginAsync } from 'fastify';
import { withAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { submitGameResult } from '../services/gameService';

interface GameResultBody {
  score: number;
  playTime: number;
  obstacles: number;
  sessionId?: string;
}

const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isFinite(value);
};

const parseBody = (body: unknown): GameResultBody | null => {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const payload = body as Partial<GameResultBody>;

  if (!isFiniteNumber(payload.score) || !isFiniteNumber(payload.playTime) || !isFiniteNumber(payload.obstacles)) {
    return null;
  }

  if (payload.sessionId !== undefined && typeof payload.sessionId !== 'string') {
    return null;
  }

  return {
    score: payload.score,
    playTime: payload.playTime,
    obstacles: payload.obstacles,
    sessionId: payload.sessionId
  };
};

export const gameRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/result', { preHandler: [rateLimit('game.result', { windowMs: 60_000, max: 120 }), withAuth()] }, async (request, reply) => {
    const payload = parseBody(request.body);

    if (!payload) {
      reply.code(400).send({ error: 'Invalid game payload' });
      return;
    }

    const result = await submitGameResult(request.user!.id, payload);

    return {
      ok: true,
      ...result
    };
  });
};
