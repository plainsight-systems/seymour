import type { GameEvent } from './types';

export class GameAudio {
  private context: AudioContext | null = null;
  private enabled = false;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled && !this.context) this.context = new AudioContext();
    if (enabled) void this.context?.resume();
  }

  play(type: GameEvent['type']): void {
    if (!this.enabled || !this.context) return;
    const notes: Record<GameEvent['type'], number[]> = {
      arrival: [330, 440], success: [392, 523, 659], warning: [220, 185], fuse: [110, 82, 55], batch: [294, 392], shift: [262, 330, 392, 523],
    };
    const now = this.context.currentTime;
    notes[type].forEach((frequency, index) => {
      const oscillator = this.context!.createOscillator();
      const gain = this.context!.createGain();
      oscillator.type = type === 'fuse' ? 'sawtooth' : 'square';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + index * 0.07);
      gain.gain.exponentialRampToValueAtTime(type === 'fuse' ? 0.06 : 0.035, now + index * 0.07 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.07 + 0.11);
      oscillator.connect(gain).connect(this.context!.destination);
      oscillator.start(now + index * 0.07);
      oscillator.stop(now + index * 0.07 + 0.12);
    });
  }
}
