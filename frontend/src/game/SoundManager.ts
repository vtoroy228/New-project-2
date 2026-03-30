type SoundName = 'jump' | 'fireworks' | 'bgm';

const AUDIO_CACHE_BUSTER =
  typeof __AUDIO_CACHE_BUSTER__ === 'string' && __AUDIO_CACHE_BUSTER__.length > 0
    ? __AUDIO_CACHE_BUSTER__
    : '0';

const withAudioVersion = (assetPath: string): string => {
  const separator = assetPath.includes('?') ? '&' : '?';
  return `${assetPath}${separator}v=${encodeURIComponent(AUDIO_CACHE_BUSTER)}`;
};

const SOUND_SOURCES: Record<SoundName, string> = {
  jump: withAudioVersion('/assets/sounds/jump.mp3'),
  fireworks: withAudioVersion('/assets/sounds/fireworks.mp3'),
  bgm: withAudioVersion('/assets/sounds/bgm.mp3')
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
  private loadingPromises: Partial<Record<SoundName, Promise<AudioBuffer | null>>> = {};
  private lastPlayedAt: Partial<Record<SoundName, number>> = {};
  private sfxVolume = 0.7;
  private musicEnabled = true;
  private musicRatio = 0.5;
  private bgmSource: AudioBufferSourceNode | null = null;
  private bgmOscillator: OscillatorNode | null = null;
  private bgmGain: GainNode | null = null;
  private bgmActive = false;

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

  private async ensureBufferLoaded(name: SoundName): Promise<AudioBuffer | null> {
    const existing = this.buffers[name];
    if (existing !== undefined) {
      return existing;
    }

    const loading = this.loadingPromises[name];
    if (loading) {
      return loading;
    }

    const context = this.ensureContext();
    if (!context) {
      this.buffers[name] = null;
      return null;
    }

    const promise = decodeAudioBuffer(context, SOUND_SOURCES[name])
      .then((buffer) => {
        this.buffers[name] = buffer;
        return buffer;
      })
      .finally(() => {
        delete this.loadingPromises[name];
      });

    this.loadingPromises[name] = promise;
    return promise;
  }

  async unlock(): Promise<void> {
    const context = this.ensureContext();
    if (!context) {
      return;
    }

    if (context.state === 'suspended') {
      await context.resume();
    }

    void this.ensureBufferLoaded('jump');
    void this.ensureBufferLoaded('fireworks');
    await this.applyMusicState();
  }

  setVolume(nextVolume: number): void {
    this.sfxVolume = clampVolume(nextVolume);
    this.applyMusicState();
  }

  getVolume(): number {
    return this.sfxVolume;
  }

  setMusicEnabled(nextEnabled: boolean): void {
    this.musicEnabled = nextEnabled;
    this.applyMusicState();
  }

  getMusicEnabled(): boolean {
    return this.musicEnabled;
  }

  async startMusic(): Promise<void> {
    this.bgmActive = true;
    await this.applyMusicState();
  }

  stopMusic(): void {
    this.bgmActive = false;
    this.stopMusicNodes();
  }

  play(name: SoundName, options?: { throttleMs?: number }): void {
    if (name === 'bgm') {
      void this.startMusic();
      return;
    }

    if (this.sfxVolume <= 0) {
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

    const buffer = await this.ensureBufferLoaded(name);
    if (buffer) {
      const source = context.createBufferSource();
      const gain = context.createGain();
      gain.gain.value = this.sfxVolume;

      source.buffer = buffer;
      source.connect(gain);
      gain.connect(context.destination);
      source.start(0);
      return;
    }

    createFallbackSynth(context, name, this.sfxVolume);
  }

  private ensureMusicGain(context: AudioContext): GainNode {
    if (this.bgmGain) {
      return this.bgmGain;
    }

    const gain = context.createGain();
    gain.gain.value = 0;
    gain.connect(context.destination);
    this.bgmGain = gain;
    return gain;
  }

  private stopMusicNodes(): void {
    if (this.bgmSource) {
      try {
        this.bgmSource.stop();
      } catch {
        // no-op
      }
      this.bgmSource.disconnect();
      this.bgmSource = null;
    }

    if (this.bgmOscillator) {
      try {
        this.bgmOscillator.stop();
      } catch {
        // no-op
      }
      this.bgmOscillator.disconnect();
      this.bgmOscillator = null;
    }
  }

  private async applyMusicState(): Promise<void> {
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

    const gain = this.ensureMusicGain(context);
    const targetVolume =
      this.bgmActive && this.musicEnabled ? clampVolume(this.sfxVolume * this.musicRatio) : 0;
    gain.gain.value = targetVolume;

    if (!this.bgmActive || !this.musicEnabled) {
      this.stopMusicNodes();
      return;
    }

    if (this.bgmSource || this.bgmOscillator) {
      return;
    }

    const buffer = await this.ensureBufferLoaded('bgm');
    if (buffer) {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain);
      source.onended = () => {
        this.bgmSource = null;
        if (this.bgmActive && this.musicEnabled) {
          void this.applyMusicState();
        }
      };
      source.start(0);
      this.bgmSource = source;
      return;
    }

    // Placeholder fallback so background music channel still works before replacing bgm.mp3.
    const oscillator = context.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(170, context.currentTime);
    oscillator.connect(gain);
    oscillator.start();
    this.bgmOscillator = oscillator;
  }
}

export const soundManager = SoundManager.getInstance();
