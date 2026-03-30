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

type ReplyMarkup = ReplyKeyboardMarkup | ReplyKeyboardRemove;

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
const BUTTON_HIDE = '🙈 Скрыть меню';

const buildAdminKeyboard = (): ReplyKeyboardMarkup => {
  return {
    keyboard: [
      [{ text: BUTTON_RESET }, { text: BUTTON_SET_SCORE }],
      [{ text: BUTTON_RESTORE }, { text: BUTTON_REBUILD }],
      [{ text: BUTTON_RECENT_GAMES }],
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
  update: TelegramUpdate
): Promise<void> => {
  if (!update.message) {
    return;
  }

  const message = update.message;
  if (message.chat.type !== 'private') {
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
    logger.warn('[admin-bot] ADMIN_TELEGRAM_IDS is empty, bot listener is disabled');
    return;
  }

  const hiddenCommand = getHiddenCommand();
  const autoDeleteWebhook = parseBoolean(process.env.TELEGRAM_ADMIN_BOT_AUTO_DELETE_WEBHOOK, true);
  running = true;
  warnedAboutWebhookConflict = false;
  updateOffset = 0;
  sessions.clear();

  try {
    const me = await callTelegramApi<TelegramBotSelf>(botToken, 'getMe', {}, 10_000);
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
        autoDeleteWebhook
      },
      '[admin-bot] started'
    );
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
          timeout: 25,
          offset: updateOffset,
          allowed_updates: ['message']
        },
        35_000
      );

      for (const update of updates) {
        if (update.update_id >= updateOffset) {
          updateOffset = update.update_id + 1;
        }

        await handleUpdate(botToken, hiddenCommand, adminSet, logger, update);
      }

      scheduleNextPoll(poll, 0);
    } catch (error) {
      const apiError = error as Error & { code?: number };
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
