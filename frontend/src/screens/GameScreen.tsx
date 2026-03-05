import { useEffect, useMemo, useRef, useState } from 'react';
import { getMe, submitGameResult } from '../services/api';
import { GameEngine, getDefaultSettings } from '../game/GameEngine';
import { soundManager } from '../game/SoundManager';
import { DEFAULT_SKIN, loadSkin } from '../game/SkinLoader';
import { triggerGameOverHaptic, triggerSuccessHaptic } from '../services/telegram';
import { tokens } from '../ui/theme/tokens';
import { BottomSheet } from '../ui/components/BottomSheet';
import { Button } from '../ui/components/Button';
import { Card } from '../ui/components/Card';
import { ConfettiOverlay } from '../ui/components/ConfettiOverlay';
import { Slider } from '../ui/components/Slider';
import { Toggle } from '../ui/components/Toggle';

const VOLUME_KEY = 'dino.volume';
const VIBRATION_KEY = 'dino.vibration';
const LOCAL_BEST_KEY = 'dino.localBest';

interface SettingsState {
  volume: number;
  vibrationEnabled: boolean;
}

const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
};

const parseBoolean = (value: string | null, fallback: boolean): boolean => {
  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return fallback;
};

const loadSettings = (): SettingsState => {
  const defaults = getDefaultSettings();
  const volumeRaw = Number.parseFloat(localStorage.getItem(VOLUME_KEY) ?? '');

  return {
    volume: clamp(Number.isFinite(volumeRaw) ? volumeRaw : defaults.volume, 0, 1),
    vibrationEnabled: parseBoolean(localStorage.getItem(VIBRATION_KEY), defaults.vibrationEnabled)
  };
};

const formatTime = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = String(Math.floor(safe / 60)).padStart(2, '0');
  const remain = String(safe % 60).padStart(2, '0');
  return `${minutes}:${remain}`;
};

const createSessionId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
};

