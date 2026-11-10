import type { CurrentlyPlayingJson } from '../core/spotifyMap.ts';

export class SpotifyAuthError extends Error {}

export class SpotifyRateLimitError extends Error {
  readonly retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

export class SpotifyPremiumError extends Error {}

const API = 'https://api.spotify.com/v1';

function retryAfter(res: Response): number {
  const s = Number(res.headers.get('retry-after'));
  return (s > 0 ? s : 30) * 1000;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } | string; error_description?: string };
    if (typeof body.error === 'string') return body.error_description ?? body.error;
    return body.error?.message ?? `Spotify request failed (${res.status})`;
  } catch {
    return `Spotify request failed (${res.status})`;
  }
}

async function check(res: Response): Promise<void> {
  if (res.ok) return;
  const message = await errorMessage(res);
  if (res.status === 401) throw new SpotifyAuthError(message);
  if (res.status === 429) throw new SpotifyRateLimitError(message, retryAfter(res));
  if (res.status === 403) throw new SpotifyPremiumError(message);
  throw new Error(message);
}

/** Returns null when nothing is playing (HTTP 204). */
export async function getCurrentlyPlaying(accessToken: string): Promise<CurrentlyPlayingJson | null> {
  const res = await fetch(`${API}/me/player/currently-playing?additional_types=track,episode`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 204) return null;
  await check(res);
  const text = await res.text();
  return text ? (JSON.parse(text) as CurrentlyPlayingJson) : null;
}

export async function seek(accessToken: string, positionMs: number): Promise<void> {
  const qs = new URLSearchParams({ position_ms: String(Math.max(0, Math.round(positionMs))) });
  const res = await fetch(`${API}/me/player/seek?${qs}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  await check(res);
}
