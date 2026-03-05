import type { FastifyPluginAsync } from 'fastify';
import { withAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { getGlobalLeaderboard } from '../services/leaderboardService';

export const leaderboardRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/global',
    { preHandler: [rateLimit('leaderboard.global', { windowMs: 60_000, max: 120 }), withAuth({ optional: true })] },
    async (request) => {
      return getGlobalLeaderboard(request.user?.id);
    }
  );
};
