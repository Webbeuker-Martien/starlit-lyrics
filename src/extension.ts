import * as vscode from 'vscode';
import { Controller } from './host/controller.ts';
import { renderHtml, webviewOptions } from './host/html.ts';

let panel: vscode.WebviewPanel | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const controller = new Controller(context);
  context.subscriptions.push(controller);
  const { extensionUri } = context;

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('starlit.lyricsView', {
      resolveWebviewView(view) {
        view.webview.options = webviewOptions(extensionUri);
        view.webview.html = renderHtml(view.webview, extensionUri);
        const attached = controller.attach(view.webview, () => view.visible);
        view.onDidChangeVisibility(() => controller.visibilityChanged());
        view.onDidDispose(() => {
          attached.dispose();
          controller.visibilityChanged();
        });
      },
    }),

    vscode.commands.registerCommand('starlit.openPanel', () => {
      if (panel) {
        panel.reveal(vscode.ViewColumn.Beside);
        return;
      }
      panel = vscode.window.createWebviewPanel('starlit.lyricsPanel', 'Lyrics', vscode.ViewColumn.Beside, webviewOptions(extensionUri));
      panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.png');
      panel.webview.html = renderHtml(panel.webview, extensionUri);
      const p = panel;
      const attached = controller.attach(p.webview, () => p.visible);
      p.onDidChangeViewState(() => controller.visibilityChanged());
      p.onDidDispose(() => {
        attached.dispose();
        panel = undefined;
        controller.visibilityChanged();
      });
    }),

    vscode.commands.registerCommand('starlit.signIn', () => controller.signIn()),
    vscode.commands.registerCommand('starlit.signOut', () => controller.signOut()),
    vscode.commands.registerCommand('starlit.offsetEarlier', () => bumpOffset(100)),
    vscode.commands.registerCommand('starlit.offsetLater', () => bumpOffset(-100)),
    vscode.commands.registerCommand('starlit.toggleFollow', async () => {
      const c = vscode.workspace.getConfiguration('starlit');
      await c.update('followCurrentLine', !c.get<boolean>('followCurrentLine', true), vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand('starlit.toggleTheme', async () => {
      const c = vscode.workspace.getConfiguration('starlit');
      const next = c.get<string>('theme') === 'matchVsCode' ? 'starryNight' : 'matchVsCode';
      await c.update('theme', next, vscode.ConfigurationTarget.Global);
    }),
  );

  await controller.init();
}

async function bumpOffset(deltaMs: number): Promise<void> {
  const c = vscode.workspace.getConfiguration('starlit');
  const next = Math.max(-5000, Math.min(5000, c.get<number>('lyricOffsetMs', 0) + deltaMs));
  await c.update('lyricOffsetMs', next, vscode.ConfigurationTarget.Global);
  vscode.window.setStatusBarMessage(`Lyrics offset: ${next > 0 ? '+' : ''}${next} ms`, 2000);
}

export function deactivate(): void {
  panel?.dispose();
}
