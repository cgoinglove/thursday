/**
 * Everything these scripts know about Instagram's page, in one place. Class names
 * are generated and change with every release, so nothing here is a class: roles,
 * tags, and the names of props Instagram's own components pass (read off the React
 * tree, which outlives a restyle). When a script stops with "selectors changed",
 * open the page, take one snapshot, fix the line here, and note the date.
 */
export const SEL = {
  // Inbox (last checked 2026-09)
  /** Primary and General share one url and differ by tab (by position: labels are localized). */
  folders: {
    primary: { url: "/direct/inbox/", tab: 0 },
    general: { url: "/direct/inbox/", tab: 1 },
    requests: { url: "/direct/requests/" },
  },
  folderTab: "main [role=tab]",
  /** The thread list. */
  inboxList: "main [role=navigation]",
  /** One thread in it: a pressable row carrying a relative time. */
  inboxRow: "[role=button]:has(abbr)",
  /** An unread row draws its title and preview semibold; a read one is normal. */
  unreadWeight: 600,
  /** Props on the row's components: the id in /direct/t/<id>/, and its last activity. */
  threadIdProp: "threadKeyForSelection",
  lastActivityProp: "last_activity_timestamp_ms",

  // Thread (last checked 2026-09)
  /** One row of the message list; a message row holds an article, a date line does not. */
  messageRow: "[role=group]",
  messageBody: "[role=article]",
  /** The row's message record: { id, timestamp_ms, sender_fbid }. */
  messageRefProp: "currentMessageRef",
  /** True on a message the signed-in account sent. */
  outgoingProp: "outgoing",
  /** A picture smaller than this on screen is an avatar or an icon, not an attachment. */
  minImagePx: 80,

  // Composer (last checked 2026-09)
  /** Sidebar entries that open something rather than a page; Create is the second (after Notifications). */
  sidebarAction: 'a[href="#"]',
  createIndex: 1,
  /** Below this width the sidebar becomes a bottom bar with Create elsewhere. */
  wideWidth: 1280,
  /** The step that takes files; the caption step is the one with a textbox. */
  composer: "[role=dialog]",
  fileInput: "input[type=file]",
  caption: "[role=textbox]",
  /** The picture on the crop step, drawn as an image or a background. */
  preview: 'img, [style*="background-image"]',
  aiLabel: "input[role=switch]",
  /** Crop options start with their ratio; the first is Original. */
  cropOptions: ["original", "1:1", "4:5", "16:9"],
};

/** Instagram's own web client id; its JSON endpoints answer only with it. */
export const APP_ID = "936619743392459";
