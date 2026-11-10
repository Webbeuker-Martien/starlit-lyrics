// LRClib client: exact lookup first, then a fuzzy search fallback, with a per-track cache
// and polite request pacing. API docs: https://lrclib.net/docs

import { parseLrc, parsePlain } from './lrc.ts';
import type { LyricsResult, TrackInfo } from './types.ts';
import { LyricsError } from './types.ts';

export interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export interface LrclibOptions {
  userAgent: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  /** Minimum gap between two requests. */
  minIntervalMs?: number;
  cacheSize?: number;
}

export class LrclibClient {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly minIntervalMs: number;
  private readonly cacheSize: number;
  private readonly cache = new Map<string, LyricsResult>();
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;
  private blockedUntil = 0;

  constructor(options: LrclibOptions) {
    this.fetchFn = options.fetch ?? fetch;
    this.baseUrl = options.baseUrl ?? 'https://lrclib.net';
    this.userAgent = options.userAgent;
    this.minIntervalMs = options.minIntervalMs ?? 300;
    this.cacheSize = options.cacheSize ?? 100;
  }

  /** Cached result for a track id, without any network access. */
  peek(trackId: string): LyricsResult | undefined {
    return this.cache.get(trackId);
  }

  clearCache(): void {
    this.cache.clear();
  }

  async lookup(track: TrackInfo, signal?: AbortSignal): Promise<LyricsResult> {
    const cached = this.cache.get(track.id);
    if (cached) {
      // Refresh LRU position.
      this.cache.delete(track.id);
      this.cache.set(track.id, cached);
      return cached;
    }

    const artist = track.artists[0] ?? '';
    const durationS = Math.round(track.durationMs / 1000);

    let record = await this.get(
      { track_name: track.title, artist_name: artist, album_name: track.album, duration: String(durationS) },
      signal,
    );
    if (!record || !hasContent(record)) {
      const found = await this.search({ track_name: cleanTitle(track.title), artist_name: artist }, signal);
      record = pickBest(found, durationS) ?? record;
    }

    const result = record ? toResult(record) : ({ kind: 'none' } as const);
    this.remember(track.id, result);
    return result;
  }

  private async get(params: Record<string, string>, signal?: AbortSignal): Promise<LrclibRecord | null> {
    const res = await this.request('/api/get', params, signal);
    if (res.status === 404) return null;
    return (await res.json()) as LrclibRecord;
  }

  private async search(params: Record<string, string>, signal?: AbortSignal): Promise<LrclibRecord[]> {
    const res = await this.request('/api/search', params, signal);
    if (res.status === 404) return [];
    const body = (await res.json()) as unknown;
    return Array.isArray(body) ? (body as LrclibRecord[]) : [];
  }

  /** Requests run one at a time with a minimum gap, and pause after a 429. */
  private request(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<Response> {
    const run = async () => {
      signal?.throwIfAborted();
      const now = Date.now();
      if (now < this.blockedUntil) {
        throw new LyricsError('LRClib asked us to slow down. Retrying shortly.', this.blockedUntil - now);
      }
      const wait = this.lastRequestAt + this.minIntervalMs - now;
      if (wait > 0) await delay(wait, signal);
      this.lastRequestAt = Date.now();

      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '')).toString();
      let res: Response;
      try {
        res = await this.fetchFn(`${this.baseUrl}${path}?${qs}`, {
          headers: { Accept: 'application/json', 'User-Agent': this.userAgent },
          signal,
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        throw new LyricsError("Couldn't reach LRClib. Check your connection.");
      }
      if (res.status === 429) {
        const retryAfterMs = Math.max(5, Number(res.headers.get('retry-after')) || 30) * 1000;
        this.blockedUntil = Date.now() + retryAfterMs;
        throw new LyricsError('LRClib rate limit reached. Retrying shortly.', retryAfterMs);
      }
      if (!res.ok && res.status !== 404) {
        throw new LyricsError(`LRClib returned an error (${res.status}).`);
      }
      return res;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private remember(trackId: string, result: LyricsResult): void {
    this.cache.set(trackId, result);
    while (this.cache.size > this.cacheSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}

function hasContent(r: LrclibRecord): boolean {
  return r.instrumental || !!r.syncedLyrics?.trim() || !!r.plainLyrics?.trim();
}

/** Prefers synced lyrics, then plain, then instrumental, among results within 3 s of the track length. */
export function pickBest(records: LrclibRecord[], durationS: number): LrclibRecord | undefined {
  const close = records.filter((r) => !durationS || !r.duration || Math.abs(r.duration - durationS) <= 3);
  return (
    close.find((r) => !!r.syncedLyrics?.trim()) ??
    close.find((r) => !!r.plainLyrics?.trim()) ??
    close.find((r) => r.instrumental)
  );
}

export function toResult(r: LrclibRecord): LyricsResult {
  if (r.syncedLyrics?.trim()) {
    const parsed = parseLrc(r.syncedLyrics);
    if (parsed.lines.length) return { kind: 'synced', lines: parsed.lines, hasWordTiming: parsed.hasWordTiming };
  }
  if (r.plainLyrics?.trim()) return { kind: 'plain', lines: parsePlain(r.plainLyrics) };
  if (r.instrumental) return { kind: 'instrumental' };
  return { kind: 'none' };
}

/** "Song - Remastered 2011" / "Song (feat. X)" -> "Song", for the fuzzy search. */
export function cleanTitle(title: string): string {
  return (
    title
      .replace(/\s+-\s+.*\b(remaster(ed)?|version|live|mono|stereo|edit|mix|demo|acoustic)\b.*$/i, '')
      .replace(/\s*[([](feat\.?|ft\.?|with)\s[^)\]]*[)\]]/gi, '')
      .replace(/\s*[([][^)\]]*\b(remaster(ed)?|version)\b[^)\]]*[)\]]/gi, '')
      .trim() || title
  );
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
