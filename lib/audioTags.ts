// Reads song info (title, artist, BPM, key) from iTunes / Apple Music (.m4a) and MP3 files.

export type AudioTags = { title?: string; artist?: string; album?: string; bpm?: number; key?: string };

const td = (enc: string) => new TextDecoder(enc);

// ── MP4 / M4A (iTunes) ──
function mp4Tags(b: Uint8Array): AudioTags {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: AudioTags = {};
  const name = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  const walk = (start: number, end: number, path: string[]) => {
    let o = start;
    while (o + 8 <= end) {
      let size = v.getUint32(o);
      const type = name(o + 4);
      let head = 8;
      if (size === 1 && o + 16 <= end) {
        size = Number(v.getBigUint64(o + 8));
        head = 16;
      } else if (size === 0) size = end - o;
      if (size < head || o + size > end) break;
      const body = o + head;
      const here = [...path, type];
      if (type === "moov" || type === "udta" || type === "ilst" || type === "trak") walk(body, o + size, here);
      else if (type === "meta") walk(body + 4, o + size, here); // meta is a full box
      else if (path[path.length - 1] === "ilst") item(type, body, o + size);
      o += size;
    }
  };
  const dataOf = (start: number, end: number) => {
    let o = start;
    const res: { mean?: string; name?: string; data?: Uint8Array; kind?: number } = {};
    while (o + 8 <= end) {
      const size = v.getUint32(o);
      if (size < 8 || o + size > end) break;
      const t = name(o + 4);
      if (t === "data") {
        res.kind = v.getUint32(o + 8) & 0xffffff;
        res.data = b.subarray(o + 16, o + size);
      } else if (t === "name") res.name = td("utf-8").decode(b.subarray(o + 12, o + size));
      else if (t === "mean") res.mean = td("utf-8").decode(b.subarray(o + 12, o + size));
      o += size;
    }
    return res;
  };
  const item = (type: string, start: number, end: number) => {
    const d = dataOf(start, end);
    if (!d.data) return;
    const text = () => td("utf-8").decode(d.data!).trim();
    if (type === "©nam") out.title = text();
    else if (type === "©ART" && !out.artist) out.artist = text();
    else if (type === "aART" && !out.artist) out.artist = text();
    else if (type === "©alb") out.album = text();
    else if (type === "tmpo" && d.data.length >= 2) out.bpm = (d.data[0] << 8) | d.data[1];
    else if (type === "----" && /initial ?key|^key$/i.test(d.name ?? "")) out.key = text();
  };
  walk(0, b.length, []);
  return out;
}

// ── MP3 (ID3v2) ──
function id3Text(f: Uint8Array) {
  const enc = f[0];
  const body = f.subarray(1);
  const s =
    enc === 1 ? td("utf-16").decode(body) : enc === 2 ? td("utf-16be").decode(body) : enc === 3 ? td("utf-8").decode(body) : td("latin1").decode(body);
  return s.replace(/\u0000+$/g, "").split("\u0000")[0].trim();
}
function id3Tags(b: Uint8Array): AudioTags {
  const out: AudioTags = {};
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return out;
  const ver = b[3];
  const syncsafe = (o: number) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
  const end = Math.min(b.length, 10 + syncsafe(6));
  let o = 10;
  if (b[5] & 0x40 && ver >= 3) o += ver === 4 ? syncsafe(10) : ((b[10] << 24) | (b[11] << 16) | (b[12] << 8) | b[13]) + 4; // extended header
  const map: Record<string, keyof AudioTags> =
    ver === 2 ? { TT2: "title", TP1: "artist", TAL: "album", TBP: "bpm", TKE: "key" } : { TIT2: "title", TPE1: "artist", TALB: "album", TBPM: "bpm", TKEY: "key" };
  while (o < end) {
    let id: string, size: number, head: number;
    if (ver === 2) {
      id = String.fromCharCode(b[o], b[o + 1], b[o + 2]);
      size = (b[o + 3] << 16) | (b[o + 4] << 8) | b[o + 5];
      head = 6;
    } else {
      id = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
      size = ver === 4 ? syncsafe(o + 4) : (b[o + 4] << 24) | (b[o + 5] << 16) | (b[o + 6] << 8) | b[o + 7];
      head = 10;
    }
    if (!/^[A-Z0-9]{3,4}$/.test(id) || size <= 0) break;
    const k = map[id];
    if (k) {
      const t = id3Text(b.subarray(o + head, o + head + size));
      if (k === "bpm") {
        const n = Math.round(parseFloat(t));
        if (n > 0) out.bpm = n;
      } else if (t) out[k] = t as never;
    }
    o += head + size;
  }
  return out;
}

/** "03 Living Hope.m4a" → "Living Hope"; "Phil Wickham - Living Hope.mp3" → title + artist. */
export function tagsFromName(fileName: string): AudioTags {
  let s = fileName.replace(/\.[^.]+$/, "").replace(/_/g, " ").trim();
  s = s.replace(/^\d{1,3}(?:[-.]\d{1,3})?[\s.-]+/, ""); // track number
  const m = s.match(/^(.+?)\s+-\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { title: s };
}

/** Normalises a key tag like "G", "Bbm", "F#", "Gmaj" to the app's key names; null if it isn't one. */
export function normKey(k?: string): string | null {
  if (!k) return null;
  const m = k.trim().match(/^([A-Ga-g])([#b♯♭]?)\s*(m(?!aj)|min|minor)?/);
  if (!m) return null;
  const sharpToFlat: Record<string, string> = { "C#": "Db", "D#": "Eb", "F#": "F#", "G#": "Ab", "A#": "Bb" };
  let n = m[1].toUpperCase() + (m[2] === "♯" ? "#" : m[2] === "♭" ? "b" : m[2]);
  n = sharpToFlat[n] ?? n;
  return n + (m[3] ? "m" : "");
}

export async function readAudioTags(file: File): Promise<AudioTags> {
  const fromName = tagsFromName(file.name);
  try {
    const ext = file.name.split(".").pop()?.toLowerCase();
    let tags: AudioTags = {};
    if (ext === "mp3") tags = id3Tags(new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer()));
    else if (["m4a", "m4b", "mp4", "aac", "alac"].includes(ext ?? "")) {
      // The info box is usually near the start, but some files keep it at the end.
      const head = new Uint8Array(await file.slice(0, 2 * 1024 * 1024).arrayBuffer());
      tags = mp4Tags(head);
      if (!tags.title && file.size > head.length) tags = mp4Tags(new Uint8Array(await file.arrayBuffer()));
    }
    return { ...fromName, ...Object.fromEntries(Object.entries(tags).filter(([, x]) => x !== undefined && x !== "")) };
  } catch {
    return fromName;
  }
}
