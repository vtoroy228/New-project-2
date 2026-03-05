import type { User } from '@prisma/client';
import type { TelegramInitDataUser } from '../services/telegramAuth';

declare module 'fastify' {
  interface FastifyRequest {
    telegramUser?: TelegramInitDataUser;
    user?: User;
  }
}
