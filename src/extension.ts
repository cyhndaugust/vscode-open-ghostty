'use strict';
import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.openGhostty', (e?: vscode.Uri) =>
      openTarget(e, false),
    ),
    vscode.commands.registerCommand('extension.openGhosttyNewWindow', (e?: vscode.Uri) =>
      openTarget(e, true),
    ),
  );
}

async function openTarget(target: vscode.Uri | undefined, newWindow: boolean) {
  if (!target) {
    vscode.window.showErrorMessage('Open Ghostty: no target folder was selected.');
    return;
  }

  let dirPath: string;
  try {
    const stats = await fs.promises.stat(target.fsPath);
    dirPath = stats.isFile() ? path.dirname(target.fsPath) : target.fsPath;
  } catch {
    vscode.window.showErrorMessage(`Open Ghostty: cannot open "${target.fsPath}".`);
    return;
  }

  if (process.platform !== 'darwin') {
    try {
      await vscode.commands.executeCommand(
        'workbench.action.terminal.openNativeConsole',
        vscode.Uri.file(dirPath),
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Open Ghostty: failed to open the system terminal: ${(error as Error).message}`,
      );
    }
    return;
  }

  const args = ['-a', 'Ghostty'];
  if (newWindow) {
    args.push('-n');
  }
  args.push(dirPath);

  await new Promise<void>((resolve) => {
    execFile('open', args, (error, stdout, stderr) => {
      if (error) {
        vscode.window.showErrorMessage(`Open Ghostty: failed to launch Ghostty: ${error.message}`);
      } else {
        console.log(`stdout: ${stdout}`);
        console.error(`stderr: ${stderr}`);
      }
      resolve();
    });
  });
}

export function deactivate() {}
