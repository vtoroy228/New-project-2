import type { User } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../db/prisma';
import {
  buildDevMockUserFromEnv,
  verifyTelegramInitData
} from '../services/telegramAuth';

interface AuthOptions {
  optional?: boolean;
}

const isDevMockEnabled = (): boolean => {
  return process.env.NODE_ENV !== 'production' && process.env.DEV_MOCK_TELEGRAM === 'true';
};

const resolveInitData = (request: FastifyRequest): string | null => {
  const authorization = request.headers.authorization;
  if (!authorization) {
    return null;
  }

  const [scheme, ...rest] = authorization.split(' ');
  if (scheme.toLowerCase() !== 'tma') {
    return null;
  }

  return rest.join(' ').trim() || null;
};

const upsertUser = async (telegramUser: {
  id: number;
  username?: string;
  first_name: string;
  last_name?: string;
  is_premium?: boolean;
}): Promise<User> => {
  return prisma.user.upsert({
    where: {
      telegramId: BigInt(telegramUser.id)
    },
    create: {
      telegramId: BigInt(telegramUser.id),
      username: telegramUser.username,
      firstName: telegramUser.first_name,
      lastName: telegramUser.last_name,
      isPremium: telegramUser.is_premium ?? false
    },
    update: {
      username: telegramUser.username,
      firstName: telegramUser.first_name,
      lastName: telegramUser.last_name,
      isPremium: telegramUser.is_premium ?? false
    }
  });
};

export const withAuth = (options: AuthOptions = {}) => {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const initData = resolveInitData(request);

    if (!initData) {
      if (options.optional) {
        return;
      }

      reply.code(401).send({ error: 'Missing Telegram initData' });
      return;
    }

    let telegramUser =
      initData === 'dev-mock' && isDevMockEnabled()
        ? buildDevMockUserFromEnv()
        : null;

    if (!telegramUser) {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        request.log.error('TELEGRAM_BOT_TOKEN is not configured');
        reply.code(500).send({ error: 'Server auth is not configured' });
        return;
      }

      telegramUser = verifyTelegramInitData(initData, botToken);
    }

    if (!telegramUser) {
      if (options.optional) {
        return;
      }

      reply.code(401).send({ error: 'Invalid Telegram initData' });
      return;
    }

    const user = await upsertUser(telegramUser);

    if (user.isBanned) {
      reply.code(403).send({ error: 'User is banned' });
      return;
    }

    request.telegramUser = telegramUser;
    request.user = user;
  };
};
