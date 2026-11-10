// Track-change state machine with a stale-fetch guard.
//
// Rules (each one fixes a Shuri bug or closes a gap):
//  1. When the track id changes, the view switches to `loading` for the new track at once, before any fetch.
//     Old lyrics can never outlive their track.
//  2. Every fetch is tagged with a generation number and the track id, and the previous fetch is aborted.
//     A result that arrives for an older generation or another track is dropped.
//  3. Any non-track state (signed out, nothing playing, ad) resets the current track, so returning
//     to the same song later loads it fresh (from cache) instead of trusting old state.

import type { LyricsResult, Playback, PlaybackTick, TrackInfo, ViewState } from './types.ts';
import { LyricsError } from './types.ts';

export type LyricsFetcher = (track: TrackInfo, signal: AbortSignal) => Promise<LyricsResult>;

export interface SessionCallbacks {
  onView(view: ViewState): void;
  onTick(tick: PlaybackTick): void;
}

export class LyricsSession {
  private readonly fetcher: LyricsFetcher;
  private readonly callbacks: SessionCallbacks;
  private trackId: string | null = null;
  private generation = 0;
  private abort: AbortController | undefined;
  private view: ViewState = { status: 'nothing' };
  private retryAt = 0;

  constructor(fetcher: LyricsFetcher, callbacks: SessionCallbacks) {
    this.fetcher = fetcher;
    this.callbacks = callbacks;
  }

  get currentView(): ViewState {
    return this.view;
  }

  get currentTrackId(): string | null {
    return this.trackId;
  }

  update(playback: Playback): void {
    if (playback.kind !== 'item') {
      if (this.trackId !== null) this.resetTrack();
      if (this.view.status !== playback.kind) this.setView({ status: playback.kind });
      this.callbacks.onTick({ trackId: null, isPlaying: false, progressMs: 0, sampledAt: Date.now(), durationMs: 0 });
      return;
    }

    const { track } = playback;
    if (track.id !== this.trackId) {
      this.resetTrack();
      this.trackId = track.id;
      if (track.kind === 'episode') {
        this.setView({ status: 'podcast', track });
      } else {
        this.load(track);
      }
    } else if (this.view.status === 'error' && playback.sampledAt >= this.retryAt) {
      this.load(track);
    }

    this.callbacks.onTick({
      trackId: track.id,
      isPlaying: playback.isPlaying,
      progressMs: playback.progressMs,
      sampledAt: playback.sampledAt,
      durationMs: track.durationMs,
    });
  }

  /** Manual "Try again" from the view. */
  retry(): void {
    if (this.view.status === 'error') this.load(this.view.track);
  }

  /** Drop the lyrics of the current track and fetch them again (e.g. after the cache was cleared). */
  reload(): void {
    const v = this.view;
    if ('track' in v && v.track.kind === 'track') this.load(v.track);
  }

  dispose(): void {
    this.resetTrack();
  }

  private load(track: TrackInfo): void {
    this.abort?.abort();
    const generation = ++this.generation;
    const abort = new AbortController();
    this.abort = abort;
    this.setView({ status: 'loading', track });

    const isCurrent = () => generation === this.generation && this.trackId === track.id;

    this.fetcher(track, abort.signal).then(
      (result) => {
        if (!isCurrent()) return; // stale: the user skipped while we were fetching
        this.setView(toView(track, result));
      },
      (err: unknown) => {
        if (!isCurrent() || abort.signal.aborted) return;
        const retryAfterMs = err instanceof LyricsError ? err.retryAfterMs : 15_000;
        this.retryAt = Date.now() + retryAfterMs;
        const message = err instanceof Error ? err.message : String(err);
        this.setView({ status: 'error', track, message });
      },
    );
  }

  private resetTrack(): void {
    this.generation++;
    this.abort?.abort();
    this.abort = undefined;
    this.trackId = null;
  }

  private setView(view: ViewState): void {
    this.view = view;
    this.callbacks.onView(view);
  }
}

export function toView(track: TrackInfo, result: LyricsResult): ViewState {
  switch (result.kind) {
    case 'synced':
      return { status: 'synced', track, lines: result.lines, hasWordTiming: result.hasWordTiming };
    case 'plain':
      return { status: 'plain', track, lines: result.lines };
    case 'instrumental':
      return { status: 'instrumental', track };
    case 'none':
      return { status: 'none', track };
  }
}
