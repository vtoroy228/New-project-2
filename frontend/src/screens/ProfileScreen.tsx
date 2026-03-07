import { useEffect, useState } from 'react';
import { getMe } from '../services/api';
import type { ApiUser } from '../services/api';
import { Card } from '../ui/components/Card';

interface ProfileScreenProps {
  active?: boolean;
}

const SCORE_SUBMITTED_EVENT = 'dino:score-submitted';

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

export const ProfileScreen = ({ active = true }: ProfileScreenProps) => {
  const [user, setUser] = useState<ApiUser | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }

    let disposed = false;
    const fetchMe = async () => {
      try {
        const response = await getMe();
        if (!disposed) {
          setUser(response.user);
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.info('[profile] failed to load', error);
        }
      }
    };

    const onScoreSubmitted = () => {
      void fetchMe();
    };

    void fetchMe();
    window.addEventListener(SCORE_SUBMITTED_EVENT, onScoreSubmitted);

    return () => {
      disposed = true;
      window.removeEventListener(SCORE_SUBMITTED_EVENT, onScoreSubmitted);
    };
  }, [active]);

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
