import { spawn } from 'node:child_process';
import {
  getCurrentLeaderboardMaxScore,
  getLatestLeaderboardBackupMeta,
  getRecentGameResults,
  rebuildBestScoresFromResults,
  resolveUserForAdmin,
  resetLeaderboardBestScores,
  restoreLatestLeaderboardBackup,
  setUserBestScoreById
} from './adminOperations';

interface BotLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
  error_code?: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramMessage {
  text?: string;
  chat: TelegramChat;
  from?: TelegramUser;
}

interface TelegramUser {
  id: number;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: string;
}

interface TelegramBotSelf {
  id: number;
  username?: string;
}

interface ReplyKeyboardMarkup {
  keyboard: Array<Array<{ text: string }>>;
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
}

interface ReplyKeyboardRemove {
  remove_keyboard: true;
}

interface InlineWebAppInfo {
  url: string;
}

interface InlineKeyboardButton {
  text: string;
  web_app?: InlineWebAppInfo;
  url?: string;
}

interface InlineKeyboardMarkup {
  inline_keyboard: Array<Array<InlineKeyboardButton>>;
}

type ReplyMarkup = ReplyKeyboardMarkup | ReplyKeyboardRemove | InlineKeyboardMarkup;

type AdminSession =
  | {
      kind: 'await_reset_confirmation';
    }
  | {
      kind: 'await_score_target';
    }
  | {
      kind: 'await_restore_confirmation';
    }
  | {
      kind: 'await_xtunnel_restart_confirmation';
    }
  | {
      kind: 'await_score_value';
      targetUserId: string;
      targetTelegramId: string;
      targetDisplayName: string;
      targetCurrentBestScore: number;
    };

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }
  return value === 'true';
};

