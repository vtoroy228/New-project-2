import { useEffect, useState } from 'react';
import { getGlobalLeaderboard } from '../services/api';
import type { GlobalLeaderboardResponse, LeaderboardEntry } from '../services/api';
import { tokens } from '../ui/theme/tokens';
import { Card } from '../ui/components/Card';

interface LeaderboardScreenProps {
  active?: boolean;
}

const SCORE_SUBMITTED_EVENT = 'dino:score-submitted';

const renderName = (entry: LeaderboardEntry): string => {
  const fullName = [entry.firstName, entry.lastName ?? ''].join(' ').trim();
  if (fullName.length > 0) {
    return fullName;
  }

  if (entry.username) {
    return `@${entry.username}`;
  }

  return 'Игрок';
};

export const LeaderboardScreen = ({ active = true }: LeaderboardScreenProps) => {
  const [data, setData] = useState<GlobalLeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!active) {
      return;
    }

    let disposed = false;
    const fetchData = async () => {
      try {
        const next = await getGlobalLeaderboard();
        if (disposed) {
          return;
        }

        setData(next);
      } catch (error) {
        if (import.meta.env.DEV) {
          console.info('[leaderboard] failed to load', error);
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    const onScoreSubmitted = () => {
      void fetchData();
    };

    setLoading(true);
    void fetchData();
    window.addEventListener(SCORE_SUBMITTED_EVENT, onScoreSubmitted);

    return () => {
      disposed = true;
      window.removeEventListener(SCORE_SUBMITTED_EVENT, onScoreSubmitted);
    };
  }, [active]);

  return (
    <div className="screen-stack leaderboard-screen">
      <Card>
        <h2 className="section-title">{tokens.app.eventName}</h2>
        <p className="section-subtitle">
          участников: {loading ? '...' : data?.totalPlayers ?? 0}
        </p>
      </Card>

      <Card className="leaderboard-list-card">
        <div className="leaderboard-list">
          {(data?.top ?? []).map((entry) => (
            <div key={entry.telegramId} className="leaderboard-row">
              <span className="leaderboard-rank">#{entry.rank}</span>
              <span className="leaderboard-avatar">
                {entry.avatarUrl ? (
                  <img className="leaderboard-avatar-image" src={entry.avatarUrl} alt={renderName(entry)} />
                ) : (
                  entry.firstName.slice(0, 1).toUpperCase()
                )}
              </span>
              <span className="leaderboard-name">{renderName(entry)}</span>
              <span className="leaderboard-score">{entry.score}</span>
            </div>
          ))}
        </div>

        <div className="leaderboard-you-row">
          <span>Вы</span>
          {data?.you ? (
            <span>
              #{data.you.rank} · {data.you.score}
            </span>
          ) : (
            <span>Сыграйте, чтобы попасть в рейтинг</span>
          )}
        </div>
      </Card>
    </div>
  );
};
