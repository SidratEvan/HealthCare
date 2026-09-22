/**
 * The inbound alarm — `CARD-B07-<caseId>`: "audible + visual alert on
 * arrival" (`FR-EMG-01`, `APP_FLOW.md` B4).
 *
 * Synthesised with the Web Audio API rather than played from a file: no
 * asset to cache for an offline console, no dependency, and a tone that is
 * the same on every machine.
 *
 * ## A browser will not play a sound nobody asked for
 *
 * Autoplay policy keeps an `AudioContext` suspended until somebody has
 * interacted with the page. Opening the console from the picker usually
 * counts, but a console left open overnight, or reloaded, may not. So the
 * alarm reports whether it can sound, and the console shows a one-tap
 * "turn the sound on" when it cannot — a silent alarm that looks armed is the
 * failure worth designing against. The visual alert never depends on this.
 */

export type AlarmState = 'ready' | 'blocked' | 'unsupported';

export interface Alarm {
  /** Two short rising tones. Does nothing when the browser has blocked sound. */
  ring(): void;
  /** Called from a tap: resumes a suspended context. */
  unlock(): Promise<AlarmState>;
  state(): AlarmState;
}

interface AudioContextLike {
  readonly state: string;
  readonly currentTime: number;
  readonly destination: AudioNode;
  resume(): Promise<void>;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
}

export function createAlarm(): Alarm {
  const Context =
    (globalThis as { AudioContext?: new () => AudioContextLike }).AudioContext ??
    (globalThis as { webkitAudioContext?: new () => AudioContextLike }).webkitAudioContext;

  if (Context === undefined) {
    return {
      ring: () => undefined,
      unlock: () => Promise.resolve('unsupported'),
      state: () => 'unsupported',
    };
  }

  let context: AudioContextLike | null = null;
  const ensure = (): AudioContextLike => {
    context ??= new Context();
    return context;
  };

  const state = (): AlarmState => (ensure().state === 'running' ? 'ready' : 'blocked');

  return {
    ring() {
      const audio = ensure();
      if (audio.state !== 'running') return;

      // 880 Hz then 1175 Hz, a fifth apart: distinct from a phone's ring and
      // from a monitor's beep, and short enough not to mask a voice.
      [880, 1175].forEach((frequency, index) => {
        const start = audio.currentTime + index * 0.22;
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.21);
      });
    },

    async unlock() {
      const audio = ensure();
      try {
        await audio.resume();
      } catch {
        // A browser that refuses even from a tap leaves the state blocked,
        // and the console keeps saying so.
      }
      return state();
    },

    state,
  };
}
