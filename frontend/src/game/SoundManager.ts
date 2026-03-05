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

const decodeAudioBuffer = async (
  context: AudioContext,
  source: string
): Promise<AudioBuffer | null> => {
  try {
    const response = await fetch(source);
    if (!response.ok) {
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      return null;
    }

    return await context.decodeAudioData(arrayBuffer.slice(0));
  } catch {
    return null;
  }
};

const createFallbackSynth = (context: AudioContext, name: SoundName, volume: number): void => {
  const now = context.currentTime;

  if (name === 'jump') {
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(620, now);
    oscillator.frequency.exponentialRampToValueAtTime(420, now + 0.08);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume * 0.16), now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);

    oscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.start(now);
    oscillator.stop(now + 0.1);
    return;
  }

  for (let index = 0; index < 5; index += 1) {
    const start = now + index * 0.045;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(300 + Math.random() * 650, start);
    oscillator.frequency.exponentialRampToValueAtTime(80 + Math.random() * 80, start + 0.12);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume * 0.12), start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.14);
  }
};

export class SoundManager {
  private static instance: SoundManager | null = null;

  private context: AudioContext | null = null;
  private buffers: Partial<Record<SoundName, AudioBuffer | null>> = {};
  private loadingPromise: Promise<void> | null = null;
  private lastPlayedAt: Partial<Record<SoundName, number>> = {};
  private volume = 0.7;

  static getInstance(): SoundManager {
    if (!SoundManager.instance) {
      SoundManager.instance = new SoundManager();
    }

    return SoundManager.instance;
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') {
      return null;
    }

    if (!this.context) {
      const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        return null;
      }

      this.context = new AudioContextCtor();
    }

    return this.context;
  }

  private ensureBuffersLoaded(): Promise<void> {
    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    const context = this.ensureContext();
    if (!context) {
      this.loadingPromise = Promise.resolve();
      return this.loadingPromise;
    }

    this.loadingPromise = (async () => {
      const entries = await Promise.all(
        (Object.keys(SOUND_SOURCES) as SoundName[]).map(async (name) => {
          const buffer = await decodeAudioBuffer(context, SOUND_SOURCES[name]);
          return [name, buffer] as const;
        })
      );

      entries.forEach(([name, buffer]) => {
        this.buffers[name] = buffer;
      });
    })();

    return this.loadingPromise;
  }

  async unlock(): Promise<void> {
    const context = this.ensureContext();
    if (!context) {
      return;
    }

    if (context.state === 'suspended') {
      await context.resume();
    }

    await this.ensureBuffersLoaded();
  }

  setVolume(nextVolume: number): void {
    this.volume = clampVolume(nextVolume);
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

    void this.playInternal(name);
  }

  private async playInternal(name: SoundName): Promise<void> {
    const context = this.ensureContext();
    if (!context) {
      return;
    }

    if (context.state === 'suspended') {
      try {
        await context.resume();
      } catch {
        return;
      }
    }

    await this.ensureBuffersLoaded();

    const buffer = this.buffers[name];
    if (buffer) {
      const source = context.createBufferSource();
      const gain = context.createGain();
      gain.gain.value = this.volume;

      source.buffer = buffer;
      source.connect(gain);
      gain.connect(context.destination);
      source.start(0);
      return;
    }

    createFallbackSynth(context, name, this.volume);
  }
}

export const soundManager = SoundManager.getInstance();
