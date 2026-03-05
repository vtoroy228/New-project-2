export type TabId = 'leaderboard' | 'game' | 'profile';

export interface TabDefinition {
  id: TabId;
  label: string;
  icon: string;
}

export const APP_TABS: TabDefinition[] = [
  {
    id: 'leaderboard',
    label: 'Рейтинг',
    icon: '🏆'
  },
  {
    id: 'game',
    label: 'Игра',
    icon: '🎮'
  },
  {
    id: 'profile',
    label: 'Профиль',
    icon: '👤'
  }
];
