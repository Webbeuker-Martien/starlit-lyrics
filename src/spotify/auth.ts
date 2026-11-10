// Spotify sign-in with Authorization Code + PKCE and a loopback redirect (no client secret needed).
// Tokens live in VS Code SecretStorage.

import * as crypto from 'node:crypto';
import * as http from 'node:http';
import * as vscode from 'vscode';
import { SpotifyAuthError } from './api.ts';

const SCOPES = 'user-read-currently-playing user-read-playback-state user-modify-playback-state';
const SESSION_KEY = 'starlit.spotifySession';
const CLIENT_ID_KEY = 'starlit.clientId';
const LOGIN_TIMEOUT_MS = 3 * 60_000;

interface StoredSession {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function redirectUri(port: number): string {
  return `http://127.0.0.1:${port}/callback`;
}

export class SpotifyAuth {
  private readonly secrets: vscode.SecretStorage;
  private session: StoredSession | undefined;
  private refreshing: Promise<string> | undefined;
  private loginServer: http.Server | undefined;
  private readonly changed = new vscode.EventEmitter<boolean>();
  /** Fires with the new signed-in state. */
  readonly onDidChange = this.changed.event;

  constructor(secrets: vscode.SecretStorage) {
    this.secrets = secrets;
  }

  async load(): Promise<void> {
    const raw = await this.secrets.get(SESSION_KEY);
    if (!raw) return;
    try {
      this.session = JSON.parse(raw) as StoredSession;
    } catch {
      await this.secrets.delete(SESSION_KEY);
    }
  }

  get signedIn(): boolean {
    return !!this.session;
  }

  async lastClientId(): Promise<string> {
    return (await this.secrets.get(CLIENT_ID_KEY)) ?? '';
  }

  /** A valid access token, refreshed when it is about to expire. */
  async accessToken(): Promise<string> {
    const s = this.session;
    if (!s) throw new SpotifyAuthError('Not signed in');
    if (s.expiresAt - 60_000 > Date.now()) return s.accessToken;
    this.refreshing ??= this.refresh(s).finally(() => (this.refreshing = undefined));
    return this.refreshing;
  }

  async signIn(clientId: string, port: number): Promise<void> {
    clientId = clientId.trim();
    if (!/^[0-9a-f]{32}$/i.test(clientId)) {
      throw new Error('That does not look like a Spotify Client ID (32 hex characters).');
    }
    await this.secrets.store(CLIENT_ID_KEY, clientId);

    const verifier = base64url(crypto.randomBytes(64));
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    const state = base64url(crypto.randomBytes(16));
    const redirect = redirectUri(port);

    const codePromise = this.waitForCode(port, state);
    const url =
      'https://accounts.spotify.com/authorize?' +
      new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        scope: SCOPES,
        redirect_uri: redirect,
        code_challenge_method: 'S256',
        code_challenge: challenge,
        state,
      }).toString();
    await vscode.env.openExternal(vscode.Uri.parse(url));

    const code = await codePromise;
    const tokens = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect,
      client_id: clientId,
      code_verifier: verifier,
    });
    if (!tokens.refresh_token) throw new Error('Spotify did not return a refresh token.');
    await this.save({
      clientId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });
    this.changed.fire(true);
  }

  async signOut(): Promise<void> {
    this.session = undefined;
    await this.secrets.delete(SESSION_KEY);
    this.changed.fire(false);
  }

  cancelLogin(): void {
    this.loginServer?.close();
    this.loginServer = undefined;
  }

  private async refresh(s: StoredSession): Promise<string> {
    let tokens: TokenResponse;
    try {
      tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: s.refreshToken, client_id: s.clientId });
    } catch (err) {
      if (err instanceof SpotifyAuthError) await this.signOut();
      throw err;
    }
    await this.save({
      clientId: s.clientId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? s.refreshToken,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });
    return tokens.access_token;
  }

  private async save(s: StoredSession): Promise<void> {
    this.session = s;
    await this.secrets.store(SESSION_KEY, JSON.stringify(s));
  }

  private waitForCode(port: number, expectedState: string): Promise<string> {
    this.cancelLogin();
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
        if (url.pathname !== '/callback') {
          res.writeHead(404).end();
          return;
        }
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        const ok = !!code && url.searchParams.get('state') === expectedState;
        res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(callbackPage(ok ? 'Signed in. You can close this tab and go back to VS Code.' : `Sign-in failed: ${escapeHtml(error ?? 'state mismatch')}`));
        finish();
        if (ok) resolve(code);
        else reject(new Error(`Spotify sign-in failed: ${error ?? 'state mismatch'}`));
      });
      const timer = setTimeout(() => {
        finish();
        reject(new Error('Sign-in timed out.'));
      }, LOGIN_TIMEOUT_MS);
      const finish = () => {
        clearTimeout(timer);
        server.close();
        if (this.loginServer === server) this.loginServer = undefined;
      };
      server.on('error', (err: NodeJS.ErrnoException) => {
        finish();
        reject(
          err.code === 'EADDRINUSE'
            ? new Error(`Port ${port} is in use. Change "starlit.port" and update the redirect URI in your Spotify app.`)
            : err,
        );
      });
      server.on('close', () => clearTimeout(timer));
      server.listen(port, '127.0.0.1');
      this.loginServer = server;
    });
  }
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    const message = json.error_description ?? json.error ?? `Token request failed (${res.status})`;
    if (res.status === 400 || res.status === 401) throw new SpotifyAuthError(message);
    throw new Error(message);
  }
  return json as TokenResponse;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function callbackPage(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Starlit Lyrics</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:linear-gradient(#000,#142B44);color:#fff;font:16px system-ui">
<p>${message}</p></body>`;
}
