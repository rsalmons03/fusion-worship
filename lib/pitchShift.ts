// Real-time key change for the rehearsal player (like Moises' pitch control): shifts the
// audio up or down by semitones without changing the speed.
// A two-tap delay-line pitch shifter with equal-power crossfades, run as an AudioWorklet.

const WORKLET = `
class FwPitchShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "semitones", defaultValue: 0, minValue: -12, maxValue: 12, automationRate: "k-rate" }];
  }
  constructor() {
    super();
    this.size = 16384;
    this.win = Math.round(sampleRate * 0.06); // 60 ms grains
    this.bufs = [];
    this.w = 0;
    this.phase = 0;
  }
  read(buf, pos) {
    const n = this.size;
    const i = Math.floor(pos);
    const f = pos - i;
    const a = buf[((i % n) + n) % n];
    const b = buf[(((i + 1) % n) + n) % n];
    return a + (b - a) * f;
  }
  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    const semis = params.semitones[0];
    const ratio = Math.pow(2, semis / 12);
    const chans = output.length;
    while (this.bufs.length < chans) this.bufs.push(new Float32Array(this.size));
    const frames = output[0] ? output[0].length : 128;
    const W = this.win;
    const step = (1 - ratio) / W;
    for (let s = 0; s < frames; s++) {
      const p1 = this.phase;
      const p2 = (p1 + 0.5) % 1;
      const g1 = Math.sin(Math.PI * p1) ** 2;
      const g2 = Math.sin(Math.PI * p2) ** 2;
      const d1 = p1 * W + 2;
      const d2 = p2 * W + 2;
      for (let c = 0; c < chans; c++) {
        const inp = input[c] || input[0];
        const buf = this.bufs[c];
        buf[this.w] = inp ? inp[s] : 0;
        if (semis === 0) {
          output[c][s] = buf[this.w];
        } else {
          output[c][s] = g1 * this.read(buf, this.w - d1) + g2 * this.read(buf, this.w - d2);
        }
      }
      this.w = (this.w + 1) % this.size;
      this.phase = (((this.phase + step) % 1) + 1) % 1;
    }
    return true;
  }
}
registerProcessor("fw-pitch-shifter", FwPitchShifter);
`;

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

/** A node that shifts pitch by its "semitones" parameter. Null if this browser can't do it. */
export async function createPitchShifter(ctx: AudioContext): Promise<AudioWorkletNode | null> {
  if (!ctx.audioWorklet) return null;
  if (!loaded.has(ctx)) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    loaded.set(ctx, ctx.audioWorklet.addModule(url));
  }
  try {
    await loaded.get(ctx);
    return new AudioWorkletNode(ctx, "fw-pitch-shifter", { outputChannelCount: [2] });
  } catch {
    return null;
  }
}
