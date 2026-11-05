// ChordPro parsing and transposition.
//
// Supported input:
//   [G]Amazing [D/F#]grace how [C]sweet       chords inline in brackets
//   {title: ...} {key: ...} etc.              metadata directives (ignored in render)
//   {comment: Build} / {c: ...}               comment line
//   {start_of_chorus} ... {end_of_chorus}     (also soc/eoc, sov/eov, sob/eob, with optional label)
//   Verse 1 / Chorus: / Bridge                plain-text section labels

const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const ALIASES: Record<string, number> = { Cb: 11, Fb: 4, "E#": 5, "B#": 0 };

export const KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const FLAT_KEYS = new Set(["F", "Bb", "Eb", "Ab", "Db", "Dm", "Gm", "Cm", "Fm", "Bbm", "Ebm"]);

export function noteIndex(note: string): number {
  if (note in ALIASES) return ALIASES[note];
  const s = SHARPS.indexOf(note);
  return s >= 0 ? s : FLATS.indexOf(note);
}

function splitKey(key: string) {
  const m = key.trim().match(/^([A-G][#b]?)(m?)/);
  return m ? { root: m[1], minor: m[2] } : null;
}

/** Semitones needed to move from one key to another (0..11), or 0 if either is unknown. */
export function semitonesBetween(from: string | null | undefined, to: string | null | undefined) {
  if (!from || !to) return 0;
  const a = splitKey(from);
  const b = splitKey(to);
  if (!a || !b) return 0;
  const ia = noteIndex(a.root);
  const ib = noteIndex(b.root);
  if (ia < 0 || ib < 0) return 0;
  return (ib - ia + 12) % 12;
}

function shiftNote(note: string, semis: number, flats: boolean) {
  const i = noteIndex(note);
  if (i < 0) return note;
  const j = (((i + semis) % 12) + 12) % 12;
  return (flats ? FLATS : SHARPS)[j];
}

export function transposeKey(key: string | null | undefined, semis: number): string {
  if (!key) return "";
  const k = splitKey(key);
  if (!k) return key;
  const sharpName = shiftNote(k.root, semis, false) + k.minor;
  const flatName = shiftNote(k.root, semis, true) + k.minor;
  // Prefer the conventional spelling (e.g. Bb over A#, F# over Gb).
  if (FLAT_KEYS.has(flatName)) return flatName;
  if (!sharpName.includes("#") || ["F#", "C#m", "F#m", "G#m", "D#m"].includes(sharpName)) return sharpName;
  return flatName;
}

export function prefersFlats(key: string | null | undefined) {
  return !!key && FLAT_KEYS.has(key.trim());
}

const CHORD_RE = /^([A-G][#b]?)([^/\s]*)(?:\/([A-G][#b]?))?$/;

export function transposeChord(chord: string, semis: number, flats: boolean): string {
  if (!semis) return chord;
  const m = chord.match(CHORD_RE);
  if (!m) return chord; // N.C., x2, etc.
  const [, root, quality, bass] = m;
  return shiftNote(root, semis, flats) + quality + (bass ? "/" + shiftNote(bass, semis, flats) : "");
}

export type Segment = { chord: string | null; text: string };
export type SheetLine =
  | { type: "lyrics"; segments: Segment[]; hasChords: boolean }
  | { type: "section"; label: string }
  | { type: "comment"; text: string }
  | { type: "empty" };

const SECTION_RE =
  /^(verse|chorus|pre-?chorus|bridge|intro|outro|tag|interlude|ending|instrumental|refrain|turnaround|vamp|coda)(\s*\d+)?\s*(\(.*\))?\s*:?\s*$/i;

const START_DIRECTIVES: Record<string, string> = {
  start_of_chorus: "Chorus",
  soc: "Chorus",
  start_of_verse: "Verse",
  sov: "Verse",
  start_of_bridge: "Bridge",
  sob: "Bridge",
};

export function parseChordPro(src: string): SheetLine[] {
  const out: SheetLine[] = [];
  for (const raw of src.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      if (out.length && out[out.length - 1].type !== "empty") out.push({ type: "empty" });
      continue;
    }
    const dir = line.trim().match(/^\{([^:}]+)(?::\s*([^}]*))?\}$/);
    if (dir) {
      const name = dir[1].trim().toLowerCase();
      const val = (dir[2] ?? "").trim();
      if (name === "comment" || name === "c" || name === "comment_italic" || name === "ci") {
        out.push({ type: "comment", text: val });
      } else if (name in START_DIRECTIVES) {
        out.push({ type: "section", label: val || START_DIRECTIVES[name] });
      }
      // other directives (title, key, end_of_*, etc.) are metadata only
      continue;
    }
    if (SECTION_RE.test(line.trim())) {
      out.push({ type: "section", label: line.trim().replace(/:$/, "") });
      continue;
    }
    const segments: Segment[] = [];
    const re = /\[([^\]]*)\]/g;
    let last = 0;
    let chord: string | null = null;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      if (m.index > last || chord !== null) segments.push({ chord, text: line.slice(last, m.index) });
      chord = m[1];
      last = m.index + m[0].length;
    }
    segments.push({ chord, text: line.slice(last) });
    const cleaned = segments.filter((s, i) => i > 0 || s.chord !== null || s.text !== "");
    out.push({ type: "lyrics", segments: cleaned, hasChords: cleaned.some((s) => s.chord) });
  }
  while (out.length && out[out.length - 1].type === "empty") out.pop();
  return out;
}

/** Re-serialise ChordPro with transposed chords (used for printing / copying). */
export function transposeSource(src: string, semis: number, flats: boolean) {
  if (!semis) return src;
  return src.replace(/\[([^\]]*)\]/g, (_, c: string) => `[${transposeChord(c, semis, flats)}]`);
}

/** Reads {key: X} from the source, if present. */
export function keyFromSource(src: string) {
  const m = src.match(/\{\s*key\s*:\s*([^}]+)\}/i);
  return m ? m[1].trim() : null;
}
