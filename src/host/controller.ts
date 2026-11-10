// Owns playback polling, the lyrics session and every open lyrics webview.

import * as vscode from 'vscode';
import { LrclibClient } from '../core/lrclib.ts';
import { LyricsSession } from '../core/session.ts';
import { mapCurrentlyPlaying } from '../core/spotifyMap.ts';
import type { Playback, PlaybackTick, ViewState } from '../core/types.ts';
import { SpotifyAuthError, SpotifyPremiumError, SpotifyRateLimitError, getCurrentlyPlaying, seek } from '../spotify/api.ts';
import { SpotifyAuth, redirectUri } from '../spotify/auth.ts';

const POLL_PLAYING_MS = 4_000;
const POLL_PAUSED_MS = 5_000;
const POLL_IDLE_MS = 5_000;
const POLL_UNFOCUSED_MS = 10_000;
const MAX_BACKOFF_MS = 30_000;

export interface Settings {
  theme: 'matchVsCode' | 'starryNight';
  offsetMs: number;
  fontSize: number;
  follow: boolean;
  redirectUri: string;
  clientId: string;
}

type FromWebview =
  | { type: 'ready' }
  | { type: 'seek'; positionMs: number }
  | { type: 'signIn'; clientId: string }
  | { type: 'retry' }
  | { type: 'openSettings' };

interface Surface {
  webview: vscode.Webview;
  visible(): boolean;
}

export class Controller implements vscode.Disposable {
  private readonly auth: SpotifyAuth;
  private readonly lrclib: LrclibClient;
  private readonly session: LyricsSession;
  private readonly surfaces = new Set<Surface>();
  private readonly disposables: vscode.Disposable[] = [];
  private lastTick: PlaybackTick | undefined;
  private banner: string | null = null;
  private timer: NodeJS.Timeout | undefined;
  private polling = false;
  private failures = 0;
  private pausedUntil = 0;
  private signingIn = false;
  private clientId = '';

