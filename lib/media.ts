// Turns a music link into an embeddable player, when the service allows it.

export type Embed = { src: string; height: number; label: string };

export function embedFor(raw: string | null | undefined): Embed | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");

  // YouTube
  let yt: string | null = null;
  if (host === "youtu.be") yt = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "music.youtube.com") {
    yt = u.searchParams.get("v") ?? (u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/)?.[1] ?? null);
  }
  if (yt && /^[\w-]{6,}$/.test(yt)) {
    const t = u.searchParams.get("t") ?? u.searchParams.get("start");
    const start = t ? parseInt(t, 10) : 0;
    return { src: `https://www.youtube-nocookie.com/embed/${yt}${start ? `?start=${start}` : ""}`, height: 200, label: "YouTube" };
  }

  // Spotify
  if (host === "open.spotify.com") {
    const m = u.pathname.match(/\/(track|album|playlist|episode)\/([A-Za-z0-9]+)/);
    if (m) return { src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, height: m[1] === "track" ? 152 : 352, label: "Spotify" };
  }

  // Apple Music
  if (host === "music.apple.com") {
    return { src: `https://embed.music.apple.com${u.pathname}${u.search}`, height: u.searchParams.get("i") ? 175 : 450, label: "Apple Music" };
  }

  // SoundCloud
  if (host === "soundcloud.com") {
    return { src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(u.toString())}&visual=false`, height: 166, label: "SoundCloud" };
  }
  return null;
}

export const AUDIO_EXT = ["mp3", "m4a", "wav", "aac", "ogg"];

export function fileExt(path: string) {
  return (path.split(".").pop() ?? "").toLowerCase();
}

export function isAudio(path: string) {
  return AUDIO_EXT.includes(fileExt(path));
}

export function fileIcon(path: string) {
  const e = fileExt(path);
  if (isAudio(path)) return "🎵";
  if (e === "pdf") return "📄";
  if (e === "pro") return "🖥";
  if (["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(e)) return "🖼";
  return "📎";
}
