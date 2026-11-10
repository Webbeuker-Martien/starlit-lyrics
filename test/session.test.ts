import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LyricsSession } from '../src/core/session.ts';
import type { LyricsResult, Playback, PlaybackTick, TrackInfo, ViewState } from '../src/core/types.ts';
import { LyricsError } from '../src/core/types.ts';

function track(id: string, extra: Partial<TrackInfo> = {}): TrackInfo {
  return { id, kind: 'track', title: `Song ${id}`, artists: ['Artist'], album: 'Album', durationMs: 200_000, ...extra };
}

function playing(t: TrackInfo, progressMs = 1000, sampledAt = Date.now()): Playback {
  return { kind: 'item', track: t, isPlaying: true, progressMs, sampledAt };
}

const synced: LyricsResult = { kind: 'synced', lines: [{ timeMs: 0, text: 'la' }], hasWordTiming: false };

/** A fetcher whose promises are resolved by hand, so tests control the order. */
function manualFetcher() {
  const calls: { track: TrackInfo; signal: AbortSignal; resolve(r: LyricsResult): void; reject(e: unknown): void }[] = [];
  const fetcher = (t: TrackInfo, signal: AbortSignal) =>
    new Promise<LyricsResult>((resolve, reject) => calls.push({ track: t, signal, resolve, reject }));
  return { calls, fetcher };
}

function setup() {
  const views: ViewState[] = [];
  const ticks: PlaybackTick[] = [];
  const f = manualFetcher();
  const session = new LyricsSession(f.fetcher, { onView: (v) => views.push(v), onTick: (t) => ticks.push(t) });
  return { session, views, ticks, calls: f.calls };
}

const flush = () => new Promise((r) => setImmediate(r));
const last = <T>(a: T[]) => a[a.length - 1];

test('track change shows loading for the new track before any fetch resolves', async () => {
  const { session, views, calls } = setup();
  session.update(playing(track('a')));
  calls[0].resolve(synced);
  await flush();
  assert.equal(last(views).status, 'synced');

  session.update(playing(track('b')));
  // Synchronously, without awaiting anything: old lyrics are gone.
  const v = last(views);
  assert.equal(v.status, 'loading');
  assert.equal('track' in v && v.track.id, 'b');
});

test('skipping to a song without lyrics clears the view (Shuri bug 1)', async () => {
  const { session, views, calls } = setup();
  session.update(playing(track('a')));
  calls[0].resolve(synced);
  await flush();

  session.update(playing(track('b')));
  calls[1].resolve({ kind: 'none' });
  await flush();
  const v = last(views);
  assert.equal(v.status, 'none');
  assert.equal('track' in v && v.track.id, 'b');
  assert.ok(!views.slice(2).some((x) => x.status === 'synced'), 'no synced view after the skip');
});

test('stale fetch: a slow result for the previous track is dropped', async () => {
  const { session, views, calls } = setup();
  session.update(playing(track('a')));
  session.update(playing(track('b')));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].signal.aborted, true, 'previous fetch is aborted');

  // b answers first, then the stale a result arrives late.
  calls[1].resolve({ kind: 'plain', lines: ['b words'] });
  await flush();
  calls[0].resolve(synced);
  await flush();

  const v = last(views);
  assert.equal(v.status, 'plain');
  assert.equal('track' in v && v.track.id, 'b');
});

test('stale fetch: a late error for the previous track is ignored', async () => {
  const { session, views, calls } = setup();
  session.update(playing(track('a')));
  session.update(playing(track('b')));
  calls[0].reject(new Error('boom'));
  await flush();
  assert.ok(!views.some((v) => v.status === 'error'));
});

test('A -> B -> A: the result of the first A fetch cannot land on the second A', async () => {
  const { session, views, calls } = setup();
  session.update(playing(track('a')));
  session.update(playing(track('b')));
  session.update(playing(track('a')));
  assert.equal(calls.length, 3);
  calls[0].resolve({ kind: 'none' }); // stale generation, same track id
  await flush();
  assert.equal(last(views).status, 'loading');
  calls[2].resolve(synced);
  await flush();
  assert.equal(last(views).status, 'synced');
});

test('same track keeps its view and only sends ticks', async () => {
  const { session, views, ticks, calls } = setup();
  const a = track('a');
  session.update(playing(a, 1000));
  calls[0].resolve(synced);
  await flush();
  const count = views.length;
  session.update(playing(a, 5000));
  session.update({ kind: 'item', track: a, isPlaying: false, progressMs: 6000, sampledAt: Date.now() });
  assert.equal(views.length, count);
  assert.equal(calls.length, 1);
  assert.deepEqual(
    ticks.map((t) => [t.progressMs, t.isPlaying]),
    [
      [1000, true],
      [5000, true],
      [6000, false],
    ],
  );
});

test('non-track states replace the view and reset the track', async () => {
  const { session, views, ticks, calls } = setup();
  session.update(playing(track('a')));
  calls[0].resolve(synced);
  await flush();

  session.update({ kind: 'ad' });
  assert.equal(last(views).status, 'ad');
  assert.equal(last(ticks).trackId, null);

  session.update({ kind: 'nothing' });
  assert.equal(last(views).status, 'nothing');

  // Coming back to the same song loads it again rather than trusting old state.
  session.update(playing(track('a')));
  assert.equal(last(views).status, 'loading');
  assert.equal(calls.length, 2);

  session.update({ kind: 'signedOut' });
  assert.equal(last(views).status, 'signedOut');
});

test('podcast episodes get their own view without a lyrics fetch', () => {
  const { session, views, calls } = setup();
  session.update(playing(track('ep', { kind: 'episode' })));
  assert.equal(last(views).status, 'podcast');
  assert.equal(calls.length, 0);
});

test('errors show for the current track and retry after the retry delay', async () => {
  const { session, views, calls } = setup();
  const a = track('a');
  session.update(playing(a, 0, Date.now()));
  calls[0].reject(new LyricsError('rate limited', 10_000));
  await flush();
  const v = last(views);
  assert.equal(v.status, 'error');

  session.update(playing(a, 1000, Date.now() + 1000)); // too soon
  assert.equal(calls.length, 1);
  session.update(playing(a, 11_000, Date.now() + 11_000));
  assert.equal(calls.length, 2);
  assert.equal(last(views).status, 'loading');

  calls[1].reject(new Error('again'));
  await flush();
  session.retry();
  assert.equal(calls.length, 3);
});
