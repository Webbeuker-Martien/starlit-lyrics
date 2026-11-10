import type { LyricLine } from './lrc.ts';

export interface TrackInfo {
  /** Spotify id, or the spotify:local URI for local files (they have no id). */
  id: string;
  kind: 'track' | 'episode';
  title: string;
  /** Artists for a track, the show name for an episode. */
  artists: string[];
  album: string;
  durationMs: number;
  artUrl?: string;
}

/** One snapshot of what the player is doing, from whatever playback source is active. */
export type Playback =
  | { kind: 'signedOut' }
  | { kind: 'nothing' }
  | { kind: 'ad' }
  | { kind: 'item'; track: TrackInfo; isPlaying: boolean; progressMs: number; sampledAt: number };

export type LyricsResult =
  | { kind: 'synced'; lines: LyricLine[]; hasWordTiming: boolean }
  | { kind: 'plain'; lines: string[] }
  | { kind: 'instrumental' }
  | { kind: 'none' };

/** Everything the webview needs to draw the main area. Every state names its track, so nothing can linger. */
export type ViewState =
  | { status: 'signedOut' }
  | { status: 'nothing' }
  | { status: 'ad' }
  | { status: 'podcast'; track: TrackInfo }
  | { status: 'loading'; track: TrackInfo }
  | { status: 'synced'; track: TrackInfo; lines: LyricLine[]; hasWordTiming: boolean }
  | { status: 'plain'; track: TrackInfo; lines: string[] }
  | { status: 'instrumental'; track: TrackInfo }
  | { status: 'none'; track: TrackInfo }
  | { status: 'error'; track: TrackInfo; message: string };

/** Timing for the local interpolation in the webview. */
export interface PlaybackTick {
  trackId: string | null;
  isPlaying: boolean;
  progressMs: number;
  /** Date.now() at which progressMs was true. */
  sampledAt: number;
  durationMs: number;
}

export class LyricsError extends Error {
  readonly retryAfterMs: number;
  constructor(message: string, retryAfterMs = 15_000) {
    super(message);
    this.name = 'LyricsError';
    this.retryAfterMs = retryAfterMs;
  }
}
