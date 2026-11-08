// Song analysis done ONCE per audio file and saved (waveform, tempo + beat grid, chords), so opening a
// song is instant on every phone instead of each phone downloading and analysing the whole file.
// Saved as JSON in storage: charts/analysis/files/<fileId>.json
import { createClient } from "@/lib/supabase/client";
import { detectTempo, type Tempo } from "./tempo";
import { detectChords, type ChordResult } from "./chords";

export type Analysis = { v: 1; duration: number; peaks: number[]; tempo: Tempo | null; chords: ChordResult | null };

const VERSION = 1;
const path = (fileId: string) => `analysis/files/${fileId}.json`;

export function peaksOf(data: Float32Array, bins = 240) {
  const step = Math.floor(data.length / bins) || 1;
  const p: number[] = [];
  for (let i = 0; i < bins; i++) {
    let max = 0;
    for (let j = i * step; j < Math.min((i + 1) * step, data.length); j += 32) max = Math.max(max, Math.abs(data[j]));
    p.push(max);
  }
  const top = Math.max(...p) || 1;
  return p.map((x) => Math.round((x / top) * 1000) / 1000);
}

/** Everything the player needs, from decoded audio. */
export function analyze(audio: AudioBuffer): Analysis {
  const data = audio.getChannelData(0);
  const tempo = (() => {
    try {
      return detectTempo(data, audio.sampleRate);
    } catch {
      return null;
    }
  })();
  const chords = (() => {
    try {
      return detectChords(data, audio.sampleRate, tempo);
    } catch {
      return null;
    }
  })();
  return { v: VERSION, duration: audio.duration, peaks: peaksOf(data), tempo, chords };
}

export async function loadAnalysis(fileId: string): Promise<Analysis | null> {
  try {
    const { data } = await createClient().storage.from("charts").download(path(fileId));
    if (!data) return null;
    const a = JSON.parse(await data.text()) as Analysis;
    return a?.v === VERSION && Array.isArray(a.peaks) ? a : null;
  } catch {
    return null;
  }
}

/** Saves the analysis (leaders can write to storage; for others this quietly does nothing). */
export async function saveAnalysis(fileId: string, a: Analysis) {
  try {
    await createClient()
      .storage.from("charts")
      .upload(path(fileId), new Blob([JSON.stringify(a)], { type: "application/json" }), { upsert: true, contentType: "application/json" });
  } catch {}
}
