import * as assert from 'assert';
import childProcess = require('child_process');
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'im7daniel.vscode-open-ghostty';
const OLD = 'extension.openGhostty';
const NEW = 'extension.openGhosttyNewWindow';
const NATIVE = 'workbench.action.terminal.openNativeConsole';
const OPEN = 'open';

type Launch = { file: string; args: string[] };
type NativeCall = { command: string; args: unknown[] };

suite('Ghostty commands', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const folder = repoRoot;
  const file = path.join(repoRoot, 'package.json');
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');

  let launches: Launch[] = [];
  let nativeCalls: NativeCall[] = [];
  let errors: string[] = [];
  let failNative = false;
  let originalExecFile = childProcess.execFile;
  let originalShowError = vscode.window.showErrorMessage;
  let originalExecuteCommand = vscode.commands.executeCommand;

  const setPlatform = (value: string) => {
    Object.defineProperty(process, 'platform', { value, configurable: true });
  };
  const baseGroup = (group: string | undefined) => (group ?? '').split('@')[0];
  const groupOrder = (group: string | undefined) => Number((group ?? '').split('@')[1]);

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is installed`);
    await extension.activate();
  });

  setup(() => {
    launches = [];
    nativeCalls = [];
    errors = [];
    failNative = false;
    originalExecFile = childProcess.execFile;
    originalShowError = vscode.window.showErrorMessage;
    originalExecuteCommand = vscode.commands.executeCommand;

    // childProcess is a real CommonJS singleton, so this mutates the same module the extension uses.
    (childProcess as { execFile: unknown }).execFile = (
      launchFile: string,
      args: string[],
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      launches.push({ file: launchFile, args });
      callback(null, '', '');
      return {} as unknown;
    };
    (vscode.window as { showErrorMessage: unknown }).showErrorMessage = (message: string) => {
      errors.push(message);
      return Promise.resolve(undefined);
    };
    (vscode.commands as { executeCommand: unknown }).executeCommand = (
      command: string,
      ...args: unknown[]
    ) => {
      if (command === NATIVE) {
        nativeCalls.push({ command, args });
        return failNative
          ? Promise.reject(new Error('native console unavailable'))
          : Promise.resolve(undefined);
      }
      return originalExecuteCommand.call(vscode.commands, command, ...args);
    };
    setPlatform('darwin');

    // Fail before any command runs rather than risk a real launch.
    assert.notStrictEqual(childProcess.execFile, originalExecFile, 'execFile stub installed');
    assert.notStrictEqual(
      vscode.window.showErrorMessage,
      originalShowError,
      'showErrorMessage stub installed',
    );
    assert.notStrictEqual(
      vscode.commands.executeCommand,
      originalExecuteCommand,
      'executeCommand stub installed',
    );
  });

  teardown(() => {
    childProcess.execFile = originalExecFile;
    (vscode.window as { showErrorMessage: unknown }).showErrorMessage = originalShowError;
    (vscode.commands as { executeCommand: unknown }).executeCommand = originalExecuteCommand;
    if (platformDescriptor) {
      Object.defineProperty(process, 'platform', platformDescriptor);
    }
  });

  test('Open Ghostty Here launches Ghostty with the normal argument vector', async () => {
    await vscode.commands.executeCommand(OLD, vscode.Uri.file(folder));
    assert.deepStrictEqual(launches, [{ file: OPEN, args: ['-a', 'Ghostty', folder] }]);
    assert.deepStrictEqual(errors, []);
  });

  test('Open in new Ghostty window launches Ghostty with the new-instance flag', async () => {
    await vscode.commands.executeCommand(NEW, vscode.Uri.file(folder));
    assert.deepStrictEqual(launches, [{ file: OPEN, args: ['-a', 'Ghostty', '-n', folder] }]);
    assert.deepStrictEqual(errors, []);
  });

  test('a selected file resolves to its parent folder for both commands', async () => {
    await vscode.commands.executeCommand(OLD, vscode.Uri.file(file));
    assert.deepStrictEqual(launches[0].args, ['-a', 'Ghostty', folder]);

    launches = [];
    await vscode.commands.executeCommand(NEW, vscode.Uri.file(file));
    assert.deepStrictEqual(launches[0].args, ['-a', 'Ghostty', '-n', folder]);
  });

  test('a missing target reports an error and does not launch', async () => {
    await vscode.commands.executeCommand(OLD);
    assert.strictEqual(launches.length, 0);
    assert.strictEqual(errors[0], 'Open Ghostty: no target folder was selected.');

    errors = [];
    await vscode.commands.executeCommand(NEW);
    assert.strictEqual(launches.length, 0);
    assert.strictEqual(errors[0], 'Open Ghostty: no target folder was selected.');
  });

  test('an invalid target reports an error and does not launch', async () => {
    const missing = vscode.Uri.file(path.join(repoRoot, 'ghostty-missing-target-01'));
    await vscode.commands.executeCommand(OLD, missing);
    assert.strictEqual(launches.length, 0);
    assert.strictEqual(errors[0], `Open Ghostty: cannot open "${missing.fsPath}".`);

    errors = [];
    await vscode.commands.executeCommand(NEW, missing);
    assert.strictEqual(launches.length, 0);
    assert.strictEqual(errors[0], `Open Ghostty: cannot open "${missing.fsPath}".`);
  });

  test('a launch failure reports an error after the launch attempt', async () => {
    (childProcess as { execFile: unknown }).execFile = (
      launchFile: string,
      args: string[],
      callback: (error: Error) => void,
    ) => {
      launches.push({ file: launchFile, args });
      callback(new Error('boom'));
      return {} as unknown;
    };
    await vscode.commands.executeCommand(NEW, vscode.Uri.file(folder));
    assert.deepStrictEqual(launches[0].args, ['-a', 'Ghostty', '-n', folder]);
    assert.strictEqual(errors[0], 'Open Ghostty: failed to launch Ghostty: boom');
  });

  test('paths with spaces, quotes, and shell metacharacters pass through unchanged', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostty-'));
    const weird = path.join(tmp, "sp ace 'quote' $dollar (paren) #hash");
    fs.mkdirSync(weird);
    try {
      await vscode.commands.executeCommand(NEW, vscode.Uri.file(weird));
      assert.deepStrictEqual(launches[0].args, ['-a', 'Ghostty', '-n', weird]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('both commands fall back to the native console on other platforms', async () => {
    setPlatform('linux');
    const target = vscode.Uri.file(folder);
    await vscode.commands.executeCommand(OLD, target);
    await vscode.commands.executeCommand(NEW, target);
    assert.strictEqual(launches.length, 0);
    assert.deepStrictEqual(
      nativeCalls.map((call) => call.command),
      [NATIVE, NATIVE],
    );
    assert.strictEqual((nativeCalls[0].args[0] as vscode.Uri).fsPath, folder);
    assert.strictEqual((nativeCalls[1].args[0] as vscode.Uri).fsPath, folder);
    assert.deepStrictEqual(errors, []);
  });

  test('the native fallback resolves a selected file to its parent folder', async () => {
    setPlatform('linux');
    await vscode.commands.executeCommand(OLD, vscode.Uri.file(file));
    assert.strictEqual(launches.length, 0);
    assert.strictEqual(nativeCalls.length, 1);
    assert.strictEqual((nativeCalls[0].args[0] as vscode.Uri).fsPath, folder);
    assert.deepStrictEqual(errors, []);
  });

  test('the native fallback reports an invalid target and does not launch', async () => {
    setPlatform('linux');
    const missing = vscode.Uri.file(path.join(repoRoot, 'ghostty-missing-target-02'));
    await vscode.commands.executeCommand(NEW, missing);
    assert.strictEqual(nativeCalls.length, 0);
    assert.strictEqual(launches.length, 0);
    assert.strictEqual(errors[0], `Open Ghostty: cannot open "${missing.fsPath}".`);
  });

  test('a failing native fallback reports an error', async () => {
    setPlatform('linux');
    failNative = true;
    await vscode.commands.executeCommand(OLD, vscode.Uri.file(folder));
    assert.strictEqual(nativeCalls.length, 1);
    assert.strictEqual(
      errors[0],
      'Open Ghostty: failed to open the system terminal: native console unavailable',
    );
  });

  test('the manifest pairs both commands in one ordered group on every surface', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const commands = manifest.contributes.commands as Array<{ command: string; title: string }>;
    const titles = new Map(commands.map(({ command, title }) => [command, title] as [string, string]));
    assert.strictEqual(titles.get(OLD), 'Open Ghostty Here');
    assert.strictEqual(titles.get(NEW), 'Open in new Ghostty window');

    const surfaces = ['explorer/context', 'editor/context', 'editor/title', 'editor/title/context'];
    for (const surface of surfaces) {
      const entries = manifest.contributes.menus[surface] as Array<{
        command: string;
        group?: string;
      }>;
      const oldEntry = entries.find((entry) => entry.command === OLD);
      const newEntry = entries.find((entry) => entry.command === NEW);
      assert.ok(oldEntry, `${surface} lists Open Ghostty Here`);
      assert.ok(newEntry, `${surface} lists Open in new Ghostty window`);
      assert.ok(baseGroup(oldEntry.group).length > 0, `${surface} uses an explicit group name`);
      assert.strictEqual(
        baseGroup(newEntry.group),
        baseGroup(oldEntry.group),
        `${surface} shares one group`,
      );
      assert.ok(
        groupOrder(newEntry.group) > groupOrder(oldEntry.group),
        `${surface} orders the new command after the old one`,
      );
    }
  });
});
