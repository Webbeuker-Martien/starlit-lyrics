// Maps a Spotify "currently playing" response to a Playback snapshot. Pure, so it is unit tested.

import type { Playback, TrackInfo } from './types.ts';

interface SpotifyImage {
  url: string;
  width?: number | null;
}

export interface CurrentlyPlayingJson {
  is_playing?: boolean;
  progress_ms?: number | null;
  currently_playing_type?: 'track' | 'episode' | 'ad' | 'unknown';
  item?: {
    id?: string | null;
    uri?: string;
    name?: string;
    duration_ms?: number;
    artists?: { name: string }[];
    album?: { name?: string; images?: SpotifyImage[] };
    show?: { name?: string; images?: SpotifyImage[] };
    images?: SpotifyImage[];
  } | null;
}

/** `json` is null for HTTP 204 (no active device). */
export function mapCurrentlyPlaying(json: CurrentlyPlayingJson | null, sampledAt: number): Playback {
  if (!json) return { kind: 'nothing' };
  if (json.currently_playing_type === 'ad') return { kind: 'ad' };
  const item = json.item;
  if (!item) return { kind: 'nothing' };

  const isEpisode = json.currently_playing_type === 'episode' || !!item.show;
  const track: TrackInfo = {
    id: item.id || item.uri || `${item.name}`,
    kind: isEpisode ? 'episode' : 'track',
    title: item.name ?? 'Unknown',
    artists: isEpisode ? [item.show?.name ?? 'Podcast'] : (item.artists ?? []).map((a) => a.name).filter(Boolean),
    album: isEpisode ? (item.show?.name ?? '') : (item.album?.name ?? ''),
    durationMs: item.duration_ms ?? 0,
    artUrl: pickImage(isEpisode ? (item.images ?? item.show?.images) : item.album?.images),
  };
  return {
    kind: 'item',
    track,
    isPlaying: !!json.is_playing,
    progressMs: json.progress_ms ?? 0,
    sampledAt,
  };
}

/** Smallest image that is still at least 128 px wide (sharp at 2x for a 64 px avatar). */
export function pickImage(images: SpotifyImage[] | undefined): string | undefined {
  if (!images?.length) return undefined;
  const sized = images.filter((i) => (i.width ?? 0) >= 128).sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sized[0] ?? images[0]).url;
}
