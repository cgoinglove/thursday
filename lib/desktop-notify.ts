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

// Windows takes a script string, so its values travel as env vars: a quote in a
// bot-written title must not end the script. mac and linux take arguments.
//
// The values are `run` arguments rather than anything read from inside the
// script: `system attribute` decodes the environment in a legacy encoding, so
// a Korean title arrived as mojibake, and interpolating into the script text
// would hand a quote the power to end it. argv is UTF-8 and already `text`.
const APPLESCRIPT = `on run argv
display notification (item 2 of argv) with title (item 1 of argv)
end run`;

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

// `--` on the two that take arguments: a title can start with a dash
const COMMAND: Partial<
  Record<
    NodeJS.Platform,
    (title: string, body: string) => [file: string, args: string[]]
  >
> = {
  darwin: (title, body) => [
    "osascript",
    ["-e", APPLESCRIPT, "--", title, body],
  ],
  win32: () => [
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", POWERSHELL],
  ],
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
