import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LrclibClient, cleanTitle, pickBest, type LrclibRecord } from '../src/core/lrclib.ts';
import { mapCurrentlyPlaying } from '../src/core/spotifyMap.ts';
import type { TrackInfo } from '../src/core/types.ts';
import { LyricsError } from '../src/core/types.ts';

const t: TrackInfo = {
  id: 'x1',
  kind: 'track',
  title: 'Night Drive - 2011 Remaster',
  artists: ['Main Artist', 'Guest'],
  album: 'Album',
  durationMs: 201_400,
};

function rec(extra: Partial<LrclibRecord>): LrclibRecord {
  return {
    id: 1,
    trackName: 'Night Drive',
    artistName: 'Main Artist',
    albumName: 'Album',
    duration: 201,
    instrumental: false,
    plainLyrics: null,
    syncedLyrics: null,
    ...extra,
  };
}

function fakeFetch(routes: Record<string, () => Response>) {
  const urls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const path = new URL(url).pathname;
    return (routes[path] ?? (() => new Response('', { status: 404 })))();
  }) as typeof fetch;
  return { fn, urls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('exact get: uses primary artist, album and rounded duration', async () => {
  const f = fakeFetch({ '/api/get': () => json(rec({ syncedLyrics: '[00:01.00]hi' })) });
  const client = new LrclibClient({ userAgent: 'test', fetch: f.fn, minIntervalMs: 0 });
  const result = await client.lookup(t);
  assert.equal(result.kind, 'synced');
  const q = new URL(f.urls[0]).searchParams;
  assert.equal(q.get('artist_name'), 'Main Artist');
  assert.equal(q.get('album_name'), 'Album');
  assert.equal(q.get('duration'), '201');
});

test('falls back to search with a cleaned title and caches by track id', async () => {
  const f = fakeFetch({
    '/api/search': () =>
      json([rec({ duration: 150, syncedLyrics: '[00:01.00]wrong length' }), rec({ plainLyrics: 'plain one\nplain two' })]),
  });
  const client = new LrclibClient({ userAgent: 'test', fetch: f.fn, minIntervalMs: 0 });
  const result = await client.lookup(t);
  assert.deepEqual(result, { kind: 'plain', lines: ['plain one', 'plain two'] });
  assert.equal(new URL(f.urls[1]).searchParams.get('track_name'), 'Night Drive');

  await client.lookup(t);
  assert.equal(f.urls.length, 2, 'second lookup is served from cache');
});

test('instrumental and empty results', async () => {
  const inst = fakeFetch({ '/api/get': () => json(rec({ instrumental: true })) });
  assert.deepEqual(await new LrclibClient({ userAgent: 't', fetch: inst.fn, minIntervalMs: 0 }).lookup(t), {
    kind: 'instrumental',
  });
  const none = fakeFetch({});
  assert.deepEqual(await new LrclibClient({ userAgent: 't', fetch: none.fn, minIntervalMs: 0 }).lookup(t), { kind: 'none' });
});

test('429 becomes a LyricsError with the retry-after delay', async () => {
  const f = fakeFetch({ '/api/get': () => new Response('', { status: 429, headers: { 'retry-after': '12' } }) });
  const client = new LrclibClient({ userAgent: 't', fetch: f.fn, minIntervalMs: 0 });
  await assert.rejects(client.lookup(t), (e: unknown) => e instanceof LyricsError && e.retryAfterMs === 12_000);
});

test('pickBest prefers synced, then plain, within 3 s', () => {
  const best = pickBest([rec({ plainLyrics: 'p' }), rec({ syncedLyrics: '[00:01.00]s', duration: 203 })], 201);
  assert.equal(best?.syncedLyrics, '[00:01.00]s');
  assert.equal(pickBest([rec({ syncedLyrics: '[00:01.00]s', duration: 300 })], 201), undefined);
});

test('cleanTitle strips remaster and feat. suffixes', () => {
  assert.equal(cleanTitle('Song - Remastered 2009'), 'Song');
  assert.equal(cleanTitle('Song (feat. Someone)'), 'Song');
  assert.equal(cleanTitle('Song (2011 Remaster)'), 'Song');
  assert.equal(cleanTitle('Plain Song'), 'Plain Song');
});

test('mapCurrentlyPlaying: track, episode, ad, nothing', () => {
  assert.deepEqual(mapCurrentlyPlaying(null, 1), { kind: 'nothing' });
  assert.deepEqual(mapCurrentlyPlaying({ currently_playing_type: 'ad', item: null }, 1), { kind: 'ad' });
  const p = mapCurrentlyPlaying(
    {
      is_playing: true,
      progress_ms: 4200,
      currently_playing_type: 'track',
      item: {
        id: 'abc',
        name: 'Name',
        duration_ms: 1000,
        artists: [{ name: 'A' }, { name: 'B' }],
        album: {
          name: 'Al',
          images: [
            { url: 'big', width: 640 },
            { url: 'mid', width: 300 },
            { url: 'small', width: 64 },
          ],
        },
      },
    },
    99,
  );
  assert.equal(p.kind, 'item');
  if (p.kind === 'item') {
    assert.equal(p.track.artUrl, 'mid');
    assert.deepEqual(p.track.artists, ['A', 'B']);
    assert.equal(p.progressMs, 4200);
    assert.equal(p.sampledAt, 99);
  }
  const ep = mapCurrentlyPlaying(
    { is_playing: true, currently_playing_type: 'episode', item: { id: 'e', name: 'Ep', show: { name: 'Show' } } },
    1,
  );
  assert.equal(ep.kind === 'item' && ep.track.kind, 'episode');
});
