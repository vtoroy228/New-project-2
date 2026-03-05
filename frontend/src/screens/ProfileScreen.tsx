import { useEffect, useState } from 'react';
import { getMe } from '../services/api';
import type { ApiUser } from '../services/api';
import { Card } from '../ui/components/Card';

const formatDuration = (seconds: number): string => {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remain = safe % 60;

  if (hours > 0) {
    return `${hours}ч ${minutes}м ${remain}с`;
  }

  return `${minutes}м ${remain}с`;
};

const asBigIntString = (value: string): string => {
  try {
    return BigInt(value).toString();
  } catch {
    return '0';
  }
};

export const ProfileScreen = () => {
  const [user, setUser] = useState<ApiUser | null>(null);

  useEffect(() => {
    let active = true;

    const fetchMe = async () => {
      try {
        const response = await getMe();
        if (active) {
          setUser(response.user);
        }
      } catch (error) {
        console.warn('Failed to load profile', error);
      }
    };

    void fetchMe();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="screen-stack">
      <Card>
        <h2 className="section-title">за всё время</h2>

        <div className="profile-grid">
          <div className="profile-item">
            <span>стартов</span>
            <strong>{user?.totalGames ?? 0}</strong>
          </div>
          <div className="profile-item">
            <span>финишей</span>
            <strong>{user?.totalGames ?? 0}</strong>
          </div>
          <div className="profile-item">
            <span>лучший счёт</span>
            <strong>{user?.bestScore ?? 0}</strong>
          </div>
          <div className="profile-item">
            <span>общий счёт</span>
            <strong>{user ? asBigIntString(user.totalScore) : 0}</strong>
          </div>
          <div className="profile-item profile-item-wide">
            <span>время в игре</span>
            <strong>{formatDuration(user?.totalPlayTime ?? 0)}</strong>
          </div>
        </div>
      </Card>
    </div>
  );
};
