export interface DisplayTelegramUser {
  id: string;
  firstName: string;
  lastName?: string;
  username?: string;
}

export const getTelegramWebApp = (): TelegramWebApp | null => {
  return window.Telegram?.WebApp ?? null;
};

export const initTelegramApp = (): void => {
  const webApp = getTelegramWebApp();
  if (!webApp) {
    return;
  }

  webApp.ready();
  webApp.expand();
};

export const closeTelegramApp = (): void => {
  const webApp = getTelegramWebApp();
  webApp?.close();
};

export const getTelegramInitData = (): string | null => {
  const webApp = getTelegramWebApp();
  if (webApp?.initData) {
    return webApp.initData;
  }

  if (import.meta.env.VITE_DEV_MOCK_TELEGRAM === 'true') {
    return 'dev-mock';
  }

  return null;
};

export const getDisplayUser = (): DisplayTelegramUser | null => {
  const webApp = getTelegramWebApp();
  const telegramUser = webApp?.initDataUnsafe?.user;

  if (telegramUser) {
    return {
      id: String(telegramUser.id),
      firstName: telegramUser.first_name,
      lastName: telegramUser.last_name,
      username: telegramUser.username
    };
  }

  if (import.meta.env.VITE_DEV_MOCK_TELEGRAM === 'true') {
    return {
      id: 'dev-mock',
      firstName: import.meta.env.VITE_DEV_MOCK_FIRST_NAME ?? 'Dev',
      lastName: import.meta.env.VITE_DEV_MOCK_LAST_NAME,
      username: import.meta.env.VITE_DEV_MOCK_USERNAME
    };
  }

  return null;
};

export const triggerImpact = (enabled: boolean): void => {
  if (!enabled) {
    return;
  }

  const webApp = getTelegramWebApp();
  if (webApp?.HapticFeedback) {
    webApp.HapticFeedback.impactOccurred('light');
    return;
  }

  if (typeof navigator.vibrate === 'function') {
    navigator.vibrate(12);
  }
};
