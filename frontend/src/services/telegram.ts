export interface DisplayTelegramUser {
  id: string;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
}

export interface TelegramBootstrapState {
  isTelegramWebApp: boolean;
  mode: 'telegram' | 'mock' | 'none';
  initData: string | null;
  error: 'EMPTY_INIT_DATA' | null;
}

const DEV_MOCK_ENABLED = import.meta.env.VITE_DEV_MOCK_TELEGRAM === 'true';

let telegramReadyCalled = false;

const devLog = (message: string, details?: Record<string, unknown>): void => {
  if (!import.meta.env.DEV) {
    return;
  }

  if (details) {
    console.info(`[telegram] ${message}`, details);
    return;
  }

  console.info(`[telegram] ${message}`);
};

export const getTelegramWebApp = (): TelegramWebApp | null => {
  return window.Telegram?.WebApp ?? null;
};

export const bootstrapTelegram = (): TelegramBootstrapState => {
  const webApp = getTelegramWebApp();
  const isTelegramWebApp = Boolean(webApp);

  if (webApp && !telegramReadyCalled) {
    webApp.ready();
    webApp.expand();
    telegramReadyCalled = true;
  }

  const initData = webApp?.initData?.trim() ?? '';

  if (isTelegramWebApp && initData.length > 0) {
    const state: TelegramBootstrapState = {
      isTelegramWebApp,
      mode: 'telegram',
      initData,
      error: null
    };

    devLog('telegram auth detected', { initDataLength: initData.length, mode: 'telegram' });
    return state;
  }

  if (isTelegramWebApp && initData.length === 0 && DEV_MOCK_ENABLED) {
    const state: TelegramBootstrapState = {
      isTelegramWebApp,
      mode: 'mock',
      initData: 'dev-mock',
      error: null
    };

    devLog('telegram webapp without initData, using dev mock', { initDataLength: 0, mode: 'mock' });
    return state;
  }

  if (isTelegramWebApp && initData.length === 0) {
    const state: TelegramBootstrapState = {
      isTelegramWebApp,
      mode: 'none',
      initData: null,
      error: 'EMPTY_INIT_DATA'
    };

    devLog('telegram webapp without initData', { initDataLength: 0, mode: 'none' });
    return state;
  }

  if (DEV_MOCK_ENABLED) {
    const state: TelegramBootstrapState = {
      isTelegramWebApp,
      mode: 'mock',
      initData: 'dev-mock',
      error: null
    };

    devLog('dev mock mode enabled', { mode: 'mock' });
    return state;
  }

  const state: TelegramBootstrapState = {
    isTelegramWebApp,
    mode: 'none',
    initData: null,
    error: null
  };

  devLog('telegram auth unavailable', { mode: 'none' });
  return state;
};

export const getTelegramInitData = (): string | null => {
  return bootstrapTelegram().initData;
};

export const closeTelegramApp = (): void => {
  const webApp = getTelegramWebApp();
  webApp?.close();
};

export const getDisplayUser = (): DisplayTelegramUser | null => {
  const webApp = getTelegramWebApp();
  const telegramUser = webApp?.initDataUnsafe?.user;

  if (telegramUser) {
    return {
      id: String(telegramUser.id),
      firstName: telegramUser.first_name,
      lastName: telegramUser.last_name,
      username: telegramUser.username,
      photoUrl: telegramUser.photo_url
    };
  }

  const mode = bootstrapTelegram().mode;
  if (mode === 'mock') {
    return {
      id: 'dev-mock',
      firstName: import.meta.env.VITE_DEV_MOCK_FIRST_NAME ?? 'Dev',
      lastName: import.meta.env.VITE_DEV_MOCK_LAST_NAME,
      username: import.meta.env.VITE_DEV_MOCK_USERNAME
    };
  }

  return null;
};

const vibrateFallback = (pattern: number | number[]): void => {
  if (typeof navigator.vibrate !== 'function') {
    return;
  }

  navigator.vibrate(pattern);
};

export const triggerJumpHaptic = (enabled: boolean): void => {
  if (!enabled) {
    return;
  }

  const webApp = getTelegramWebApp();
  if (webApp?.HapticFeedback?.impactOccurred) {
    webApp.HapticFeedback.impactOccurred('light');
    return;
  }

  vibrateFallback(12);
};

export const triggerGameOverHaptic = (enabled: boolean): void => {
  if (!enabled) {
    return;
  }

  const webApp = getTelegramWebApp();
  if (webApp?.HapticFeedback?.notificationOccurred) {
    webApp.HapticFeedback.notificationOccurred('error');
    return;
  }

  if (webApp?.HapticFeedback?.impactOccurred) {
    webApp.HapticFeedback.impactOccurred('heavy');
    return;
  }

  vibrateFallback([25, 15, 25]);
};

export const triggerSuccessHaptic = (enabled: boolean): void => {
  if (!enabled) {
    return;
  }

  const webApp = getTelegramWebApp();
  if (webApp?.HapticFeedback?.notificationOccurred) {
    webApp.HapticFeedback.notificationOccurred('success');
    return;
  }

  if (webApp?.HapticFeedback?.impactOccurred) {
    webApp.HapticFeedback.impactOccurred('medium');
    return;
  }

  vibrateFallback([16, 14, 16]);
};
