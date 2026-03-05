import type { FastifyReply, FastifyRequest } from 'fastify';

interface RateLimitOptions {
  windowMs: number;
  max: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

const getClientIp = (request: FastifyRequest): string => {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() ?? request.ip;
  }

  return request.ip;
};

const cleanup = (): void => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
};

export const rateLimit = (name: string, options: RateLimitOptions) => {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    cleanup();

    const now = Date.now();
    const ip = getClientIp(request);
    const key = `${name}:${ip}`;
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, {
        count: 1,
        resetAt: now + options.windowMs
      });
      return;
    }

    if (current.count >= options.max) {
      const retryAfterSeconds = Math.ceil((current.resetAt - now) / 1000);
      reply.header('Retry-After', String(Math.max(1, retryAfterSeconds)));
      reply.code(429).send({ error: 'Too many requests' });
      return;
    }

    current.count += 1;
    buckets.set(key, current);
  };
};
