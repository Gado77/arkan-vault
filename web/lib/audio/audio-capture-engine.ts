/**
 * lib/audio/audio-capture-engine.ts
 *
 * Singleton audio capture engine.
 * Ensures only ONE `getUserMedia` and ONE `AudioContext` is ever created,
 * regardless of how many times the Gemini Live session connects/disconnects.
 */

type PcmCallback = (buffer: ArrayBuffer) => void;

class AudioCaptureEngine {
  private static instance: AudioCaptureEngine | null = null;

  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;

  private activeDestinations = new Set<string>();
  private pcmCallbacks = new Set<PcmCallback>();
  private pcmProduced = false;
  public ready = false;

  // Ring Buffer for Pre-Roll
  private ringBuffer: Int16Array | null = null;
  private ringPos = 0;
  private ringFull = false;

  // Transition Buffer State
  private transitionMode = false;
  private preRollSnap: Int16Array[] = [];
  private postWakeBuffer: Int16Array[] = [];
  private postWakeFrames = 0;
  private maxPostWakeFrames = 0;

  // Diagnostics
  public captureGeneration = 0;
  public mediaStreamId = "";
  public audioContextGeneration = 0;
  public workletGeneration = 0;

  private constructor() {}

  public static getInstance(): AudioCaptureEngine {
    if (!AudioCaptureEngine.instance) {
      AudioCaptureEngine.instance = new AudioCaptureEngine();
    }
    return AudioCaptureEngine.instance;
  }

  /**
   * Initializes the microphone if not already active.
   */
  public async initialize(): Promise<void> {
    if (this.audioCtx && this.stream && this.workletNode) {
      return; // Already initialized
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });

      this.audioCtx = new AudioContext();
      this.audioContextGeneration = Date.now();
      
      if (this.audioCtx.state === "suspended") {
        await this.audioCtx.resume();
      }

      await this.audioCtx.audioWorklet.addModule("/pcm-capture.worklet.js");

      const source = this.audioCtx.createMediaStreamSource(this.stream);
      this.workletNode = new AudioWorkletNode(this.audioCtx, "pcm-capture");
      this.workletGeneration = Date.now();
      
      this.mediaStreamId = this.stream.id;
      this.captureGeneration++;
      source.connect(this.workletNode);
      this.workletNode.connect(this.audioCtx.destination);

      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      source.connect(this.analyser);

      this.workletNode.port.onmessage = (e: MessageEvent<{ type: string; buffer: ArrayBuffer }>) => {
        if (e.data.type !== "pcm") return;
        
        if (!this.pcmProduced) {
          this.pcmProduced = true;
          this.ready = true;
        }

        if (this.ringBuffer) {
          const incoming = new Int16Array(e.data.buffer);
          
          if (this.transitionMode) {
            // In transition mode, route everything to postWakeBuffer up to a limit
            if (this.postWakeFrames < this.maxPostWakeFrames) {
               // Clone buffer to store safely
               const copy = new Int16Array(incoming);
               this.postWakeBuffer.push(copy);
               this.postWakeFrames += copy.length;
            }
          } else {
            // Normal mode: keep updating the ring buffer
            for (let i = 0; i < incoming.length; i++) {
              this.ringBuffer[this.ringPos] = incoming[i];
              this.ringPos++;
              if (this.ringPos >= this.ringBuffer.length) {
                this.ringPos = 0;
                this.ringFull = true;
              }
            }
          }
        }

        // Dispatch PCM buffer to all registered callbacks
        for (const cb of this.pcmCallbacks) {
          cb(e.data.buffer);
        }
      };

