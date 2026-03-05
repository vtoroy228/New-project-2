type SoundName = 'jump' | 'fireworks';

const SOUND_SOURCES: Record<SoundName, string> = {
  jump: '/assets/sounds/jump.mp3',
  fireworks: '/assets/sounds/fireworks.mp3'
};

const clampVolume = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
};

export class SoundManager {
  private static instance: SoundManager | null = null;
  private activeSounds = new Set<HTMLAudioElement>();
  private lastPlayedAt: Partial<Record<SoundName, number>> = {};
  private volume = 0.7;

  static getInstance(): SoundManager {
    if (!SoundManager.instance) {
      SoundManager.instance = new SoundManager();
    }

    return SoundManager.instance;
  }

  setVolume(nextVolume: number): void {
    this.volume = clampVolume(nextVolume);

    this.activeSounds.forEach((audio) => {
      audio.volume = this.volume;
    });
  }

  getVolume(): number {
    return this.volume;
  }

  play(name: SoundName, options?: { throttleMs?: number }): void {
    if (this.volume <= 0) {
      return;
    }

    const now = performance.now();
    const throttleMs = options?.throttleMs ?? 0;
    const previous = this.lastPlayedAt[name] ?? 0;

    if (throttleMs > 0 && now - previous < throttleMs) {
      return;
    }

    this.lastPlayedAt[name] = now;

    const audio = new Audio(SOUND_SOURCES[name]);
    audio.volume = this.volume;
    audio.preload = 'auto';

    this.activeSounds.add(audio);

    const cleanup = () => {
      this.activeSounds.delete(audio);
      audio.removeEventListener('ended', cleanup);
      audio.removeEventListener('error', cleanup);
    };

    audio.addEventListener('ended', cleanup);
    audio.addEventListener('error', cleanup);

    void audio.play().catch(() => {
      cleanup();
    });
  }
}

export const soundManager = SoundManager.getInstance();