const parseIntSafe = (value: string): number | null => {
  if (!/^-?\d+$/.test(value.trim())) {
    return null;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatDisplayName = (user: {
  firstName: string;
  lastName: string | null;
  username: string | null;
}): string => {
  const fullName = `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`.trim();
  if (user.username) {
    return `${fullName} (@${user.username})`;
  }
  return fullName;
};

const formatUtcDateTime = (date: Date): string => {
  const iso = date.toISOString().replace('T', ' ');
  return `${iso.slice(0, 19)} UTC`;
};

const toAdminTelegramId = (value: number): bigint | undefined => {
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
};

const BUTTON_RESET = '🧹 Очистить лидерборд';
const BUTTON_RESTORE = '↩️ Вернуть бэкап';
const BUTTON_SET_SCORE = '✏️ Изменить очки';
const BUTTON_RECENT_GAMES = '🕹 Последние 15 игр';
const BUTTON_REBUILD = '♻️ Обновить bestScore';
const BUTTON_RESTART_XTUNNEL = '🔁 Перезапустить xtunnel';
const BUTTON_HIDE = '🙈 Скрыть меню';
const BUTTON_LAUNCH = 'ЗАПУСТИТЬ';
const START_COMMAND = '/start';
const XTUNNEL_RESTART_CONFIRMATION = 'RESTART XTUNNEL';

interface ShellCommandResult {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = parseIntSafe(value);
  if (parsed === null || parsed < 1) {
    return fallback;
  }

  return parsed;
};

const isXtunnelRestartEnabled = (): boolean => {
  return parseBoolean(process.env.TELEGRAM_ADMIN_XTUNNEL_RESTART_ENABLED, false);
};

const getXtunnelRestartCommand = (): string => {
  const configured = (process.env.TELEGRAM_ADMIN_XTUNNEL_RESTART_COMMAND ?? '').trim();
  return configured || 'bash ./ops/xtunnel-loop.sh restart';
};

const getXtunnelRestartTimeoutMs = (): number => {
  return parsePositiveInt(process.env.TELEGRAM_ADMIN_XTUNNEL_RESTART_TIMEOUT_MS, 45_000);
};

const getXtunnelRestartConfirmationToken = (): string => {
  const raw = (process.env.TELEGRAM_ADMIN_XTUNNEL_RESTART_CONFIRMATION ?? XTUNNEL_RESTART_CONFIRMATION)
    .trim()
    .toUpperCase();
  return raw.length > 0 ? raw : XTUNNEL_RESTART_CONFIRMATION;
};

const clipText = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}\n...truncated`;
};

const formatCommandOutput = (stdout: string, stderr: string): string => {
  const chunks: string[] = [];

  const trimmedStdout = stdout.trim();
  if (trimmedStdout.length > 0) {
    chunks.push(`stdout:\n${clipText(trimmedStdout, 1200)}`);
  }

  const trimmedStderr = stderr.trim();
  if (trimmedStderr.length > 0) {
    chunks.push(`stderr:\n${clipText(trimmedStderr, 1200)}`);
  }

  return chunks.length > 0 ? `\n\n${chunks.join('\n\n')}` : '';
};

const runShellCommand = async (command: string, timeoutMs: number): Promise<ShellCommandResult> => {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-lc', command], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timeoutKillTimer: NodeJS.Timeout | null = null;

    const append = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString('utf8');
      if (next.length <= 6000) {
        return next;
      }

      return next.slice(0, 6000);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');

      timeoutKillTimer = setTimeout(() => {
        child.kill('SIGKILL');
      }, 2000);
      timeoutKillTimer.unref();
    }, timeoutMs);
    timeout.unref();

    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      if (timeoutKillTimer) {
        clearTimeout(timeoutKillTimer);
      }

      resolve({
        ok: !timedOut && code === 0,
        exitCode: code,
        signal,
        timedOut,
        stdout,
        stderr
      });
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      if (timeoutKillTimer) {
        clearTimeout(timeoutKillTimer);
      }

      resolve({
        ok: false,
        exitCode: null,
        signal: null,
        timedOut,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim()
      });
    });
  });
};

const buildAdminKeyboard = (): ReplyKeyboardMarkup => {
  return {
    keyboard: [
      [{ text: BUTTON_RESET }, { text: BUTTON_SET_SCORE }],
      [{ text: BUTTON_RESTORE }, { text: BUTTON_REBUILD }],
      [{ text: BUTTON_RECENT_GAMES }, { text: BUTTON_RESTART_XTUNNEL }],
      [{ text: BUTTON_HIDE }]
    ],
    resize_keyboard: true
  };
};

const buildHideKeyboard = (): ReplyKeyboardRemove => {
  return {
    remove_keyboard: true
  };
};

const getAdminSet = (): Set<string> => {
  const raw = process.env.ADMIN_TELEGRAM_IDS ?? '';
  return new Set(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
};

let running = false;
let pollTimer: NodeJS.Timeout | null = null;
let updateOffset = 0;
const sessions = new Map<number, AdminSession>();
let warnedAboutWebhookConflict = false;

const getHiddenCommand = (): string => {
  const value = (process.env.TELEGRAM_ADMIN_HIDDEN_COMMAND ?? '/__admin').trim();
  return value.startsWith('/') ? value : `/${value}`;
};

const getMiniAppUrl = (botUsername?: string): string | null => {
  const configuredUrl = (process.env.TELEGRAM_MINI_APP_URL ?? '').trim();
  if (configuredUrl.length > 0) {
    return configuredUrl;
  }

  if (botUsername) {
    return `https://t.me/${botUsername}?startapp=play`;
  }

  return null;
};

const getCommandToken = (text: string): string => {
  const [token = ''] = text.trim().toLowerCase().split(/\s+/, 1);
  return token;
};

const isStartCommand = (text: string): boolean => {
  const token = getCommandToken(text);
  return token === START_COMMAND || token.startsWith(`${START_COMMAND}@`);
};

const isCommand = (text: string, command: string): boolean => {
  if (text === command) {
    return true;
  }

  return text.startsWith(`${command}@`);
};

const toTelegramApiUrl = (botToken: string, method: string): string => {
  return `https://api.telegram.org/bot${botToken}/${method}`;
};

