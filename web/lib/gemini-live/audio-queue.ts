/**
 * lib/gemini-live/audio-queue.ts
 *
 * AudioPlaybackQueue — schedules PCM16 24 kHz chunks via Web Audio API.
 * Supports generation-gated interruption (barge-in) that discards old audio.
 */

export const OUTPUT_SAMPLE_RATE = 24_000;

export class AudioPlaybackQueue {
  private ctx: AudioContext;
  private scheduledTime = 0;
  private generation = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  public onIdle: (() => void) | null = null;

  constructor() {
    this.ctx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
  }

  get currentTime(): number {
    return this.ctx.currentTime;
  }

  /**
   * Enqueue a PCM16 (Int16) buffer for seamless playback.
   * @param onFirstPlay Called (once) just before the first buffer starts playing.
   */
  enqueue(pcm16: ArrayBuffer, onFirstPlay?: () => void): void {
    const gen = this.generation;
    const samples = new Int16Array(pcm16);
    const float32 = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      float32[i] = samples[i] / (samples[i] < 0 ? 0x8000 : 0x7fff);
    }

    const buffer = this.ctx.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
    buffer.copyToChannel(float32, 0);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);

    const startAt = Math.max(this.ctx.currentTime, this.scheduledTime);
    source.start(startAt);
    this.scheduledTime = startAt + buffer.duration;

    if (onFirstPlay) {
      const delayMs = Math.max(0, (startAt - this.ctx.currentTime) * 1000);
      window.setTimeout(() => {
        if (this.generation === gen) onFirstPlay();
      }, delayMs);
    }

    this.activeSources.push(source);
    source.addEventListener("ended", () => {
      this.activeSources = this.activeSources.filter((s) => s !== source);
      if (this.activeSources.length === 0 && this.onIdle) {
        this.onIdle();
      }
    });
  }

  /**
   * Stop all active/scheduled audio and advance the generation counter.
   * Any enqueued chunks from the previous generation are silently discarded.
   */
  interrupt(): void {
    this.generation++;
    for (const src of this.activeSources) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    this.activeSources = [];
    this.scheduledTime = this.ctx.currentTime;
  }

  close(): void {
    this.interrupt();
    this.ctx.close().catch(() => {});
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