      // Wait until PCM is actually produced or timeout
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!this.pcmProduced) {
            this.shutdown();
            reject(new Error("AudioWorklet failed to produce PCM frames within timeout."));
          }
        }, 3000);

        const checkReady = setInterval(() => {
          if (this.pcmProduced) {
            clearTimeout(timeout);
            clearInterval(checkReady);
            resolve();
          }
        }, 50);
      });

    } catch (err) {
      this.shutdown();
      throw err;
    }
  }

  public getDiagnostics() {
    return {
      captureGeneration: this.captureGeneration,
      mediaStreamId: this.mediaStreamId,
      audioContextGeneration: this.audioContextGeneration,
      workletGeneration: this.workletGeneration,
      ready: this.ready
    };
  }

  /**
   * Add a destination identifier to keep the mic alive.
   */
  public addDestination(id: string) {
    this.activeDestinations.add(id);
  }

  /**
   * Remove a destination. Does NOT completely destroy the microphone engine automatically,
   * to allow smooth atomic transfers.
   */
  public removeDestination(id: string) {
    this.activeDestinations.delete(id);
    // Removed automatic cleanup here: we want the MediaStream to survive Always-On.
  }

  /**
   * Start a transition to freeze the pre-roll and start accumulating post-wake.
   */
  public beginWakeTransition(opts: { preRollMs: number; maxPostWakeMs: number }) {
    this.transitionMode = true;
    this.postWakeBuffer = [];
    this.postWakeFrames = 0;
    this.maxPostWakeFrames = (opts.maxPostWakeMs * 16000) / 1000;
    
    const preRollFrames = Math.floor((opts.preRollMs * 16000) / 1000);
    this.preRollSnap = [];
    
    if (this.ringBuffer) {
      const actualFrames = Math.min(preRollFrames, this.ringFull ? this.ringBuffer.length : this.ringPos);
      if (actualFrames > 0) {
        const snap = new Int16Array(actualFrames);
        let readPos = this.ringPos - actualFrames;
        if (readPos < 0) {
           readPos += this.ringBuffer.length;
           const part1 = this.ringBuffer.length - readPos;
           snap.set(this.ringBuffer.subarray(readPos, this.ringBuffer.length), 0);
           snap.set(this.ringBuffer.subarray(0, actualFrames - part1), part1);
        } else {
           snap.set(this.ringBuffer.subarray(readPos, this.ringPos), 0);
        }
        this.preRollSnap.push(snap);
      }
    }
  }

  /**
   * Gets the transition buffer (pre-roll + post-wake) without destroying it.
   */
  public getTransitionBuffer(): ArrayBuffer[] {
    const buffers: ArrayBuffer[] = [];
    for (const snap of this.preRollSnap) buffers.push(snap.buffer as ArrayBuffer);
    for (const pw of this.postWakeBuffer) buffers.push(pw.buffer as ArrayBuffer);
    return buffers;
  }

  /**
   * Commits the transition, leaving transition mode.
   */
  public commitTransition() {
    this.transitionMode = false;
    this.preRollSnap = [];
    this.postWakeBuffer = [];
    this.postWakeFrames = 0;
    this.ringPos = 0;
    this.ringFull = false;
  }

  /**
   * Rolls back the transition if something fails.
   */
  public cancelTransition() {
    this.transitionMode = false;
    this.preRollSnap = [];
    this.postWakeBuffer = [];
    this.postWakeFrames = 0;
  }

  /**
   * Sets the continuous ring buffer size (e.g. 2000 ms).
   */
  public setRingBufferSizeMs(ms: number) {
     const frames = Math.floor((ms * 16000) / 1000);
     if (!this.ringBuffer || this.ringBuffer.length !== frames) {
       this.ringBuffer = new Int16Array(frames);
       this.ringPos = 0;
       this.ringFull = false;
     }
  }

  /**
   * Register a callback to receive PCM chunks.
   */
  public onPcmData(cb: PcmCallback) {
    this.pcmCallbacks.add(cb);
  }

  /**
   * Unregister a PCM callback.
   */
  public offPcmData(cb: PcmCallback) {
    this.pcmCallbacks.delete(cb);
  }

  /**
   * Returns the analyser node for visualizers (e.g. micLevel).
   */
  public getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  /** Existing live context used only for immediate local UI feedback. */
  public getAudioContext(): AudioContext | null {
    return this.audioCtx;
  }

  /**
   * Completely shuts down the microphone and context. Must be called explicitly now.
   */
  public shutdown() {
    this.activeDestinations.clear();
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.workletNode = null;
    this.analyser = null;
    this.pcmCallbacks.clear();
    this.pcmProduced = false;
    this.ready = false;
    this.ringBuffer = null;
    this.cancelTransition();
    
    // Reset diagnostics
    this.captureGeneration = 0;
    this.mediaStreamId = "";
    this.audioContextGeneration = 0;
    this.workletGeneration = 0;
  }
}

export const audioCaptureEngine = AudioCaptureEngine.getInstance();