  constructor(context: vscode.ExtensionContext) {
    const version = String(context.extension.packageJSON.version ?? '0.0.0');
    this.auth = new SpotifyAuth(context.secrets);
    this.lrclib = new LrclibClient({ userAgent: `starlit-lyrics/${version} (VS Code extension)` });
    this.session = new LyricsSession((track, signal) => this.lrclib.lookup(track, signal), {
      onView: (view) => this.broadcast({ type: 'view', view }),
      onTick: (tick) => {
        this.lastTick = tick;
        this.broadcast({ type: 'tick', tick });
      },
    });

    this.disposables.push(
      this.auth.onDidChange((signedIn) => {
        if (!signedIn) this.session.update({ kind: 'signedOut' });
        this.schedule(0);
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('starlit')) this.broadcastSettings();
      }),
      vscode.window.onDidChangeWindowState((s) => {
        if (s.focused) this.schedule(0);
      }),
    );
  }

  async init(): Promise<void> {
    await this.auth.load();
    this.clientId = await this.auth.lastClientId();
    if (!this.auth.signedIn) this.session.update({ kind: 'signedOut' });
    this.schedule(0);
  }

  /** Registers a webview (sidebar view or editor panel). Returns a disposable that unregisters it. */
  attach(webview: vscode.Webview, visible: () => boolean): vscode.Disposable {
    const surface: Surface = { webview, visible };
    this.surfaces.add(surface);
    const sub = webview.onDidReceiveMessage((msg: FromWebview) => this.onMessage(surface, msg));
    return new vscode.Disposable(() => {
      sub.dispose();
      this.surfaces.delete(surface);
    });
  }

  /** Call when a surface becomes visible or hidden. Polling runs only while something is visible. */
  visibilityChanged(): void {
    this.schedule(0);
  }

  async signIn(clientId?: string): Promise<void> {
    if (this.signingIn) return;
    const id =
      clientId ??
      (await vscode.window.showInputBox({
        title: 'Spotify Client ID',
        prompt: `Create an app at developer.spotify.com/dashboard with redirect URI ${redirectUri(this.port())}`,
        value: this.clientId,
        ignoreFocusOut: true,
      }));
    if (!id) return;
    this.signingIn = true;
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Waiting for Spotify sign-in in your browser…', cancellable: true },
        async (_p, token) => {
          token.onCancellationRequested(() => this.auth.cancelLogin());
          await this.auth.signIn(id, this.port());
        },
      );
      this.clientId = id.trim();
      this.failures = 0;
      this.banner = null;
      this.broadcast({ type: 'banner', message: null });
    } catch (err) {
      vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      this.signingIn = false;
      this.broadcastSettings();
    }
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    this.lrclib.clearCache();
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.session.dispose();
    this.auth.cancelLogin();
    this.disposables.forEach((d) => d.dispose());
  }

  // --- polling -------------------------------------------------------------------------------

  private anyVisible(): boolean {
    for (const s of this.surfaces) if (s.visible()) return true;
    return false;
  }

  private schedule(delayMs: number): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.anyVisible()) return;
    const wait = Math.max(delayMs, this.pausedUntil - Date.now());
    this.timer = setTimeout(() => void this.poll(), wait);
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    let next = POLL_IDLE_MS;
    try {
      next = await this.pollOnce();
      this.failures = 0;
      this.pausedUntil = 0;
      this.setBanner(null);
    } catch (err) {
      next = this.handlePollError(err);
    } finally {
      this.polling = false;
    }
    if (!vscode.window.state.focused) next = Math.max(next, POLL_UNFOCUSED_MS);
    this.schedule(next);
  }

  /** Returns the delay until the next poll. */
  private async pollOnce(): Promise<number> {
    if (!this.auth.signedIn) {
      this.session.update({ kind: 'signedOut' });
      return POLL_IDLE_MS;
    }
    const token = await this.auth.accessToken();
    const t0 = Date.now();
    const json = await getCurrentlyPlaying(token);
    const t1 = Date.now();
    // progress_ms was measured roughly halfway through the request.
    const playback: Playback = mapCurrentlyPlaying(json, Math.round((t0 + t1) / 2));
    this.session.update(playback);

    if (playback.kind !== 'item') return playback.kind === 'ad' ? POLL_PLAYING_MS : POLL_IDLE_MS;
    if (!playback.isPlaying) return POLL_PAUSED_MS;
    // Poll right after the song should end, so the next track shows up without a long wait.
    const remaining = playback.track.durationMs - playback.progressMs - (t1 - playback.sampledAt);
    return remaining > 0 ? Math.max(500, Math.min(POLL_PLAYING_MS, remaining + 400)) : POLL_PLAYING_MS;
  }

  private handlePollError(err: unknown): number {
    if (err instanceof SpotifyAuthError) {
      void this.auth.signOut();
      vscode.window.showWarningMessage('Your Spotify session expired. Sign in again to see lyrics.');
      return POLL_IDLE_MS;
    }
    if (err instanceof SpotifyRateLimitError) {
      this.pausedUntil = Date.now() + err.retryAfterMs;
      this.setBanner(`Spotify rate limit reached. Resuming in ${Math.ceil(err.retryAfterMs / 1000)} s.`);
      return err.retryAfterMs;
    }
    if (err instanceof SpotifyPremiumError) {
      this.setBanner('Spotify refused the request. Since 11 Feb 2026 Development Mode apps need a Premium account.');
      return MAX_BACKOFF_MS;
    }
    this.failures++;
    const backoff = Math.min(MAX_BACKOFF_MS, POLL_IDLE_MS * 2 ** (this.failures - 1));
    this.setBanner(`Can't reach Spotify (${err instanceof Error ? err.message : String(err)}). Retrying.`);
    return backoff;
  }

  // --- webview messaging -------------------------------------------------------------------

  private async onMessage(surface: Surface, msg: FromWebview): Promise<void> {
    switch (msg.type) {
      case 'ready':
        surface.webview.postMessage({ type: 'settings', settings: this.settings() });
        surface.webview.postMessage({ type: 'view', view: this.session.currentView });
        if (this.lastTick) surface.webview.postMessage({ type: 'tick', tick: this.lastTick });
        surface.webview.postMessage({ type: 'banner', message: this.banner });
        this.schedule(0);
        break;
      case 'seek':
        await this.seekTo(msg.positionMs);
        break;
      case 'signIn':
        await this.signIn(msg.clientId);
        break;
      case 'retry':
        this.session.retry();
        break;
      case 'openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'starlit');
        break;
    }
  }

  private async seekTo(positionMs: number): Promise<void> {
    const tick = this.lastTick;
    if (!tick?.trackId) return;
    try {
      await seek(await this.auth.accessToken(), positionMs);
      // Optimistic local update, confirmed by the next poll.
      this.lastTick = { ...tick, progressMs: positionMs, sampledAt: Date.now() };
      this.broadcast({ type: 'tick', tick: this.lastTick });
      this.schedule(600);
    } catch (err) {
      const premium = err instanceof SpotifyPremiumError;
      vscode.window.showWarningMessage(
        premium ? 'Seeking needs Spotify Premium.' : `Couldn't seek: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private setBanner(message: string | null): void {
    if (this.banner === message) return;
    this.banner = message;
    this.broadcast({ type: 'banner', message });
  }

  private port(): number {
    return vscode.workspace.getConfiguration('starlit').get<number>('port', 5566);
  }

  settings(): Settings {
    const c = vscode.workspace.getConfiguration('starlit');
    return {
      theme: c.get<'matchVsCode' | 'starryNight'>('theme', 'starryNight'),
      offsetMs: c.get<number>('lyricOffsetMs', 0),
      fontSize: c.get<number>('fontSize', 16),
      follow: c.get<boolean>('followCurrentLine', true),
      redirectUri: redirectUri(this.port()),
      clientId: this.clientId,
    };
  }

  private broadcastSettings(): void {
    this.broadcast({ type: 'settings', settings: this.settings() });
  }

  private broadcast(msg: { type: 'view'; view: ViewState } | { type: 'tick'; tick: PlaybackTick } | { type: 'settings'; settings: Settings } | { type: 'banner'; message: string | null }): void {
    for (const s of this.surfaces) void s.webview.postMessage(msg);
  }
}
