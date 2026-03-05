import path from 'node:path';
import { existsSync } from 'node:fs';
import dotenv from 'dotenv';
import fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { prisma } from './db/prisma';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { gameRoutes } from './routes/game';
import { leaderboardRoutes } from './routes/leaderboard';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const app = fastify({
  logger: true
});

app.register(authRoutes, { prefix: '/api/auth' });
app.register(gameRoutes, { prefix: '/api/game' });
app.register(leaderboardRoutes, { prefix: '/api/leaderboard' });
app.register(adminRoutes, { prefix: '/api/admin' });

const frontendDist = path.resolve(__dirname, '../../frontend/dist');
if (existsSync(frontendDist)) {
  app.register(fastifyStatic, {
    root: frontendDist,
    prefix: '/'
  });
}

app.setNotFoundHandler(async (request, reply) => {
  if (request.url.startsWith('/api/')) {
    reply.code(404).send({ error: 'Route not found' });
    return;
  }

  if (existsSync(frontendDist)) {
    return reply.sendFile('index.html');
  }

  reply.code(404).send({ error: 'Frontend build not found. Run npm run build first.' });
});

app.addHook('onClose', async () => {
  await prisma.$disconnect();
});

const start = async (): Promise<void> => {
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const host = process.env.HOST ?? '0.0.0.0';

  try {
    await app.listen({ port, host });
    app.log.info(`Server started on http://${host}:${port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
