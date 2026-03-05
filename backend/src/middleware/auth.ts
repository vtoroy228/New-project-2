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

const isDev = process.env.NODE_ENV !== 'production';

const isDevMockEnabled = (): boolean => {
  return isDev && process.env.DEV_MOCK_TELEGRAM === 'true';
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
  photo_url?: string;
  is_premium?: boolean;
}): Promise<User> => {
  const telegramId = BigInt(telegramUser.id);
  const existing = await prisma.user.findUnique({
    where: { telegramId }
  });

  if (!existing) {
    return prisma.user.create({
      data: {
        telegramId,
        username: telegramUser.username,
        avatarUrl: telegramUser.photo_url,
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name,
        isPremium: telegramUser.is_premium ?? false
      }
    });
  }

  const shouldUpdate =
    existing.username !== (telegramUser.username ?? null) ||
    existing.avatarUrl !== (telegramUser.photo_url ?? null) ||
    existing.firstName !== telegramUser.first_name ||
    existing.lastName !== (telegramUser.last_name ?? null) ||
    existing.isPremium !== (telegramUser.is_premium ?? false);

  if (!shouldUpdate) {
    return existing;
  }

  return prisma.user.update({
    where: { telegramId },
    data: {
      username: telegramUser.username,
      avatarUrl: telegramUser.photo_url,
      firstName: telegramUser.first_name,
      lastName: telegramUser.last_name,
      isPremium: telegramUser.is_premium ?? false
    }
  });
};

export const withAuth = (options: AuthOptions = {}) => {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const initData = resolveInitData(request);
    if (isDev) {
      request.log.info(
        {
          authHeaderPresent: Boolean(request.headers.authorization),
          initDataLength: initData?.length ?? 0,
          optional: Boolean(options.optional)
        },
        '[auth] incoming request'
      );
    }

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
    if (isDev && telegramUser) {
      request.log.info({ authMode: 'dev-mock' }, '[auth] using mock telegram user');
    }

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
      if (isDev) {
        const params = new URLSearchParams(initData);
        request.log.info({ authStatus: 'invalid_init_data' }, '[auth] rejected initData');
        request.log.info(
          {
            hasSignature: params.has('signature'),
            hasHash: params.has('hash'),
            keysCount: [...params.keys()].length,
            authDate: params.get('auth_date')
          },
          '[auth] initData metadata'
        );
      }
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
    if (isDev) {
      request.log.info(
        {
          authStatus: 'ok',
          userId: user.id,
          telegramId: user.telegramId.toString()
        },
        '[auth] user validated'
      );
    }

    request.telegramUser = telegramUser;
    request.user = user;
  };
};
