import type { FastifyPluginAsync } from 'fastify';
import { withAuth } from '../middleware/auth';
import { getGlobalLeaderboard } from '../services/leaderboardService';

export const leaderboardRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/global', { preHandler: withAuth({ optional: true }) }, async (request) => {
    return getGlobalLeaderboard(request.user?.id);
  });
};
