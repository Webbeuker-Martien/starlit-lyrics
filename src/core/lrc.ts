// LRC parsing and timing lookups. Pure code: no VS Code imports, so it runs under `node --test`.

export interface LyricWord {
  timeMs: number;
  text: string;
}

export interface LyricLine {
  timeMs: number;
  /** Empty string for an instrumental gap. */
  text: string;
  /** Present only when the source has enhanced (word-level) timestamps. */
  words?: LyricWord[];
}

export interface ParsedLrc {
  lines: LyricLine[];
  hasWordTiming: boolean;
}

const LINE_TAG = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
const WORD_TAG = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;
const OFFSET_TAG = /^\[offset:\s*([+-]?\d+)\s*\]/i;

/** "01", "23", "5" -> ms. The fraction is a decimal fraction: .5 = 500 ms, .05 = 50 ms, .123 = 123 ms. */
export function tagToMs(min: string, sec: string, frac?: string): number {
  const fracMs = frac ? Number(frac.padEnd(3, '0').slice(0, 3)) : 0;
  return Number(min) * 60_000 + Number(sec) * 1_000 + fracMs;
}

export function parseLrc(source: string): ParsedLrc {
  let offsetMs = 0;
  const lines: LyricLine[] = [];
  let hasWordTiming = false;

  for (const raw of source.split(/\r?\n/)) {
    let rest = raw.trim();
    if (!rest) continue;

    const offset = OFFSET_TAG.exec(rest);
    if (offset) {
      offsetMs = Number(offset[1]);
      continue;
    }

    // A line can carry several timestamps: [00:12.00][00:45.00]Chorus
    const times: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = LINE_TAG.exec(rest))) {
      times.push(tagToMs(m[1], m[2], m[3]));
      rest = rest.slice(m[0].length);
    }
    if (times.length === 0) continue; // metadata such as [ar:...] or free text

    const { text, words } = parseWords(rest);
    if (words) hasWordTiming = true;
    for (const t of times) {
      lines.push(words ? { timeMs: t, text, words: words.map((w) => ({ ...w })) } : { timeMs: t, text });
    }
  }

  // Per the LRC convention a positive [offset:] makes lyrics appear sooner.
  if (offsetMs) {
    for (const line of lines) {
      line.timeMs = Math.max(0, line.timeMs - offsetMs);
      line.words?.forEach((w) => (w.timeMs = Math.max(0, w.timeMs - offsetMs)));
    }
  }

  // Stable sort keeps the source order for equal timestamps.
  lines.sort((a, b) => a.timeMs - b.timeMs);
  return { lines, hasWordTiming };
}

function parseWords(rest: string): { text: string; words?: LyricWord[] } {
  WORD_TAG.lastIndex = 0;
  if (!WORD_TAG.test(rest)) return { text: rest.trim() };

  const words: LyricWord[] = [];
  WORD_TAG.lastIndex = 0;
  const parts = rest.split(WORD_TAG);
  // split() with 3 capture groups yields: [before, min, sec, frac, text, min, sec, frac, text, ...]
  for (let i = 1; i + 3 < parts.length; i += 4) {
    const text = parts[i + 3] ?? '';
    if (text.trim() === '') continue;
    words.push({ timeMs: tagToMs(parts[i], parts[i + 1], parts[i + 2]), text });
  }
  const lead = parts[0];
  if (lead.trim() && words.length) {
    words[0] = { ...words[0], text: lead + words[0].text };
  }
  const text = words.map((w) => w.text).join('').replace(/\s+/g, ' ').trim();
  return words.length ? { text, words } : { text: rest.replace(WORD_TAG, '').trim() };
}

/** Plain (unsynced) lyrics: trims lines and collapses runs of blank lines into one stanza break. */
export function parsePlain(source: string): string[] {
  const out: string[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' && (out.length === 0 || out[out.length - 1] === '')) continue;
    out.push(line);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

/** Index of the last item whose timeMs <= positionMs, or -1 before the first one. Binary search. */
export function findActiveIndex(items: ReadonlyArray<{ timeMs: number }>, positionMs: number): number {
  let lo = 0;
  let hi = items.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].timeMs <= positionMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
