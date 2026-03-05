import { useEffect, useMemo, useRef, useState } from 'react';
import { submitGameResult } from '../services/api';
import { GameEngine, getDefaultSettings } from '../game/GameEngine';
import { DEFAULT_SKIN, loadSkin } from '../game/SkinLoader';
import { tokens } from '../ui/theme/tokens';
import { BottomSheet } from '../ui/components/BottomSheet';
import { Button } from '../ui/components/Button';
import { Card } from '../ui/components/Card';
import { Slider } from '../ui/components/Slider';
import { Toggle } from '../ui/components/Toggle';

interface GameScreenProps {
  settingsTrigger: number;
}

const SETTINGS_KEY = 'dino-game-settings-v1';
const LOCAL_BEST_KEY = 'dino-local-best-score';

const formatTime = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = String(Math.floor(safe / 60)).padStart(2, '0');
  const remain = String(safe % 60).padStart(2, '0');
  return `${minutes}:${remain}`;
};

interface StoredSettings {
  volume: number;
  vibration: boolean;
}

const loadSettings = (): StoredSettings => {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<StoredSettings>;
    if (typeof parsed.volume === 'number' && typeof parsed.vibration === 'boolean') {
      return {
        volume: Math.min(100, Math.max(0, parsed.volume)),
        vibration: parsed.vibration
      };
    }
  } catch {
    // no-op
  }

  return getDefaultSettings();
};

export const GameScreen = ({ settingsTrigger }: GameScreenProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [skinReady, setSkinReady] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [score, setScore] = useState(0);
  const [playTime, setPlayTime] = useState(0);
  const [localBest, setLocalBest] = useState(() => Number(localStorage.getItem(LOCAL_BEST_KEY) ?? 0));
  const [settings, setSettings] = useState<StoredSettings>(() => loadSettings());
  const settingsRef = useRef(settings);

  useEffect(() => {
    setSettingsOpen(true);
  }, [settingsTrigger]);

  useEffect(() => {
    settingsRef.current = settings;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    engineRef.current?.setSettings(settings);
  }, [settings]);

  useEffect(() => {
    let disposed = false;

    const setup = async () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      const skin = await loadSkin(DEFAULT_SKIN);
      if (disposed) {
        return;
      }

      const engine = new GameEngine({
        canvas,
        skin,
        settings: settingsRef.current,
        onTick: (snapshot) => {
          setScore(snapshot.score);
          setPlayTime(snapshot.playTime);
          setIsRunning(snapshot.running);
        },
        onGameOver: async (snapshot) => {
          setIsRunning(false);

          setLocalBest((currentBest) => {
            const nextBest = Math.max(currentBest, snapshot.score);
            if (nextBest !== currentBest) {
              localStorage.setItem(LOCAL_BEST_KEY, String(nextBest));
            }
            return nextBest;
          });

          try {
            await submitGameResult({
              score: snapshot.score,
              playTime: snapshot.playTime,
              obstacles: snapshot.obstacles,
              sessionId: crypto.randomUUID()
            });
          } catch (error) {
            console.warn('Game result submit failed', error);
          }
        }
      });

      engineRef.current = engine;
      setSkinReady(true);
    };

    void setup();

    return () => {
      disposed = true;
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, []);

  const startLabel = useMemo(() => {
    if (score > 0 && !isRunning) {
      return 'ЕЩЁ РАЗ';
    }
    return 'PLAY';
  }, [score, isRunning]);

  const handleStart = () => {
    engineRef.current?.restart();
    setIsRunning(true);
  };

  return (
    <div className="screen-stack">
      <Card className="score-board-card">
        <div className="score-grid">
          <div>
            <span className="metric-label">очки</span>
            <strong className="metric-value">{score}</strong>
          </div>
          <div>
            <span className="metric-label">время</span>
            <strong className="metric-value metric-value-success">{formatTime(playTime)}</strong>
          </div>
          <div>
            <span className="metric-label">локальный рекорд</span>
            <strong className="metric-value">{localBest}</strong>
          </div>
        </div>
      </Card>

      <Card className="game-card">
        <div className="canvas-wrapper">
          <canvas ref={canvasRef} width={500} height={280} className="game-canvas" />

          {!isRunning && skinReady ? (
            <button type="button" className="play-overlay-button" onClick={handleStart}>
              {startLabel}
            </button>
          ) : null}

          <button
            type="button"
            className="settings-fab"
            onClick={() => setSettingsOpen(true)}
            aria-label="Open settings"
          >
            ⚙
          </button>
        </div>
      </Card>

      <BottomSheet open={settingsOpen} title={tokens.app.settingsTitle} onClose={() => setSettingsOpen(false)}>
        <Slider
          label="громкость"
          min={0}
          max={100}
          step={1}
          value={settings.volume}
          valueLabel={`${settings.volume}%`}
          onChange={(event) => setSettings((current) => ({ ...current, volume: Number(event.currentTarget.value) }))}
        />

        <Toggle
          label="вибрация"
          checked={settings.vibration}
          onChange={(nextValue) => setSettings((current) => ({ ...current, vibration: nextValue }))}
        />

        <Button fullWidth onClick={() => setSettingsOpen(false)}>
          ГОТОВО
        </Button>
      </BottomSheet>
    </div>
  );
};