const toErrorLogPayload = (error: unknown): Record<string, unknown> => {
  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: number | string };
    return {
      err: error,
      errorName: error.name,
      errorMessage: error.message,
      errorCode: errorWithCode.code
    };
  }

  return {
    errorValue: error,
    errorMessage: String(error)
  };
};

const buildLaunchKeyboard = (miniAppUrl: string, preferWebAppButton: boolean): InlineKeyboardMarkup => {
  const launchButton: InlineKeyboardButton = preferWebAppButton
    ? {
        text: BUTTON_LAUNCH,
        web_app: {
          url: miniAppUrl
        }
      }
    : {
        text: BUTTON_LAUNCH,
        url: miniAppUrl
      };

  return {
    inline_keyboard: [[launchButton]]
  };
};

const callTelegramApi = async <T>(
  botToken: string,
  method: string,
  payload: Record<string, unknown>,
  timeoutMs = 30_000
): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(toTelegramApiUrl(botToken, method), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const data = (await response.json()) as TelegramApiResponse<T>;
    if (!response.ok || !data.ok) {
      const description = data.description ?? `HTTP ${response.status}`;
      const error = new Error(description) as Error & { code?: number };
      error.code = data.error_code ?? response.status;
      throw error;
    }

    return data.result;
  } catch (error) {
    const domException = error as DOMException;
    if (domException?.name === 'AbortError') {
      const timeoutError = new Error(`Telegram API request timed out after ${timeoutMs}ms`) as Error & {
        code?: string;
      };
      timeoutError.name = 'TelegramRequestTimeoutError';
      timeoutError.code = 'REQUEST_TIMEOUT';
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const sendMessage = async (
  botToken: string,
  chatId: number,
  text: string,
  replyMarkup?: ReplyMarkup
): Promise<void> => {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text
  };

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  await callTelegramApi(botToken, 'sendMessage', payload, 15_000);
};

const showAdminPanel = async (botToken: string, chatId: number, hiddenCommand: string): Promise<void> => {
  await sendMessage(
    botToken,
    chatId,
    `Админ-панель активирована.\nКоманды доступны через кнопки ниже.\nДля отмены текущего действия: /cancel\nДля скрытия панели: ${BUTTON_HIDE}\nСкрытая команда: ${hiddenCommand}`,
    buildAdminKeyboard()
  );
};

const sendWelcomeMessage = async (
  botToken: string,
  chatId: number,
  miniAppUrl: string | null,
  preferWebAppButton: boolean
): Promise<void> => {
  const message =
    'Привет! Я игра csfst, ' +
    'где ты типо нокиасися и прыгаешь через хрущевки.\n' +
    'Жми кнопку ниже и запускай забег.';

  const replyMarkup = miniAppUrl
    ? buildLaunchKeyboard(miniAppUrl, preferWebAppButton)
    : undefined;

  await sendMessage(botToken, chatId, message, replyMarkup);
};

const parseScore = (raw: string): number | null => {
  const parsed = parseIntSafe(raw);
  if (parsed === null || parsed < 0) {
    return null;
  }
  return parsed;
};

const handleSessionMessage = async (
  botToken: string,
  chatId: number,
  adminTelegramId: number,
  text: string,
  session: AdminSession
): Promise<void> => {
  if (session.kind === 'await_reset_confirmation') {
    const providedMax = parseScore(text);
    if (providedMax === null) {
      await sendMessage(botToken, chatId, 'Введите целое число (текущий максимальный счёт) или /cancel.');
      return;
    }

    const actualMax = await getCurrentLeaderboardMaxScore();
    if (providedMax !== actualMax) {
      await sendMessage(
        botToken,
        chatId,
        `Подтверждение не прошло: введено ${providedMax}, актуальный max сейчас ${actualMax}. Попробуйте снова или /cancel.`
      );
      return;
    }

    const resetResult = await resetLeaderboardBestScores({
      createdByTelegramId: toAdminTelegramId(adminTelegramId),
      confirmationMaxScore: providedMax
    });
    sessions.delete(chatId);
    await sendMessage(
      botToken,
      chatId,
      `Лидерборд очищен.\nОбновлено пользователей: ${resetResult.affectedUsers}\nBackup ID: ${resetResult.backupId}\nBackup max score: ${resetResult.backupMaxScore}\nНовая эпоха: ${resetResult.epochStart}`
    );
    return;
  }

  if (session.kind === 'await_restore_confirmation') {
    const providedMax = parseScore(text);
    if (providedMax === null) {
      await sendMessage(botToken, chatId, 'Введите целое число (max score из бэкапа) или /cancel.');
      return;
    }

    const restoreResult = await restoreLatestLeaderboardBackup({
      expectedMaxScore: providedMax,
      restoredByTelegramId: toAdminTelegramId(adminTelegramId)
    });

    if (!restoreResult.restored) {
      if (restoreResult.reason === 'no_backup') {
        sessions.delete(chatId);
        await sendMessage(botToken, chatId, 'Бэкап лидерборда не найден.');
        return;
      }

      await sendMessage(
        botToken,
        chatId,
        `Подтверждение не прошло: введено ${restoreResult.providedMaxScore}, ожидается ${restoreResult.expectedMaxScore}. Попробуйте снова или /cancel.`
      );
      return;
    }

    sessions.delete(chatId);
    await sendMessage(
      botToken,
      chatId,
      `Бэкап восстановлен.\nBackup ID: ${restoreResult.backupId}\nВосстановлено пользователей: ${restoreResult.restoredUsers}\nВосстановленный max score: ${restoreResult.backupMaxScore}\nЭпоха откатена к: ${restoreResult.epochStart}`
    );
    return;
  }

  if (session.kind === 'await_xtunnel_restart_confirmation') {
    const expectedConfirmation = getXtunnelRestartConfirmationToken();
    if (text.trim().toUpperCase() !== expectedConfirmation) {
      await sendMessage(
        botToken,
        chatId,
        `Подтверждение не принято. Отправьте точно: ${expectedConfirmation}\nИли /cancel.`
      );
      return;
    }

    sessions.delete(chatId);

    if (!isXtunnelRestartEnabled()) {
      await sendMessage(botToken, chatId, 'Перезапуск xtunnel отключен в конфиге (TELEGRAM_ADMIN_XTUNNEL_RESTART_ENABLED=false).');
      return;
    }

    const command = getXtunnelRestartCommand();
    const timeoutMs = getXtunnelRestartTimeoutMs();

    await sendMessage(botToken, chatId, 'Запускаю перезапуск xtunnel...');
    const result = await runShellCommand(command, timeoutMs);
    const output = formatCommandOutput(result.stdout, result.stderr);

    if (result.ok) {
      await sendMessage(
        botToken,
        chatId,
        `xtunnel перезапущен успешно.\nExit code: ${result.exitCode ?? 'n/a'}${output}`
      );
      return;
    }

    const failureReason = result.timedOut
      ? `timeout after ${timeoutMs}ms`
      : `exit code ${result.exitCode ?? 'n/a'}${result.signal ? `, signal ${result.signal}` : ''}`;

    await sendMessage(
      botToken,
      chatId,
      `Перезапуск xtunnel завершился с ошибкой (${failureReason}).${output}`
    );
    return;
  }

  if (session.kind === 'await_score_target') {
    const target = await resolveUserForAdmin(text);
    if (!target) {
      await sendMessage(
        botToken,
        chatId,
        'Пользователь не найден. Отправьте корректный @username или Telegram ID, либо /cancel.'
      );
      return;
    }

    const targetDisplayName = formatDisplayName(target);
    sessions.set(chatId, {
      kind: 'await_score_value',
      targetUserId: target.id,
      targetTelegramId: target.telegramId,
      targetDisplayName,
      targetCurrentBestScore: target.bestScore
    });

    await sendMessage(
      botToken,
      chatId,
      `Найден: ${targetDisplayName}\nTelegram ID: ${target.telegramId}\nТекущий bestScore: ${target.bestScore}\nВведите новый bestScore (целое число >= 0).`
    );
    return;
  }

  const newScore = parseScore(text);
  if (newScore === null) {
    await sendMessage(botToken, chatId, 'Введите корректное целое число >= 0 или /cancel.');
    return;
  }

  const updated = await setUserBestScoreById(session.targetUserId, newScore);
  sessions.delete(chatId);
  await sendMessage(
    botToken,
    chatId,
    `bestScore обновлён:\n${session.targetDisplayName}\nTelegram ID: ${session.targetTelegramId}\nБыло: ${session.targetCurrentBestScore}\nСтало: ${updated.bestScore}`
  );
};

const handleAdminCommand = async (
  botToken: string,
  hiddenCommand: string,
  message: TelegramMessage
): Promise<void> => {
  const from = message.from;
  const text = message.text?.trim();
  const chatId = message.chat.id;
  const adminTelegramId = from?.id;

  if (!from || !text || adminTelegramId === undefined) {
    return;
  }

  if (isCommand(text, '/cancel')) {
    sessions.delete(chatId);
    await sendMessage(botToken, chatId, 'Текущее действие отменено.');
    return;
  }

  if (isCommand(text, hiddenCommand)) {
    sessions.delete(chatId);
    await showAdminPanel(botToken, chatId, hiddenCommand);
    return;
  }

  if (text === BUTTON_HIDE) {
    sessions.delete(chatId);
    await sendMessage(botToken, chatId, 'Админ-меню скрыто.', buildHideKeyboard());
    return;
  }

  const session = sessions.get(chatId);
  if (session) {
    await handleSessionMessage(botToken, chatId, adminTelegramId, text, session);
    return;
  }

  if (text === BUTTON_RESET) {
    sessions.set(chatId, { kind: 'await_reset_confirmation' });
    const maxScore = await getCurrentLeaderboardMaxScore();
    await sendMessage(
      botToken,
      chatId,
      `Подтверждение очистки лидерборда.\nВведите вручную текущий максимальный счёт: ${maxScore}\n(или /cancel)`
    );
    return;
  }

  if (text === BUTTON_SET_SCORE) {
    sessions.set(chatId, { kind: 'await_score_target' });
    await sendMessage(
      botToken,
      chatId,
      'Отправьте @username или Telegram ID пользователя, которому нужно изменить bestScore.'
    );
    return;
  }

  if (text === BUTTON_RESTORE) {
    const backupMeta = await getLatestLeaderboardBackupMeta();
    if (!backupMeta) {
      await sendMessage(botToken, chatId, 'Бэкап лидерборда пока не создан.');
      return;
    }

    sessions.set(chatId, {
      kind: 'await_restore_confirmation'
    });
    await sendMessage(
      botToken,
      chatId,
      `Подтверждение восстановления бэкапа.\nBackup ID: ${backupMeta.backupId}\nСоздан: ${backupMeta.createdAt}\nМаксимальный счёт в бэкапе: ${backupMeta.maxScore}\nВведите это число вручную для подтверждения (или /cancel).`
    );
    return;
  }

  if (text === BUTTON_RECENT_GAMES) {
    const games = await getRecentGameResults(15);
    if (games.length === 0) {
      await sendMessage(botToken, chatId, 'Игры пока не найдены.');
      return;
    }

    const lines = games.map((game, index) => {
      const name = formatDisplayName(game.user);
      return `${index + 1}. ${name} | tg:${game.user.telegramId} | score:${game.score} | time:${game.playTime}s | obstacles:${game.obstacles} | ${formatUtcDateTime(game.createdAt)}`;
    });

    await sendMessage(botToken, chatId, `Последние 15 игр:\n\n${lines.join('\n')}`);
    return;
  }

  if (text === BUTTON_RESTART_XTUNNEL) {
    if (!isXtunnelRestartEnabled()) {
      await sendMessage(
        botToken,
        chatId,
        'Перезапуск xtunnel отключен. Включите TELEGRAM_ADMIN_XTUNNEL_RESTART_ENABLED=true в .env и перезапустите backend.'
      );
      return;
    }

    const confirmation = getXtunnelRestartConfirmationToken();
    sessions.set(chatId, {
      kind: 'await_xtunnel_restart_confirmation'
    });
    await sendMessage(
      botToken,
      chatId,
      `Подтвердите перезапуск xtunnel.\nОтправьте точно: ${confirmation}\nДля отмены: /cancel`
    );
    return;
  }

  if (text === BUTTON_REBUILD) {
    await sendMessage(botToken, chatId, 'Запускаю пересчёт bestScore...');
    const rebuild = await rebuildBestScoresFromResults();
    await sendMessage(
      botToken,
      chatId,
      `Пересчёт завершён.\nЭпоха: ${rebuild.epochStart}\nПользователей с bestScore > 0: ${rebuild.playersWithScore}\nТоп-5: ${rebuild.top.map((item) => `${item.id}:${item.bestScore}`).join(', ') || 'нет данных'}`
    );
  }
};

const handleUpdate = async (
  botToken: string,
  hiddenCommand: string,
  adminSet: Set<string>,
  logger: BotLogger,
  miniAppUrl: string | null,
  preferWebAppButton: boolean,
  update: TelegramUpdate
): Promise<void> => {
  if (!update.message) {
    return;
  }

  const message = update.message;
  if (message.chat.type !== 'private') {
    return;
  }

  const text = message.text?.trim();
  if (text && isStartCommand(text)) {
    try {
      await sendWelcomeMessage(botToken, message.chat.id, miniAppUrl, preferWebAppButton);
    } catch (error) {
      logger.error(toErrorLogPayload(error), '[admin-bot] failed to send welcome message');
    }
    return;
  }

  const from = message.from;
  if (!from) {
    return;
  }

  if (!adminSet.has(from.id.toString())) {
    return;
  }

  try {
    await handleAdminCommand(botToken, hiddenCommand, message);
  } catch (error) {
    logger.error(
      {
        ...toErrorLogPayload(error),
        adminTelegramId: from.id
      },
      '[admin-bot] command failed'
    );
    await sendMessage(botToken, message.chat.id, 'Ошибка выполнения команды. Проверьте формат данных и попробуйте снова.');
  }
};

const scheduleNextPoll = (fn: () => Promise<void>, delayMs: number): void => {
  if (!running) {
    return;
  }

  pollTimer = setTimeout(() => {
    void fn();
  }, delayMs);
  pollTimer.unref();
};

export const startTelegramAdminBot = async (logger: BotLogger): Promise<void> => {
  if (running) {
    return;
  }

  const enabled = parseBoolean(process.env.TELEGRAM_ADMIN_BOT_ENABLED, false);
  if (!enabled) {
    return;
  }

  const botToken = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (!botToken) {
    logger.warn('[admin-bot] TELEGRAM_BOT_TOKEN missing, bot listener is disabled');
    return;
  }

  const adminSet = getAdminSet();
  if (adminSet.size === 0) {
    logger.warn('[admin-bot] ADMIN_TELEGRAM_IDS is empty, admin panel commands are disabled');
  }

  const hiddenCommand = getHiddenCommand();
  const autoDeleteWebhook = parseBoolean(process.env.TELEGRAM_ADMIN_BOT_AUTO_DELETE_WEBHOOK, true);
  const pollTimeoutSeconds = parsePositiveInt(process.env.TELEGRAM_ADMIN_BOT_POLL_TIMEOUT_SECONDS, 25);
  const pollRequestTimeoutMs = parsePositiveInt(
    process.env.TELEGRAM_ADMIN_BOT_POLL_REQUEST_TIMEOUT_MS,
    pollTimeoutSeconds * 1000 + 20_000
  );
  const xtunnelRestartEnabled = isXtunnelRestartEnabled();
  const xtunnelRestartCommandConfigured =
    (process.env.TELEGRAM_ADMIN_XTUNNEL_RESTART_COMMAND ?? '').trim().length > 0;
  const configuredMiniAppUrl = (process.env.TELEGRAM_MINI_APP_URL ?? '').trim();
  let miniAppUrl: string | null = null;
  const preferWebAppButton = configuredMiniAppUrl.length > 0;
  running = true;
  warnedAboutWebhookConflict = false;
  let warnedAboutPollingTimeout = false;
  updateOffset = 0;
  sessions.clear();

  try {
    const me = await callTelegramApi<TelegramBotSelf>(botToken, 'getMe', {}, 10_000);
    miniAppUrl = getMiniAppUrl(me.username);
    if (autoDeleteWebhook) {
      await callTelegramApi<boolean>(
        botToken,
        'deleteWebhook',
        {
          drop_pending_updates: false
        },
        10_000
      );
    }

    logger.info(
      {
        botId: me.id,
        botUsername: me.username,
        admins: adminSet.size,
        hiddenCommand,
        autoDeleteWebhook,
        pollTimeoutSeconds,
        pollRequestTimeoutMs,
        miniAppUrlConfigured: Boolean(miniAppUrl),
        xtunnelRestartEnabled,
        xtunnelRestartCommandConfigured
      },
      '[admin-bot] started'
    );

    if (!miniAppUrl) {
      logger.warn('[admin-bot] mini app URL is not configured; /start welcome will be sent without launch button');
    }

    if (xtunnelRestartEnabled && !xtunnelRestartCommandConfigured) {
      logger.info(
        '[admin-bot] TELEGRAM_ADMIN_XTUNNEL_RESTART_COMMAND is not set, default command will be used: bash ./ops/xtunnel-loop.sh restart'
      );
    }
  } catch (error) {
    running = false;
    logger.error(toErrorLogPayload(error), '[admin-bot] failed to initialize');
    return;
  }

  const poll = async (): Promise<void> => {
    if (!running) {
      return;
    }

    try {
      const updates = await callTelegramApi<TelegramUpdate[]>(
        botToken,
        'getUpdates',
        {
          timeout: pollTimeoutSeconds,
          offset: updateOffset,
          allowed_updates: ['message']
        },
        pollRequestTimeoutMs
      );

      warnedAboutPollingTimeout = false;

      for (const update of updates) {
        if (update.update_id >= updateOffset) {
          updateOffset = update.update_id + 1;
        }

        await handleUpdate(
          botToken,
          hiddenCommand,
          adminSet,
          logger,
          miniAppUrl,
          preferWebAppButton,
          update
        );
      }

      scheduleNextPoll(poll, 0);
    } catch (error) {
      const apiError = error as Error & { code?: number | string };
      const isPollingTimeout =
        apiError.code === 'REQUEST_TIMEOUT' || apiError.name === 'AbortError' || apiError.code === 20;

      if (isPollingTimeout) {
        if (!warnedAboutPollingTimeout) {
          warnedAboutPollingTimeout = true;
          logger.warn(
            {
              pollTimeoutSeconds,
              pollRequestTimeoutMs
            },
            '[admin-bot] getUpdates request timed out, retrying'
          );
        }

        scheduleNextPoll(poll, 1000);
        return;
      }

      if (apiError.code === 409 && !warnedAboutWebhookConflict) {
        warnedAboutWebhookConflict = true;
        logger.warn(
          '[admin-bot] getUpdates conflict (409). Disable webhook for this token or keep bot polling disabled.'
        );
      } else {
        logger.error(toErrorLogPayload(error), '[admin-bot] polling failed');
      }

      scheduleNextPoll(poll, 2000);
    }
  };

  scheduleNextPoll(poll, 0);
};

export const stopTelegramAdminBot = (): void => {
  running = false;
  sessions.clear();

  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
};
