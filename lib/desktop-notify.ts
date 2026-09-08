import { execFile } from "node:child_process";
import { APP_NAME } from "@/config";

/**
 * Native desktop notification for work that finished while nobody is on the
 * line. Best effort: the inbox is the durable signal, so failures are swallowed.
 */

/** The OS truncates longer text anyway. */
const TITLE_MAX = 80;
const BODY_MAX = 200;

/** Keeps a hung shell from holding the process. */
const TIMEOUT_MS = 10_000;

// mac and windows take a script string, so values travel as env vars: a quote
// in a bot-written title must not end the script. Linux takes arguments.
const APPLESCRIPT =
  // Without `as text` this fails with -1700: display notification takes only strings
  'display notification ((system attribute "NOTIFY_BODY") as text) with title ((system attribute "NOTIFY_TITLE") as text)';

// Shows under PowerShell's registered AppId; this app has no Start-menu entry of its own
const POWERSHELL = `
$ErrorActionPreference = 'Stop'
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$text = $xml.GetElementsByTagName('text')
[void]$text.Item(0).AppendChild($xml.CreateTextNode($env:NOTIFY_TITLE))
[void]$text.Item(1).AppendChild($xml.CreateTextNode($env:NOTIFY_BODY))
$id = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show([Windows.UI.Notifications.ToastNotification]::new($xml))
`;

const COMMAND: Partial<
  Record<
    NodeJS.Platform,
    (title: string, body: string) => [file: string, args: string[]]
  >
> = {
  darwin: () => ["osascript", ["-e", APPLESCRIPT]],
  win32: () => [
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", POWERSHELL],
  ],
  // `--` because a title can start with a dash
  linux: (title, body) => [
    "notify-send",
    ["--app-name", APP_NAME, "--", title, body],
  ],
};

/** Fire and forget. Does nothing when this OS has no way to. */
export function desktopNotify(title: string, body: string): void {
  const NOTIFY_TITLE = title.slice(0, TITLE_MAX);
  const NOTIFY_BODY = body.slice(0, BODY_MAX);

  const command = COMMAND[process.platform]?.(NOTIFY_TITLE, NOTIFY_BODY);
  if (!command) return;

  const [file, args] = command;
  execFile(
    file,
    args,
    {
      env: { ...process.env, NOTIFY_TITLE, NOTIFY_BODY },
      timeout: TIMEOUT_MS,
      windowsHide: true,
    },
    // Nowhere to report a failed notification
    () => {},
  );
}
