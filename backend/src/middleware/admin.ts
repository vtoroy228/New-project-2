import type { FastifyReply, FastifyRequest } from 'fastify';

const getAdminSet = (): Set<string> => {
  const raw = process.env.ADMIN_TELEGRAM_IDS ?? '';
  return new Set(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
};

export const adminMiddleware = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> => {
  const user = request.user;
  if (!user) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  const adminSet = getAdminSet();
  if (!adminSet.has(user.telegramId.toString())) {
    reply.code(403).send({ error: 'Admin access required' });
    return;
  }
};
