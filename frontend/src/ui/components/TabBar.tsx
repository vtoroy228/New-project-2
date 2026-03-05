import type { ReactNode } from 'react';

export interface TabBarItem<T extends string> {
  id: T;
  label: string;
  icon: ReactNode;
}

interface TabBarProps<T extends string> {
  tabs: TabBarItem<T>[];
  activeTab: T;
  onChange: (tab: T) => void;
}

export const TabBar = <T extends string>({ tabs, activeTab, onChange }: TabBarProps<T>) => {
  return (
    <nav className="tab-bar" aria-label="Main tabs">
      {tabs.map((tab) => (
        <button
          type="button"
          key={tab.id}
          className={`tab-item ${activeTab === tab.id ? 'tab-item-active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          <span className="tab-icon" aria-hidden>
            {tab.icon}
          </span>
          <span className="tab-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
};