export const GameScreen = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWrapperRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const settingsRef = useRef<SettingsState>(loadSettings());
  const confettiTimeoutRef = useRef<number | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [skinReady, setSkinReady] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [score, setScore] = useState(0);
  const [playTime, setPlayTime] = useState(0);
  const [confettiVisible, setConfettiVisible] = useState(false);
  const [serverBest, setServerBest] = useState(0);
  const [localBest, setLocalBest] = useState(() => {
    const parsed = Number.parseInt(localStorage.getItem(LOCAL_BEST_KEY) ?? '0', 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  const [settings, setSettings] = useState<SettingsState>(() => loadSettings());
  const localBestRef = useRef(localBest);

  useEffect(() => {
    settingsRef.current = settings;
    localStorage.setItem(VOLUME_KEY, settings.volume.toFixed(2));
    localStorage.setItem(VIBRATION_KEY, String(settings.vibrationEnabled));
    engineRef.current?.setSettings(settings);
    soundManager.setVolume(settings.volume);
  }, [settings]);

  useEffect(() => {
    localBestRef.current = localBest;
  }, [localBest]);

  useEffect(() => {
    let active = true;

    const loadServerBest = async () => {
      try {
        const response = await getMe();
        if (!active) {
          return;
        }

        setServerBest(response.user.bestScore);
      } catch (error) {
        if (import.meta.env.DEV) {
          console.info('[game] failed to load server profile', error);
        }
      }
    };

    void loadServerBest();

    return () => {
      active = false;
    };
  }, []);

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
          const vibrationEnabled = settingsRef.current.vibrationEnabled;
          triggerGameOverHaptic(vibrationEnabled);

          const previousBest = Math.max(localBestRef.current, serverBest);
          const isNewRecord = snapshot.score > previousBest;
          if (isNewRecord) {
            localBestRef.current = snapshot.score;
            setLocalBest(snapshot.score);
            setServerBest(snapshot.score);
            localStorage.setItem(LOCAL_BEST_KEY, String(snapshot.score));
          }

          if (isNewRecord) {
            setConfettiVisible(true);
            soundManager.play('fireworks');
            triggerSuccessHaptic(vibrationEnabled);

            if (confettiTimeoutRef.current) {
              window.clearTimeout(confettiTimeoutRef.current);
            }

            confettiTimeoutRef.current = window.setTimeout(() => {
              setConfettiVisible(false);
            }, 2200);
          }

          try {
            const response = await submitGameResult({
              score: snapshot.score,
              playTime: snapshot.playTime,
              obstacles: snapshot.obstacles,
              sessionId: createSessionId()
            });

            if (response.scoreAccepted && snapshot.score > serverBest) {
              setServerBest(snapshot.score);
            }
          } catch (error) {
            if (import.meta.env.DEV) {
              console.info('[game] failed to submit result', error);
            }
          }
        }
      });

      engineRef.current = engine;

      const wrapper = canvasWrapperRef.current;
      if (wrapper) {
        const bounds = wrapper.getBoundingClientRect();
        engine.resize(bounds.width, bounds.height);
      }

      setSkinReady(true);
    };

    void setup();

    return () => {
      disposed = true;

      if (confettiTimeoutRef.current) {
        window.clearTimeout(confettiTimeoutRef.current);
      }

      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const wrapper = canvasWrapperRef.current;
    if (!wrapper) {
      return;
    }

    const resize = () => {
      const bounds = wrapper.getBoundingClientRect();
      engineRef.current?.resize(bounds.width, bounds.height);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(wrapper);

    window.addEventListener('orientationchange', resize);
    resize();

    return () => {
      observer.disconnect();
      window.removeEventListener('orientationchange', resize);
    };
  }, []);

  const startLabel = useMemo(() => {
    if (score > 0 && !isRunning) {
      return 'ЕЩЁ РАЗ';
    }

    return 'PLAY';
  }, [score, isRunning]);

  const handleStart = () => {
    setConfettiVisible(false);
    void soundManager.unlock();
    engineRef.current?.restart();
    setIsRunning(true);
  };

  const sliderValue = Math.round(settings.volume * 100);
  const hiScore = Math.max(localBest, serverBest);

  return (
    <div className="screen-stack game-screen-stack">
      <Card className="score-board-card">
        <div className="metrics-row" role="list" aria-label="Game metrics">
          <div className="metric-cell" role="listitem">
            <span className="metric-label">TIME</span>
            <strong className="metric-value metric-value-success">{formatTime(playTime)}</strong>
          </div>
          <div className="metric-cell" role="listitem">
            <span className="metric-label">SCORE</span>
            <strong className="metric-value">{score}</strong>
          </div>
          <div className="metric-cell" role="listitem">
            <span className="metric-label">HI</span>
            <strong className="metric-value">{hiScore}</strong>
          </div>
        </div>
      </Card>

      <Card className="game-card game-card-flex">
        <div ref={canvasWrapperRef} className="canvas-wrapper canvas-wrapper-stretch">
          <canvas ref={canvasRef} className="game-canvas" />
          <ConfettiOverlay visible={confettiVisible && !isRunning} />

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
          value={sliderValue}
          valueLabel={`${sliderValue}%`}
          onChange={(event) => {
            const raw = Number.parseInt(event.currentTarget.value, 10);
            const nextPercent = clamp(Number.isFinite(raw) ? raw : 0, 0, 100);
            setSettings((current) => ({
              ...current,
              volume: nextPercent / 100
            }));
            void soundManager.unlock();
            soundManager.play('jump', { throttleMs: 80 });
          }}
        />

        <Toggle
          label="вибрация"
          checked={settings.vibrationEnabled}
          onChange={(nextValue) => setSettings((current) => ({ ...current, vibrationEnabled: nextValue }))}
        />

        <Button fullWidth onClick={() => setSettingsOpen(false)}>
          ГОТОВО
        </Button>
      </BottomSheet>
    </div>
  );
};
