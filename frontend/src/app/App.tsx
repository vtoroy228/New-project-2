import { useEffect, useMemo, useState } from 'react';
import { APP_TABS } from './router';
import type { TabId } from './router';
import { GameScreen } from '../screens/GameScreen';
import { LeaderboardScreen } from '../screens/LeaderboardScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { ApiError, validateAuth } from '../services/api';
import type { ApiUser } from '../services/api';
import { TabBar } from '../ui/components/TabBar';
import { useTheme } from '../ui/theme/useTheme';
import {
  bootstrapTelegram,
  closeTelegramApp,
  getDisplayUser
} from '../services/telegram';

type AuthViewState = 'loading' | 'authorized' | 'error';

const devLog = (message: string, details?: Record<string, unknown>): void => {
  if (!import.meta.env.DEV) {
    return;
  }

  if (details) {
    console.info(`[app] ${message}`, details);
    return;
  }

  console.info(`[app] ${message}`);
};

export const App = () => {
  useTheme();

  const [activeTab, setActiveTab] = useState<TabId>('game');
  const [authState, setAuthState] = useState<AuthViewState>('loading');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<ApiUser | null>(null);

  useEffect(() => {
    const bootstrap = bootstrapTelegram();
    devLog('bootstrap auth mode', {
      mode: bootstrap.mode,
      isTelegramWebApp: bootstrap.isTelegramWebApp,
      initDataLength: bootstrap.initData?.length ?? 0,
      error: bootstrap.error
    });

    if (bootstrap.error === 'EMPTY_INIT_DATA') {
      setAuthState('error');
      setAuthError('Откройте приложение через кнопку бота (WebApp)');
      return;
    }

    if (bootstrap.mode === 'none') {
      setAuthState('error');
      setAuthError('Откройте приложение в Telegram или включите VITE_DEV_MOCK_TELEGRAM=true для dev.');
      return;
    }

    const syncAuth = async () => {
      try {
        const response = await validateAuth();
        setAuthUser(response.user);
        setAuthState('authorized');
        setAuthError(null);
        devLog('auth validated', {
          userId: response.user.id,
          telegramId: response.user.telegramId
        });
      } catch (error) {
        const message =
          error instanceof ApiError ? error.message : 'Не удалось подтвердить авторизацию';
        setAuthState('error');
        setAuthError(message);
        devLog('auth validation failed', {
          error: message,
          status: error instanceof ApiError ? error.status : 'unknown'
        });
      }
    };

    void syncAuth();
  }, []);

  const fallbackUser = useMemo(() => getDisplayUser(), []);

  const headerName = authUser
    ? authUser.username
      ? `@${authUser.username}`
      : [authUser.firstName, authUser.lastName ?? ''].join(' ').trim()
    : fallbackUser
      ? fallbackUser.username
        ? `@${fallbackUser.username}`
        : [fallbackUser.firstName, fallbackUser.lastName ?? ''].join(' ').trim()
      : 'Guest';

  if (authState === 'loading') {
    return (
      <div className="app-shell">
        <main className="app-content app-centered">Подключение...</main>
      </div>
    );
  }

  if (authState === 'error') {
    return (
      <div className="app-shell">
        <header className="app-header">
          <button type="button" className="icon-button" onClick={closeTelegramApp} aria-label="Close app">
            ✕
          </button>
          <div className="header-user">
            <span className="header-avatar">!</span>
            <span className="header-name">Ошибка авторизации</span>
          </div>
          <span className="icon-button icon-button-placeholder" aria-hidden>
            ·
          </span>
        </header>

        <main className="app-content app-centered">
          <div className="card auth-error-card">{authError ?? 'Ошибка авторизации'}</div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button type="button" className="icon-button" onClick={closeTelegramApp} aria-label="Close app">
          ✕
        </button>

        <div className="header-user">
          <span className="header-avatar">{headerName.slice(0, 1).toUpperCase()}</span>
          <span className="header-name">{headerName}</span>
        </div>

        <button type="button" className="icon-button" aria-label="Menu">
          ⋯
        </button>
      </header>

      <main className="app-content">
        {activeTab === 'leaderboard' ? <LeaderboardScreen /> : null}
        {activeTab === 'game' ? <GameScreen /> : null}
        {activeTab === 'profile' ? <ProfileScreen /> : null}
      </main>

      <TabBar tabs={APP_TABS} activeTab={activeTab} onChange={setActiveTab} />
    </div>
  );
};
