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
import { startBestScoreReconciler, stopBestScoreReconciler } from './services/bestScoreReconciler';
import { startTelegramAdminBot, stopTelegramAdminBot } from './services/telegramAdminBot';

const envCandidates = [
  path.resolve(__dirname, '../.env'),
  path.resolve(process.cwd(), 'backend/.env'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../.env')
];

for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

const parseBooleanEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }
  return value === 'true';
};

const logLevel = process.env.LOG_LEVEL ?? 'info';
const prettyLogsEnabled = parseBooleanEnv(process.env.LOG_PRETTY, process.env.NODE_ENV !== 'production');
const requestLogsEnabled = parseBooleanEnv(process.env.LOG_REQUESTS, true);

const app = fastify({
  logger: prettyLogsEnabled
    ? {
        level: logLevel,
        serializers: {
          req: (request) => {
            return {
              id: request.id,
              method: request.method,
              url: request.url,
              host: request.hostname,
              remoteAddress: request.ip
            };
          },
          res: (reply) => {
            return {
              statusCode: reply.statusCode
            };
          }
        },
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: process.stdout.isTTY,
            singleLine: true,
            translateTime: 'yyyy-mm-dd HH:MM:ss.l',
            ignore: 'pid,hostname'
          }
        }
      }
    : {
        level: logLevel
      },
  disableRequestLogging: !requestLogsEnabled,
  bodyLimit: 256 * 1024,
  requestTimeout: 15_000,
  keepAliveTimeout: 60_000,
  maxParamLength: 200
});

let shuttingDown = false;

app.get('/healthz', async () => {
  return {
    ok: true,
    status: 'alive',
    uptimeSeconds: Math.floor(process.uptime())
  };
});

app.get('/readyz', async (request, reply) => {
  if (shuttingDown) {
    reply.code(503).send({ ok: false, status: 'shutting_down' });
    return;
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, status: 'ready' };
  } catch (error) {
    request.log.error(error, 'readiness check failed');
    reply.code(503).send({ ok: false, status: 'db_unavailable' });
  }
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
  stopBestScoreReconciler();
  stopTelegramAdminBot();
  await prisma.$disconnect();
});

const start = async (): Promise<void> => {
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const host = process.env.HOST ?? '0.0.0.0';

  try {
    await app.listen({ port, host });
    startBestScoreReconciler(app.log);
    void startTelegramAdminBot(app.log);
    app.log.info(`Server started on http://${host}:${port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  app.log.warn({ signal }, 'shutting down server');

  const forceExitTimer = setTimeout(() => {
    app.log.error('forced shutdown after timeout');
    process.exit(1);
  }, 10_000);

  try {
    await app.close();
    clearTimeout(forceExitTimer);
    process.exit(0);
  } catch (error) {
    clearTimeout(forceExitTimer);
    app.log.error(error, 'graceful shutdown failed');
    process.exit(1);
  }
};

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('uncaughtException', (error) => {
  app.log.error(error, 'uncaughtException');
  void shutdown('SIGTERM');
});

process.on('unhandledRejection', (reason) => {
  app.log.error({ reason }, 'unhandledRejection');
  void shutdown('SIGTERM');
});

void start();
