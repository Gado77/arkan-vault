/**
 * pcm-capture.worklet.js
 *
 * AudioWorklet processor that:
 *  1. Maintains continuous resampler state between process() callbacks
 *     (fractional position + residual samples are preserved across calls).
 *  2. Downsamples from the device's native sample rate to 16 kHz using
 *     linear interpolation.
 *  3. Aggregates output into blocks of 320–640 samples (20–40 ms at 16 kHz).
 *  4. Converts Float32 → PCM signed 16-bit little-endian.
 *  5. Transfers each block as a SharedArrayBuffer-backed or detached
 *     ArrayBuffer via Transferable to avoid redundant copies.
 *
 * Runs in AudioWorkletGlobalScope – no DOM, no imports.
 */

const TARGET_RATE = 16000;
// Target block size at 16 kHz: 320 samples ≈ 20 ms.
// We flush when the accumulator reaches this threshold.
const BLOCK_SAMPLES = 320;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Resampler state: fractional read position into the input buffer.
    this._phase = 0.0;
    // Residual input samples carried across callbacks (for interpolation at
    // block boundaries). We keep at most 1 sample lookahead.
    this._lastSample = 0.0;
    // Output accumulator.
    this._accum = new Float32Array(BLOCK_SAMPLES * 2);
    this._accumLen = 0;
    // Ratio: input samples consumed per output sample.
    this._ratio = 1.0; // Will be set on first call.
    this._ratioKnown = false;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    // Mix down to mono if multichannel.
    const ch0 = input[0];
    const nChannels = input.length;
    let mono;
    if (nChannels === 1) {
      mono = ch0;
    } else {
      mono = new Float32Array(ch0.length);
      for (let c = 0; c < nChannels; c++) {
        const ch = input[c];
        for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / nChannels;
      }
    }

    // Lazily compute ratio from sampleRate (globalThis.sampleRate in worklet).
    if (!this._ratioKnown) {
      this._ratio = sampleRate / TARGET_RATE;
      this._ratioKnown = true;
    }

    const ratio = this._ratio;
    const inputLen = mono.length;

    // Linear resampling with continuous state.
    // _phase is the fractional position in the *current input frame*.
    let phase = this._phase;
    let lastSample = this._lastSample;

    while (phase < inputLen) {
      const i0 = Math.floor(phase);
      const frac = phase - i0;
      const s0 = i0 === 0 ? lastSample : mono[i0 - 1];
      const s1 = mono[i0] ?? mono[inputLen - 1];
      const sample = s0 + frac * (s1 - s0);

      // Grow accumulator if needed.
      if (this._accumLen >= this._accum.length) {
        const next = new Float32Array(this._accum.length * 2);
        next.set(this._accum);
        this._accum = next;
      }
      this._accum[this._accumLen++] = sample;

      // Flush completed blocks.
      if (this._accumLen >= BLOCK_SAMPLES) {
        this._flush(BLOCK_SAMPLES);
      }

      phase += ratio;
    }

    // Preserve state for next callback.
    this._lastSample = mono[inputLen - 1] ?? lastSample;
    this._phase = phase - inputLen; // Fractional overshoot carries forward.

    return true;
  }

  _flush(count) {
    const block = this._accum.subarray(0, count);
    const pcm16 = this._toPcm16(block);

    // Transfer the buffer to the main thread without copy.
    this.port.postMessage({ type: "pcm", buffer: pcm16.buffer }, [pcm16.buffer]);

    // Shift remaining samples down.
    const remaining = this._accumLen - count;
    if (remaining > 0) {
      this._accum.copyWithin(0, count, this._accumLen);
    }
    this._accumLen = remaining;
  }

  _toPcm16(float32) {
    const out = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
