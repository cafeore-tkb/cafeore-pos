// Web Audio API helper for KDS feedback
class SoundManager {
  private ctx: AudioContext | null = null;
  public enabled = true;

  private init() {
    if (!this.ctx && typeof window !== "undefined") {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  /** 音を出せるか（iPad などは、画面に触れた中で unlock するまで出せない） */
  public get ready() {
    return this.ctx?.state === "running";
  }

  /** 画面に触れた中で呼び、音を出せるようにする */
  public unlock() {
    this.init();
  }

  // Friendly soft double-beep for ticket completion
  public playComplete() {
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;

      // Note 1 (E5 = 659.25Hz)
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(659.25, now);
      gain1.gain.setValueAtTime(0.12, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc1.connect(gain1);
      gain1.connect(this.ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.15);

      // Note 2 (B5 = 987.77Hz)
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(987.77, now + 0.12);
      gain2.gain.setValueAtTime(0.15, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc2.connect(gain2);
      gain2.connect(this.ctx.destination);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.35);
    } catch {
      // Audio not supported or blocked by user gesture
    }
  }

  // 短い音を 0.22 秒おきに順に鳴らす（知らせの音）
  private playNotes(frequencies: number[], type: OscillatorType) {
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      for (const [index, frequency] of frequencies.entries()) {
        const start = now + index * 0.22;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.08, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(start);
        osc.stop(start + 0.18);
      }
    } catch {
      // Audio not supported
    }
  }

  /** 入れ忘れ・「次へ」の押し忘れかもしれない抽出の知らせ。低めの音を 3 回 */
  public playAlert() {
    this.playNotes([440, 440, 349.23], "square");
  }

  /** 新しいコメントの知らせ。上がっていく 3 つの音 */
  public playComment() {
    this.playNotes([783.99, 987.77, 1174.66], "sine");
  }

  // Dispatch click chime
  public playDispatch() {
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.1);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    } catch {
      // Audio not supported
    }
  }
}

export const soundManager = new SoundManager();
