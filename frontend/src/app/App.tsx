import { useEffect, useMemo, useState } from 'react';
import { APP_TABS } from './router';
import type { TabId } from './router';
import { GameScreen } from '../screens/GameScreen';
import { LeaderboardScreen } from '../screens/LeaderboardScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { validateAuth } from '../services/api';
import { TabBar } from '../ui/components/TabBar';
import { useTheme } from '../ui/theme/useTheme';
import { closeTelegramApp, getDisplayUser, initTelegramApp } from '../services/telegram';

export const App = () => {
  useTheme();
  const [activeTab, setActiveTab] = useState<TabId>('game');
  const [settingsTrigger, setSettingsTrigger] = useState(0);

  useEffect(() => {
    initTelegramApp();

    const syncAuth = async () => {
      try {
        await validateAuth();
      } catch (error) {
        console.warn('Auth validation skipped', error);
      }
    };

    void syncAuth();
  }, []);

  const displayUser = useMemo(() => getDisplayUser(), []);

  const headerName = displayUser
    ? displayUser.username
      ? `@${displayUser.username}`
      : [displayUser.firstName, displayUser.lastName].filter(Boolean).join(' ')
    : 'Guest';

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

        <button
          type="button"
          className="icon-button"
          onClick={() => {
            if (activeTab === 'game') {
              setSettingsTrigger((current) => current + 1);
            }
          }}
          aria-label="Open menu"
        >
          ⋯
        </button>
      </header>

      <main className="app-content">
        {activeTab === 'leaderboard' ? <LeaderboardScreen /> : null}
        {activeTab === 'game' ? <GameScreen settingsTrigger={settingsTrigger} /> : null}
        {activeTab === 'profile' ? <ProfileScreen /> : null}
      </main>

      <TabBar tabs={APP_TABS} activeTab={activeTab} onChange={setActiveTab} />
    </div>
  );
};
