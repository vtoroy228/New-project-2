import { useEffect, useState } from 'react';
import { getGlobalLeaderboard, getMe } from '../services/api';
import type { ApiUser } from '../services/api';
import { Card } from '../ui/components/Card';

interface ProfileScreenProps {
  active?: boolean;
}

const SCORE_SUBMITTED_EVENT = 'dino:score-submitted';
const PROFILE_BEST_RANK_KEY = 'dino.profileBestRank';

const loadStoredBestRank = (): number | null => {
  const parsed = Number.parseInt(localStorage.getItem(PROFILE_BEST_RANK_KEY) ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

const formatRankValue = (rank: number | null): string => {
  return rank ? `#${rank}` : '---';
};

export const ProfileScreen = ({ active = true }: ProfileScreenProps) => {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [bestRank, setBestRank] = useState<number | null>(() => loadStoredBestRank());

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

    const fetchBestRank = async () => {
      try {
        const response = await getGlobalLeaderboard();
        if (disposed) {
          return;
        }

        const currentRank = response.you?.rank ?? null;
        if (!currentRank || currentRank <= 0) {
          return;
        }

        setBestRank((previousRank) => {
          const nextRank = previousRank === null ? currentRank : Math.min(previousRank, currentRank);
          if (nextRank !== previousRank) {
            localStorage.setItem(PROFILE_BEST_RANK_KEY, String(nextRank));
          }

          return nextRank;
        });
      } catch (error) {
        if (import.meta.env.DEV) {
          console.info('[profile] failed to load rank', error);
        }
      }
    };

    const onScoreSubmitted = () => {
      void fetchMe();
      void fetchBestRank();
    };

    void fetchMe();
    void fetchBestRank();
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
            <span>попыток</span>
            <strong>{user?.totalGames ?? 0}</strong>
          </div>
          <div className="profile-item">
            <span>лучший счёт</span>
            <strong>{user?.bestScore ?? 0}</strong>
          </div>
          <div className="profile-item profile-item-wide">
            <span>лучшее место в рейтинге</span>
            <strong>{formatRankValue(bestRank)}</strong>
          </div>
        </div>
      </Card>
    </div>
  );
};
