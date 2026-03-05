import type { FastifyPluginAsync } from 'fastify';
import { withAuth } from '../middleware/auth';

interface UserView {
  id: string;
  telegramId: bigint;
  username: string | null;
  firstName: string;
  lastName: string | null;
  isPremium: boolean;
  isBanned: boolean;
  bestScore: number;
  totalGames: number;
  totalScore: bigint;
  totalPlayTime: number;
  createdAt: Date;
  updatedAt: Date;
}

const toSafeUser = (user: UserView) => {
  return {
    id: user.id,
    telegramId: user.telegramId.toString(),
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    isPremium: user.isPremium,
    isBanned: user.isBanned,
    bestScore: user.bestScore,
    totalGames: user.totalGames,
    totalScore: user.totalScore.toString(),
    totalPlayTime: user.totalPlayTime,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString()
  };
};

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/validate', { preHandler: withAuth() }, async (request) => {
    return {
      user: toSafeUser(request.user!)
    };
  });

  fastify.get('/me', { preHandler: withAuth() }, async (request) => {
    return {
      user: toSafeUser(request.user!)
    };
  });
};
