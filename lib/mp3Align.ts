// MP3s that Fusion makes (to fit big parts under the upload limit) start a few milliseconds late, by an
// amount that depends on the browser's MP3 decoder. Without a fix, a shrunk drum part flams against the
// click. We measure this browser's offset once (encode a click, decode it, see where it lands) and shift
// those parts back into place when they're loaded.
import { Mp3Encoder } from "@breezystack/lamejs";
import { decodeAudio, sharedAudio } from "@/lib/cueVoice";

/** Our MP3 files are stored as "<id>.fw.mp3". */
export const isFusionMp3 = (urlOrPath: string) => /\.fw\.mp3(\?|$)/i.test(urlOrPath);

/** Samples the encoder adds in front (LAME 576 + decoder 529); dropped from the input before encoding. */
export const MP3_PRE_TRIM = 1105;
export const MP3_RATE = 44100;
export const MP3_KBPS = 256;

export function newEncoder(channels: number, rate: number) {
  return new Mp3Encoder(channels, rate, MP3_KBPS);
}

let measured: Promise<number> | null = null;
/** How many samples (at 44.1 kHz) this browser's decoder still shows our MP3s late (negative = early). */
export function mp3Offset(): Promise<number> {
  measured ??= (async () => {
    const n = MP3_RATE * 2;
    const at = MP3_RATE; // a click 1 s in
    const x = new Int16Array(n);
    for (let k = 0; k < 8; k++) x[at + k] = Math.round(26000 * Math.sin((Math.PI * (k + 0.5)) / 8));
    const enc = newEncoder(2, MP3_RATE);
    const input = x.subarray(MP3_PRE_TRIM);
    const parts: BlobPart[] = [enc.encodeBuffer(input, input).slice(), enc.flush().slice()];
    const audio = await decodeAudio(await new Blob(parts).arrayBuffer());
    const d = audio.getChannelData(0);
    let best = 0;
    for (let i = 1; i < d.length; i++) if (Math.abs(d[i]) > Math.abs(d[best])) best = i;
    // The input was pre-trimmed by the usual delay, so an exactly-in-time decoder puts the click back
    // where it was (at; +4 = its middle). Whatever is left over is this browser's own shift.
    const off = Math.round(best * (MP3_RATE / audio.sampleRate)) - (at + 4);
    return Math.abs(off) < 4000 ? off : 0;
  })().catch(() => 0);
  return measured;
}

/** Shifts a decoded Fusion MP3 so it lines up with the song's other parts. */
export async function alignFusionMp3(b: AudioBuffer): Promise<AudioBuffer> {
  const off = Math.round((await mp3Offset()) * (b.sampleRate / MP3_RATE));
  if (!off) return b;
  const len = b.length;
  const ctx = sharedAudio();
  const out = typeof AudioBuffer === "function"
    ? new AudioBuffer({ length: len, numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate })
    : ctx!.createBuffer(b.numberOfChannels, len, b.sampleRate);
  for (let c = 0; c < b.numberOfChannels; c++) {
    const src = b.getChannelData(c);
    const dst = out.getChannelData(c);
    if (off > 0) dst.set(src.subarray(off)); // late: drop the extra start
    else dst.set(src.subarray(0, len + off), -off); // early: pad the start
  }
  return out;
}

// For checking from the browser console (how far this browser's decoder shifts our MP3s).
if (typeof window !== "undefined") (window as unknown as { __fwMp3Offset?: () => Promise<number> }).__fwMp3Offset = mp3Offset;
