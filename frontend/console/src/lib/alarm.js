export function createAlarm() {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;

  if (Context === undefined) {
    return {
      ring: () => undefined,
      unlock: () => Promise.resolve('unsupported'),
      state: () => 'unsupported',
    };
  }

  let context = null;
  const ensure = () => {
    context ??= new Context();
    return context;
  };

  const state = () => (ensure().state === 'running' ? 'ready' : 'blocked');

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
