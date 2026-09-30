/**
 * Settings chrome dictionary. English is the source; every other locale
 * mirrors this shape (messages/tr). The settings shell and the Thursday
 * section read it; other section bodies move over one by one.
 */
export type ThursdayDict = {
  footer: string;
  groups: {
    captions: string;
    models: string;
    starting: string;
    running: string;
    history: string;
  };
  captionsAria: string;
  captionCenter: { label: string; hint: string };
  captionSides: { label: string; hint: string };
  modelsNotePlan: string;
  modelsNoteKey: string;
  modelsNoteSuffix: string;
  voiceSection: string;
  onPlan: string;
  byMinute: string;
  backendSection: string;
  perToken: string;
  runsOn: string;
  runsOnAria: string;
  gptLabel: string;
  keyLabel: string;
  lineNeedsPlan: (plan: string) => string;
  lineNeedsSignIn: string;
  lineNeedsKey: string;
  voiceBlock: string;
  planVoiceAria: string;
  styleBlock: string;
  styleHint: string;
  yourOwn: string;
  yourOwnAbout: string;
  yourOwnPlaceholder: string;
  yourOwnAria: string;
  modelBlock: string;
  backendModelAria: string;
  otherModelPlaceholder: string;
  otherModelAria: string;
  effortBlock: string;
  toolsBlock: string;
  webSearch: string;
  readSkills: string;
  searchNote: string;
  skillsNote: (count: number) => string;
  noSkills: string;
  instructionsBlock: string;
  instructionsPlaceholder: string;
  instructionsAria: string;
  noLineTitle: string;
  noLineHint: string;
  signInAgain: string;
  planNoCalls: (plan: string) => string;
  planSignInHint: string;
  keyHint: string;
  runsMeanwhile: (label: string) => string;
  keyRowNone: string;
  keyRowPlanNoCalls: (plan: string) => string;
  keyRowHint: string;
  personas: Record<string, { label: string; about: string }>;
  wakeTitle: string;
  wakeSwitch: string;
  wakeAria: string;
  wakeOff: string;
  wakeNotEnglish: string;
  wakeTerse: string;
  wakeOn: string;
  shortcutTitle: string;
  shortcutSwitch: string;
  shortcutRecording: string;
  shortcutEmpty: string;
  shortcutBare: string;
  shortcutListening: string;
  shortcutFocused: string;
  shortcutOff: string;
  callBackTitle: string;
  callBackAria: string;
  callBackNames: Record<"off" | "waiting" | "any", string>;
  callBackHint: Record<"off" | "waiting" | "any", string>;
  callBackNeedsTab: string;
  resetTitle: string;
  resetHint: string;
  resetButton: string;
  resetConfirmTitle: string;
  resetConfirmBody: string;
  resetConfirmOk: string;
  resetWiped: (calls: number, threads: number, notes: number) => string;
  runningUpdateTo: (to: string) => string;
  runningRestarting: string;
  runningOut: (version: string) => string;
  runningStop: string;
  runningKeep: string;
  runningMoveTo: string;
  runningMovePress: string;
  runningMacOnly: string;
  runningUnreached: string;
  runningUpdateFail: (to: string) => string;
  runningUpdate: string;
  runningTitles: Record<
    "background" | "terminal" | "source" | "elsewhere",
    string
  >;
  runningHints: Record<
    "background" | "terminal" | "source" | "elsewhere",
    string
  >;
  copy: string;
  copied: string;
  callHistoryTitle: string;
  callHistoryHint: string;
  callLogTitle: string;
  callLogDescription: (scroll: boolean) => string;
  callLogEmpty: string;
  deleteAll: string;
  deleteAllTitle: string;
  deleteAllBody: string;
  deleteAllOk: string;
  deletedCount: (count: number) => string;
  callDeleted: string;
  deleteCallTitle: (when: string) => string;
  deleteCallBody: string;
  deleteOk: string;
  deleteCallAria: string;
  onTheLine: string;
  inWriting: string;
  jobWords: Record<"running" | "waiting" | "done" | "cancelled", string>;
};

export type MemoryDict = {
  editWithModel: string;
  notesFacts: (notes: number, facts: number, more: boolean) => string;
  newNote: string;
  filter: string;
  nothingMatches: string;
  sections: Record<string, string>;
  forgetNoteTitle: (path: string) => string;
  forgetNoteBody: string;
  deleteOk: string;
  factOne: string;
  factMany: string;
  lastRead: string;
  neverRead: string;
  editNoteLine: string;
  forgetNote: string;
  noteLineAria: string;
  noteLinePlaceholder: string;
  save: string;
  cancel: string;
  addFactAria: string;
  addFactPlaceholder: string;
  add: string;
  forgetFactTitle: string;
  forgetFactBody: (text: string) => string;
  factAria: string;
  editFact: string;
  forgetFact: string;
  sources: Record<string, string>;
  kinds: Record<string, string>;
  kindPlaceholders: Record<string, string>;
  kindFacts: Record<string, string>;
  newNoteTitle: string;
  newNoteDesc: string;
  create: string;
  kindLabel: string;
  nameLabel: string;
  summaryLabel: string;
  factsLabel: string;
  summaryPlaceholder: string;
  factsPlaceholder: (fact: string) => string;
  editMemoryAria: string;
  sendAria: string;
  editPlaceholder: string;
};

export type ThreadsDict = {
  clearTitle: string;
  clearBody: string;
  clearOk: string;
  deleteTitle: (label: string) => string;
  deleteBody: string;
  deleteOk: string;
  filter: string;
  resultCount: (shown: number, total: number) => string;
  emptyMatch: string;
  emptyFresh: string;
  railShown: (count: number) => string;
  railWaiting: (count: number) => string;
  railUnread: (count: number) => string;
  clearFinished: string;
  routineTitle: string;
  closeThread: string;
  menuMore: string;
  stop: string;
  delete: string;
  stopped: string;
  doneDefault: string;
  takingOn: (bot: string) => string;
  stepOne: string;
  stepMany: string;
};

export type RoutineDict = {
  startsNote: string;
  railSetUp: (total: number, on: number) => string;
  railMost: (max: number) => string;
  newRoutine: string;
  empty: string;
  notRunYet: string;
  offBefore: string;
  botOff: (bot: string) => string;
  botGone: (bot: string) => string;
  runningNow: string;
  lastWaits: (said: string) => string;
  nextPrefix: string;
  offWord: string;
  onOrOff: (label: string) => string;
  openRoutine: (label: string) => string;
  deleteTitle: (label: string) => string;
  deleteBody: string;
  deleteOk: string;
  newTitle: string;
  moreActions: string;
  deleteAction: string;
  closeRoutine: string;
  nameField: string;
  namePlaceholder: string;
  nameHint: string;
  botField: string;
  botHint: string;
  pickBot: string;
  whenField: string;
  howStarts: string;
  kindOnce: string;
  kindDaily: string;
  kindEvery: string;
  onWord: string;
  atWord: string;
  orWord: string;
  inAnHour: string;
  everyWord: string;
  hoursWord: string;
  dayNames: string[];
  dayWords: string[];
  monthNames: string[];
  daySets: { label: string; days: number[] }[];
  jobField: string;
  jobPlaceholder: string;
  jobHint: string;
  runsWord: string;
  notRunYetLine: string;
  stopped: string;
  noWords: string;
  stillNeeds: (missing: string) => string;
  missingName: string;
  missingBot: string;
  missingTime: string;
  missingTimeAhead: string;
  missingJob: string;
  missingNothing: string;
  missingAnd: string;
  save: string;
  lastRunOpen: string;
  runNow: string;
  create: string;
  today: string;
  tomorrow: string;
  anotherDay: string;
  timeOfDay: string;
  timePassed: string;
  pickTimeAndDay: string;
  pickTime: string;
  switchesOff: string;
  firstStart: string;
  nextRun: (when: string) => string;
  scheduleOnce: (date: string) => string;
  scheduleEveryHour: string;
  scheduleEveryHours: (hours: number) => string;
  scheduleDaily: (time: string) => string;
  scheduleDailyDays: (time: string, names: string) => string;
  scheduleDayTime: (day: string, time: string) => string;
  nowWord: string;
  yesterdayWord: string;
};

export type BotDict = {
  botsMost: (count: number, max: number) => string;
  newBot: string;
  crowded: (count: number, app: string) => string;
  emptyPitch: (app: string) => string;
  readyMade: string;
  addDialogTitle: string;
  addDialogDesc: string;
  addDialogTail: string;
  alreadyAdded: string;
  cancel: string;
  addOne: (name: string) => string;
  addMany: (count: number) => string;
  readyMadeAria: (count: number) => string;
  roomFits: (room: number) => string;
  noteFullTick: string;
  noteFullUnticked: (wanted: number, fit: string) => string;
  noteNone: string;
  noteSome: (wanted: number, total: number) => string;
  needsMedia: (needs: string) => string;
  needsAnd: string;
  mediaWords: Record<string, string>;
  createdOk: string;
  deletedOk: string;
  deleteTitle: (name: string) => string;
  deleteBody: (app: string) => string;
  deleteOk: string;
  clearLineTitle: (name: string) => string;
  clearLineBody: (app: string) => string;
  clearOk: string;
  newBotTitle: string;
  offWord: string;
  onOrOffBot: (name: string) => string;
  handWorkTip: (app: string) => string;
  deleteBotAria: string;
  nameRow: string;
  namePlaceholder: string;
  nameHintMade: (app: string) => string;
  nameHintNew: (app: string, max: number) => string;
  descRow: string;
  descPlaceholder: string;
  descHint: (app: string) => string;
  clearLineAria: string;
  mayAddLine: (name: string) => string;
  mayAddLineHint: string;
  runsOnRow: string;
  runsOnHint: string;
  appDefaultHint: string;
  effortRow: string;
  effortHint: string;
  compactRow: string;
  compactFromDefault: string;
  compactUnit: string;
  compactSummary: string;
  compactFromDefaultLong: (summarize: string) => string;
  compactHandDefault: (summarize: string) => string;
  compactHandModel: (summarize: string) => string;
  compactPct: (pct: number, k: string, summarize: string) => string;
  compactUnknown: (summarize: string) => string;
  toolsRow: string;
  promptRow: string;
  promptPlaceholder: string;
  memoryWord: string;
  fileOne: string;
  fileMany: (count: number) => string;
  showInManager: string;
  folderWord: string;
  nothingKept: string;
  deleteFileTitle: (file: string) => string;
  deleteFileBody: (bot: string) => string;
  deleteFileAria: (file: string) => string;
  fileDeletedOk: string;
  railOff: string;
  tokensSome: (count: string) => string;
  tokensNone: string;
  sinceWord: string;
  needsMissing: (missing: string) => string;
  keepMemory: string;
  createBot: string;
  missingName: string;
  missingDesc: string;
  recentWord: string;
  historyWord: string;
  recentEmpty: string;
  jobWaiting: string;
  jobWorking: string;
  jobStopped: string;
  jobDone: string;
  pinHint: string;
  pickTools: string;
  unpinTool: (name: string) => string;
  loadedHint: string;
  searchTools: string;
  nothingMatches: string;
  rosterWaiting: string;
  rosterWorking: (label: string) => string;
  rosterOff: string;
  rosterIdleNone: string;
  rosterIdleLast: (ago: string) => string;
  justNow: string;
  agoWord: (ago: string) => string;
  seedHints: Record<string, string>;
};

export type FilesDict = {
  finishedWord: string;
  countEmpty: string;
  resultOne: string;
  resultMany: string;
  countResults: (shown: number, total: string) => string;
  countFiles: (files: string) => string;
  revealFolder: string;
  filter: string;
  everyone: string;
  unsorted: string;
  showMore: (more: number, total: string) => string;
  deletedOk: string;
  deleteTitle: (name: string) => string;
  deleteFileBody: string;
  deleteFolderBody: string;
  deleteOk: string;
  shelfWord: string;
  fileWord: string;
  filesWord: string;
  openNewTab: string;
  revealManager: string;
  deleteAria: string;
  setEmpty: string;
  setRest: (shown: number, total: string) => string;
  nothingEmpty: string;
  nothingPick: string;
};

export type WorkspaceDict = {
  scratchDone: string;
  emptyScratchTitle: string;
  emptyScratchBody: (
    scratch: string,
    artifacts: string,
    projects: string,
  ) => string;
  emptyScratchOk: string;
  revealFolder: string;
  emptyScratchBtn: string;
  filter: string;
  nothingMatches: string;
  emptyFolder: string;
  foldersWord: string;
  filesWord: string;
  showMore: (more: number, total: string) => string;
  folderOne: string;
  folderMany: string;
  fileOne: string;
  fileMany: string;
  countEmpty: string;
  countOf: (total: string) => string;
  nothingEmptyHead: string;
  nothingEmptyTail: string;
  pickFile: string;
  nothingListed: string;
  fileDeletedOk: string;
  deleteTitle: (name: string) => string;
  deleteBody: string;
  deleteOk: string;
  openNewTab: string;
  revealManager: string;
  deleteAria: string;
};

export type SkillsDict = {
  countLine: (on: number, off: number) => string;
  filter: string;
  customGroup: string;
  customHint: string;
  addSkill: string;
  botOwn: (bot: string) => string;
  botOwnHint: (bot: string) => string;
  defaultGroup: string;
  defaultHint: string;
  crowded: (count: number) => string;
  railShipped: (count: number) => string;
  railInstalled: (count: number) => string;
  deleteTitle: (name: string) => string;
  deleteBody: string;
  deleteOk: string;
  rowSwitch: (name: string) => string;
  rowDelete: (name: string) => string;
  discardTitle: string;
  discardBody: (file: string) => string;
  discardOk: string;
  editBtn: string;
  cancelBtn: string;
  saveBtn: string;
  savedOk: string;
  fileContents: (name: string) => string;
  tooLong: string;
  notText: string;
  newTitle: string;
  newDesc: string;
  cancelAction: string;
  createAction: string;
  uploadAction: string;
  writeTab: string;
  uploadTab: string;
  nameField: string;
  descField: string;
  descPlaceholder: string;
  contentField: string;
  contentPlaceholder: string;
  overLimit: (mb: number) => string;
  dropHint: string;
  reqTitle: string;
  reqMdLine: string;
  reqZipLine: string;
  reqMax: (mb: number) => string;
};

export type McpDict = {
  railNone: string;
  railLine: (connected: number, tools: number) => string;
  railFailed: (failed: number) => string;
  connectedGroup: string;
  addServer: string;
  deletedOk: string;
  deleteTitle: (name: string) => string;
  deleteBody: string;
  deleteOk: string;
  unreadable: string;
  deleteBtn: string;
  reconnectBtn: string;
  filterTools: string;
  toolOne: string;
  toolMany: string;
  noToolsYet: string;
  noToolMatch: string;
  schemaBtn: string;
  testBtn: string;
  runBtn: string;
  badJson: string;
  addTitle: string;
  addDesc: string;
  cancelBtn: string;
  connectBtn: string;
  nameField: string;
  jsonField: string;
  transportField: string;
  urlField: string;
  headersField: string;
  commandField: string;
  argsField: string;
  envField: string;
  removeRow: string;
  addRowBtn: string;
  needUrl: string;
  needCommand: string;
  needUrlOrCommand: string;
  noServerIn: string;
  authTitle: (name: string) => string;
  authDesc: string;
  connectFail: (name: string) => string;
  connectedOk: (name: string) => string;
  toolsAvailable: (count: number) => string;
  presetsGroup: string;
  filterPresets: string;
  resultCount: (shown: number, total: number) => string;
};

export type SigninsDict = {
  railNote: string;
  empty: string;
  steps: { title: string; text: string }[];
  accountsWord: string;
  usedWord: string;
  keptWord: string;
  signOutTitleOne: (site: string) => string;
  signOutTitleAccount: (account: string, site: string) => string;
  signOutBody: (others: number, site: string) => string;
  signOutOk: string;
  signOutBtn: string;
  signOutAria: (account: string) => string;
  revokeAria: (name: string) => string;
  noBot: string;
  asksSuffix: string;
  allowBtn: string;
  ownChromeTitle: string;
  ownChromeDesc: string;
  getExtension: string;
};

export type ReachSeg =
  | string
  | { bold: string }
  | { link: { href: string; label: string } };

export type ReachStep = {
  body: ReachSeg[];
  slot?:
    | { open: string; label: string }
    | { key: string; looks: string }
    | { manifest: true }
    | { mailbox: true }
    | { person: true }
    | { write: true }
    | { says: string; does?: string };
};

export type ReachDict = {
  note: string;
  stoppedToken: string;
  tokensIn: (have: number, total: number) => string;
  notSet: string;
  stoppedTurned: (label: string) => string;
  reconnecting: (problem: string) => string;
  connecting: (problem: string) => string;
  listeningAs: (bot: string | null, name: string) => string;
  connectingDots: string;
  waitingFirst: (bot: string | null) => string;
  mailStoppedPassword: string;
  mailStoppedService: string;
  mailHeld: (bot: string | null, holding: string) => string;
  mailCanWrite: (bot: string | null, name: string) => string;
  mailNameAddress: (bot: string | null) => string;
  waitingFirstMsg: string;
  cameraAria: (shown: string) => string;
  changeToken: string;
  tokenAria: string;
  replaceBtn: string;
  saveBtn: string;
  cancelBtn: string;
  removeBtn: string;
  removeTokenTitle: string;
  removeTokenBody: string;
  removeTokenOk: string;
  copiedBtn: string;
  copyManifest: string;
  letInLine: (who: string) => string;
  canWriteLine: (who: string) => string;
  letGoTitle: (who: string) => string;
  letGoBody: string;
  letGoOk: string;
  letGoBtn: string;
  lostTokenAgain: string;
  mailboxAppPassword: string;
  removeMailboxTitle: string;
  removeMailboxBody: string;
  removeMailboxOk: string;
  changeBtn: string;
  addressField: string;
  appPasswordField: string;
  appPasswordPlaceholder: string;
  domainFallback: string;
  noServersNote: (domain: string) => string;
  readingServer: string;
  sendingServer: string;
  portField: string;
  replaceAction: string;
  saveAction: string;
  stopMailTitle: (who: string) => string;
  stopMailBody: string;
  stopMailOk: string;
  ownAddressAria: string;
  writeTo: (address: string) => string;
  copyHerAddress: string;
  mailtoFallback: string;
  steps: Record<string, ReachStep[]>;
};

export type ConfigDict = {
  groups: Record<string, { title: string; hint: string; note?: string }>;
  groupNoteFallback: string;
  readyWord: string;
  modelsFooter: string;
  keysFooterSet: (set: number, total: number) => string;
  keysFooterLost: (lost: number) => string;
  keysFooterNeedCall: string;
  keysFooterStay: string;
  moreProviders: (count: number) => string;
  moreWord: string;
  searchHint: string;
  ariaSet: string;
  ariaSetEnv: string;
  ariaLost: string;
  ariaUnset: string;
  keyRefused: string;
  creditsLeft: (amount: string) => string;
  signInAgain: string;
  enterAgain: string;
  signedOut: string;
  notSet: string;
  signedIn: string;
  setWord: string;
  setInEnv: string;
  signinRefused: string;
  limitReached: string;
  usedPercent: (pct: number) => string;
  resetsIn: (when: string) => string;
  signedInWord: string;
  signInWithAccount: string;
  planUsedAria: string;
  automaticWord: string;
  offWord: string;
  autoWord: string;
  unsetPlanRuns: (label: string) => string;
  unsetNoOffer: string;
  effortWord: string;
  signOutOf: (label: string) => string;
  signedOutOf: (label: string) => string;
  signInInstead: string;
  closeBtn: string;
  cancelBtn: string;
  signOutBtn: string;
  signOutConfirmBody: string;
  planSpendNote: string;
  signInWindowNote: string;
  lostSigninAgain: string;
  saveKeyOk: (label: string) => string;
  removeKeyOk: (label: string) => string;
  removeKeyTitle: (label: string) => string;
  removeKeyBody: string;
  closeAction: string;
  removeAction: string;
  cancelAction: string;
  replaceAction: string;
  saveAction: string;
  newValuePlaceholder: string;
  pasteAgainPlaceholder: string;
  pasteKeyFallback: string;
  getKeyAt: (host: string) => string;
  lostKeyAgain: string;
  envSetNote: (label: string) => string;
  mediaLabels: Record<string, { label: string; hint: string }>;
  mediaMissing: (kind: string) => string;
  phoneFooter: string;
  entryHints: Record<string, string>;
  entryLabels: Record<string, string>;
};

export type AiDict = {
  pickModel: string;
  notPicked: string;
  appDefault: string;
  noKeyYet: (label: string) => string;
  lostSignin: (label: string) => string;
  lostKey: (label: string) => string;
  signInAgain: string;
  pasteAgain: string;
  everyCarries: (label: string) => string;
  catalogNoRead: string;
  typeModelId: string;
  modelAria: string;
  searchModels: string;
  searchPlaceholder: string;
  sortAria: string;
  sortCheap: string;
  sortDear: string;
  sortName: string;
  per1M: string;
  takeAsId: (query: string) => string;
  noMatch: (query: string) => string;
  clearSearch: string;
  nothingPicked: string;
  cancelBtn: string;
  useModel: string;
  freeWord: string;
  retiringWord: string;
  kindText: string;
  kindTitles: Record<string, string>;
  matchCount: (count: number, query: string) => string;
  shelfCountKind: (count: number, label: string) => string;
  shelfCountTools: (count: number, total: number, label: string) => string;
  emptyShelf: string;
  pickModelFirst: string;
  autoWord: string;
  modelDefaultTitle: string;
  effortAria: string;
  effortStep: (step: string) => string;
  ladderUnknown: string;
  ladderNone: string;
  ladderSteps: (count: number) => string;
  blockedTitle: string;
  blockedDesc: string;
  signinBtn: string;
  runsOnPlan: string;
  saveKeyBtn: string;
  pasteKeyFallback: string;
  voiceAria: string;
  clickHear: string;
  anotherVoiceId: string;
  anotherVoiceAria: string;
  saveAction: string;
  closeAria: string;
  clipUnreadable: string;
  sampleFailTitle: string;
  mismatchNot: (label: string) => string;
  saveBtn: string;
  replaceIt: string;
  keyAria: string;
  voiceKeyTitle: string;
  notNow: string;
  keyNotSaved: string;
  lostKeyAgain: string;
  liveShareNote: string;
  liveSeparateNote: string;
  callLinesEnough: string;
  signInLost: string;
  noCallsPlan: string;
  runsOnPlanLine: string;
  runsOnKeyLine: string;
  planDefault: string;
  signInAgainBtn: string;
  signInBtn: string;
  keyTitle: string;
  keyPerMinute: string;
  keyRunsOnPlan: string;
  keyRunsNow: string;
  signedInWord: string;
  savedWord: string;
  pasteKeyBtn: string;
  getKeyShort: string;
};

export type SettingsDict = {
  dialogTitle: string;
  navLabel: string;
  groups: Record<"call" | "work" | "app" | "community", string>;
  sections: Record<
    | "thursday"
    | "memory"
    | "bot"
    | "threads"
    | "routines"
    | "files"
    | "skills"
    | "mcp"
    | "signins"
    | "models"
    | "keys"
    | "phone",
    { label: string; hint: string }
  >;
  fileTabs: { finished: string; allFiles: string };
  tabbedLabel: string;
  themeLabel: string;
  themes: Record<"system" | "light" | "dark", string>;
  languageLabel: string;
  languageHint: string;
  thursday: ThursdayDict;
  memory: MemoryDict;
  threads: ThreadsDict;
  routine: RoutineDict;
  bot: BotDict;
  files: FilesDict;
  workspace: WorkspaceDict;
  skills: SkillsDict;
  mcp: McpDict;
  signins: SigninsDict;
  reach: ReachDict;
  config: ConfigDict;
  ai: AiDict;
};

export const en: SettingsDict = {
  dialogTitle: "Settings",
  navLabel: "Settings sections",
  groups: {
    call: "call",
    work: "work",
    app: "app",
    community: "community",
  },
  sections: {
    thursday: {
      label: "Thursday",
      hint: "Captions, models, and how a call starts",
    },
    memory: { label: "Memory", hint: "What Thursday remembers about you" },
    bot: { label: "Bots", hint: "Who Thursday hands work to" },
    threads: { label: "Threads", hint: "Work the bots were handed" },
    routines: {
      label: "Routines",
      hint: "Work that starts by itself, on a schedule",
    },
    files: {
      label: "Files",
      hint: "What the bots finished, and everything else they wrote",
    },
    skills: { label: "Skills", hint: "Instructions the bots load on demand" },
    mcp: {
      label: "Connectors",
      hint: "Apps the bots can use, from MCP servers",
    },
    signins: {
      label: "Sign-ins",
      hint: "The sites you signed in to, and the bots that may use each",
    },
    models: {
      label: "Models",
      hint: "What bots think with, and what they draw, film and speak with",
    },
    keys: { label: "API keys", hint: "The accounts the app runs on" },
    phone: {
      label: "Phone",
      hint: "Write to Thursday from a chat app or by email",
    },
  },
  fileTabs: { finished: "Finished", allFiles: "All files" },
  tabbedLabel: "Screens of this section",
  themeLabel: "Theme",
  themes: { system: "System", light: "Light", dark: "Dark" },
  languageLabel: "Language",
  languageHint: "Settings screens read in this language.",
  thursday: {
    footer:
      "Both of her prompts are assembled fresh on every call — memory, the roster and your skills go in. Changes here apply from the next call.",
    groups: {
      captions: "Captions",
      models: "Models",
      starting: "Starting a call",
      running: "Running",
      history: "History",
    },
    captionsAria: "Captions",
    captionCenter: {
      label: "Her last line",
      hint: "One caption under the mark — only what she said.",
    },
    captionSides: {
      label: "Both sides",
      hint: "Hers on the left, yours on the right. Click a line to read it again.",
    },
    modelsNotePlan: "Both run on your GPT Subscription",
    modelsNoteKey: "Both run on your OpenAI key",
    modelsNoteSuffix: "Instructions are saved when you leave the field.",
    voiceSection: "Voice",
    onPlan: "on your plan",
    byMinute: "billed by the minute",
    backendSection: "Backend",
    perToken: "billed per token",
    runsOn: "runs on",
    runsOnAria: "What a call runs on",
    gptLabel: "GPT Subscription",
    keyLabel: "OpenAI key",
    lineNeedsPlan: (plan) => ` · ${plan || "plan"} · no calls`,
    lineNeedsSignIn: " · sign in",
    lineNeedsKey: " · add",
    voiceBlock: "voice",
    planVoiceAria: "Voice on the GPT Subscription",
    styleBlock: "style",
    styleHint: "How she talks to you. It never changes what she can do.",
    yourOwn: "Your own",
    yourOwnAbout: "Say it in your words, over the one above.",
    yourOwnPlaceholder: "Quieter. Don't explain things I didn't ask about.",
    yourOwnAria: "In your own words",
    modelBlock: "model",
    backendModelAria: "Backend model",
    otherModelPlaceholder: "Other model id",
    otherModelAria: "Other backend model id",
    effortBlock: "effort",
    toolsBlock: "tools",
    webSearch: "Search the web",
    readSkills: "Read skills herself",
    searchNote: "Each search adds to the backend's OpenAI usage.",
    skillsNote: (count) =>
      `The same ${count} a bot reads. Each one she opens spends a page of the call on it.`,
    noSkills: "Nothing installed yet — there is nothing for her to read.",
    instructionsBlock: "instructions",
    instructionsPlaceholder:
      "How work should be handed over, what to check first.",
    instructionsAria: "Backend instructions",
    noLineTitle: "No GPT Subscription or OpenAI key",
    noLineHint: "Her voice and the backend both run on one of them",
    signInAgain: "Sign in again",
    planNoCalls: (plan) =>
      `The ${plan} plan runs bots and calls in writing, but not spoken calls. Sign in again with a paid plan.`,
    planSignInHint:
      "Sign in with ChatGPT and calls run on your plan, with no bill by the minute.",
    keyHint:
      "Paste an OpenAI API key. OpenAI bills a call by the minute, apart from ChatGPT.",
    runsMeanwhile: (label) => ` Until then a call runs on your ${label}.`,
    keyRowNone: "No GPT Subscription or OpenAI key",
    keyRowPlanNoCalls: (plan) =>
      `Your ${plan ? `${plan} ` : ""}plan has no spoken calls`,
    keyRowHint: "Her voice and the backend both run on one of them",
    personas: {
      sunny: {
        label: "Bright",
        about: "Quick to laugh. Asks about your day and remembers it.",
      },
      calm: { label: "Calm", about: "Unhurried. Listens more than she talks." },
      straight: {
        label: "Straight",
        about: "Dry and direct. No flattery, no filler.",
      },
      rough: {
        label: "Rough",
        about: "Blunt, loud, swears a bit. All heart.",
      },
    },
    wakeTitle: "Wake phrase",
    wakeSwitch: "Answer to her name",
    wakeAria: "Wake phrase",
    wakeOff:
      "Between calls, the browser listens for it and picks up — Chrome by sending what it hears to Google.",
    wakeNotEnglish: "English words only — she listens for it in English.",
    wakeTerse: "One word will wake her by accident — say hello first.",
    wakeOn: "Heard loosely, in English. Near misses count.",
    shortcutTitle: "Shortcut",
    shortcutSwitch: "Answer to a key",
    shortcutRecording: "Press the keys…",
    shortcutEmpty: "Set a shortcut",
    shortcutBare: "Hold Ctrl, Alt or Cmd — a plain key is typing.",
    shortcutListening: "Esc to keep the one you have.",
    shortcutFocused: "Only while this tab has focus. Not while you are typing.",
    shortcutOff: "Starts a call, and ends the one that is running.",
    callBackTitle: "She calls you",
    callBackAria: "She calls you",
    callBackNames: {
      off: "Never",
      waiting: "When a job needs me",
      any: "Whenever a job ends",
    },
    callBackHint: {
      off: "Nothing opens a call but you.",
      waiting: "A job that stopped to ask gets her to ring you.",
      any: "Anything a bot finishes, she rings you to tell you.",
    },
    callBackNeedsTab:
      "Needs this tab open. It rings until you answer, decline or let it go.",
    resetTitle: "Reset history",
    resetHint: "Calls, jobs and memory. Keys and bots stay.",
    resetButton: "Reset",
    resetConfirmTitle: "Reset history?",
    resetConfirmBody:
      "Every call, every job and everything she remembers is deleted for good. Keys, bots and connectors stay, and so does what each bot keeps for itself.",
    resetConfirmOk: "Reset",
    resetWiped: (calls, threads, notes) =>
      `Wiped ${calls} calls, ${threads} jobs, ${notes} notes`,
    runningUpdateTo: (to) => `Updating to ${to}…`,
    runningRestarting: "Thursday restarts in a moment.",
    runningOut: (version) => `${version} is out.`,
    runningStop: "To stop it",
    runningKeep: "To keep it running without one, press Ctrl+C there and run",
    runningMoveTo: "To move to it",
    runningMovePress: "To move to it, press Ctrl+C there and run",
    runningMacOnly: " Running in the background is macOS only for now.",
    runningUnreached: " npm could not be asked for a newer version.",
    runningUpdateFail: (to) => `Could not update to ${to}.`,
    runningUpdate: "Update",
    runningTitles: {
      background: "In the background",
      terminal: "In a terminal",
      source: "From source",
      elsewhere: "Started by something else",
    },
    runningHints: {
      background: "Starts when you log in, and comes back if it stops.",
      terminal: "Closing that terminal stops Thursday.",
      source: "pnpm dev in a terminal. Closing it stops Thursday.",
      elsewhere: "It stops the way it was started.",
    },
    copy: "Copy",
    copied: "Copied",
    callHistoryTitle: "Call history",
    callHistoryHint: "Every call, word for word — hers and yours",
    callLogTitle: "Call history",
    callLogDescription: (scroll) =>
      `Everything said on the line, oldest at the top.${scroll ? " Scroll up for older calls." : ""}`,
    callLogEmpty:
      "No calls yet. Everything said on the line is kept here — hers and yours, in the order it was said.",
    deleteAll: "Delete all",
    deleteAllTitle: "Delete every call?",
    deleteAllBody:
      "Every turn of every call goes — and she stops reading any of it back into the next call. A call still on the line stays.",
    deleteAllOk: "Delete all",
    deletedCount: (count) =>
      count === 1 ? "1 call deleted" : `${count} calls deleted`,
    callDeleted: "Call deleted",
    deleteCallTitle: (when) => `Delete the call from ${when}?`,
    deleteCallBody:
      "Every turn of it goes — and she stops reading it back into the next call.",
    deleteOk: "Delete",
    deleteCallAria: "Delete this call",
    onTheLine: "on the line",
    inWriting: "in writing",
    jobWords: {
      running: "working",
      waiting: "waiting on you",
      done: "done",
      cancelled: "stopped",
    },
  },
  memory: {
    editWithModel: "Edit with a model",
    notesFacts: (notes, facts, more) =>
      `${notes}${more ? "+" : ""} notes · ${facts}${more ? "+" : ""} facts`,
    newNote: "New note",
    filter: "Filter memory",
    nothingMatches: "Nothing matches",
    sections: {
      you: "You",
      people: "People",
      projects: "Projects",
      topics: "Topics",
      other: "Other",
    },
    forgetNoteTitle: (path) => `Forget ${path}?`,
    forgetNoteBody: "Every fact in this note is deleted for good.",
    deleteOk: "Delete",
    factOne: "fact",
    factMany: "facts",
    lastRead: "Last read back",
    neverRead: "Never read back",
    editNoteLine: "Edit the note's line",
    forgetNote: "Forget this note",
    noteLineAria: "The note's line",
    noteLinePlaceholder: "One line Thursday sees in her list",
    save: "Save",
    cancel: "Cancel",
    addFactAria: "Add a fact",
    addFactPlaceholder: "Add a fact",
    add: "Add",
    forgetFactTitle: "Forget this fact?",
    forgetFactBody: (text) => `"${text}" is deleted for good.`,
    factAria: "Fact",
    editFact: "Edit this fact",
    forgetFact: "Forget this fact",
    sources: { you: "you", call: "on a call", bot: "a bot" },
    kinds: { people: "Person", projects: "Project", topics: "Topic" },
    kindPlaceholders: {
      people: "alex",
      projects: "thursday",
      topics: "scheduling",
    },
    kindFacts: {
      people: "Moved to the platform team in March",
      projects: "Ships behind a feature flag until April",
      topics: "No meetings before 10am",
    },
    newNoteTitle: "New note",
    newNoteDesc: "Where Thursday keeps what she learns about this.",
    create: "Create",
    kindLabel: "Kind",
    nameLabel: "Name",
    summaryLabel: "Summary",
    factsLabel: "Facts",
    summaryPlaceholder: "One line Thursday sees in her list",
    factsPlaceholder: (fact) => `One per line\n${fact}`,
    editMemoryAria: "Edit memory",
    sendAria: "Send",
    editPlaceholder: "Tell memory what changed",
  },
  threads: {
    clearTitle: "Clear finished jobs?",
    clearBody:
      "Everything done or stopped goes, messages included. Running and waiting jobs stay.",
    clearOk: "Clear",
    deleteTitle: (label) => `Delete "${label}"?`,
    deleteBody: "Its messages go with it — nothing can be picked back up.",
    deleteOk: "Delete",
    filter: "Filter by label, bot or word",
    resultCount: (shown, total) => `${shown} of ${total}`,
    emptyMatch: "Nothing here matches. Keep scrolling to search further back.",
    emptyFresh:
      "Nothing yet. When Thursday hands a job to a bot mid-call, it shows up here — while it runs, and after.",
    railShown: (count) => `${count} shown`,
    railWaiting: (count) => ` · ${count} waiting on you`,
    railUnread: (count) => ` · ${count} new result${count === 1 ? "" : "s"}`,
    clearFinished: "Clear finished",
    routineTitle: "Started by a routine",
    closeThread: "Close the thread",
    menuMore: "More",
    stop: "Stop",
    delete: "Delete",
    stopped: "Stopped",
    doneDefault: "Done",
    takingOn: (bot) => `${bot} is taking it on…`,
    stepOne: "step",
    stepMany: "steps",
  },
  routine: {
    startsNote:
      "Starts while Thursday is running on this computer, whether or not a tab is open. A time that passed meanwhile starts once, not once for each.",
    railSetUp: (total, on) => `${total} set up · ${on} on`,
    railMost: (max) => ` · ${max} is the most`,
    newRoutine: "New routine",
    empty:
      'Nothing starts by itself yet. Tell Thursday what should — "every weekday at nine, go through my mail" — or make one here.',
    notRunYet: "Not run yet",
    offBefore: "Off",
    botOff: (bot) => `${bot} is switched off`,
    botGone: (bot) => `${bot} is gone — pick another bot`,
    runningNow: "Running now",
    lastWaits: (said) => `The last run waits on you${said ? `: ${said}` : ""}`,
    nextPrefix: "next",
    offWord: "off",
    onOrOff: (label) => `${label} on or off`,
    openRoutine: (label) => `Open ${label}`,
    deleteTitle: (label) => `Delete "${label}"?`,
    deleteBody: "It starts no more. The jobs it already opened stay.",
    deleteOk: "Delete",
    newTitle: "New routine",
    moreActions: "More",
    deleteAction: "Delete",
    closeRoutine: "Close the routine",
    nameField: "Name",
    namePlaceholder: "e.g. Morning mail",
    nameHint:
      "What it is called in this list, and what she calls it on a call.",
    botField: "Bot",
    botHint: "Who does the job each time it starts.",
    pickBot: "Pick a bot",
    whenField: "When",
    howStarts: "How it starts",
    kindOnce: "Once",
    kindDaily: "On set days",
    kindEvery: "Every few hours",
    onWord: "On",
    atWord: "At",
    orWord: "or",
    inAnHour: "In an hour",
    everyWord: "Every",
    hoursWord: "hours",
    dayNames: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    dayWords: [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ],
    daySets: [
      { label: "Every day", days: [1, 2, 3, 4, 5, 6, 7] },
      { label: "Weekdays", days: [1, 2, 3, 4, 5] },
      { label: "Weekends", days: [6, 7] },
    ],
    monthNames: [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ],
    jobField: "Job",
    jobPlaceholder:
      "e.g. Go through the mail that came since the last run and draft replies to what needs one. Send nothing.",
    jobHint:
      "Handed to the bot as a new thread each time, with a line on how the last run ended. Nobody is there to ask, so say everything it needs.",
    runsWord: "Runs",
    notRunYetLine: "Not run yet.",
    stopped: "Stopped",
    noWords: "No words",
    stillNeeds: (missing) => `Still needs ${missing}.`,
    missingName: "a name",
    missingBot: "a bot",
    missingTime: "a time",
    missingTimeAhead: "a time still ahead",
    missingJob: "a job",
    missingNothing: "nothing",
    missingAnd: "and",
    save: "Save",
    lastRunOpen: "Its last run is still open",
    runNow: "Run now",
    create: "Create",
    today: "Today",
    tomorrow: "Tomorrow",
    anotherDay: "Another day",
    timeOfDay: "Time of day",
    timePassed: "That time has passed. Pick a later one.",
    pickTimeAndDay: "Pick a time and at least one day.",
    pickTime: "Pick a time.",
    switchesOff: "then it switches itself off",
    firstStart: "first start",
    nextRun: (when) => `next ${when}`,
    scheduleOnce: (date) => `Once · ${date}`,
    scheduleEveryHour: "Every hour",
    scheduleEveryHours: (hours) => `Every ${hours} hours`,
    scheduleDaily: (time) => `Daily ${time}`,
    scheduleDailyDays: (time, names) => `Daily ${time} · ${names}`,
    scheduleDayTime: (day, time) => `${day} ${time}`,
    nowWord: "now",
    yesterdayWord: "Yesterday",
  },
  files: {
    finishedWord: "finished",
    countEmpty: "empty",
    resultOne: "result",
    resultMany: "results",
    countResults: (shown, total) => `${shown} of ${total} results`,
    countFiles: (files) => ` · ${files} files`,
    revealFolder: "Reveal folder",
    filter: "Filter files",
    everyone: "Everyone",
    unsorted: "Unsorted",
    showMore: (more, total) => `Show ${more} more of ${total}`,
    deletedOk: "Deleted",
    deleteTitle: (name) => `Delete ${name}?`,
    deleteFileBody: "It is deleted from disk for good.",
    deleteFolderBody:
      "The folder and everything in it are deleted from disk for good.",
    deleteOk: "Delete",
    shelfWord: "Shelf",
    fileWord: "file",
    filesWord: "files",
    openNewTab: "Open in a new tab",
    revealManager: "Reveal in the file manager",
    deleteAria: "Delete",
    setEmpty: "Nothing in here the app can open.",
    setRest: (shown, total) =>
      `${shown} of ${total} — the rest are in the folder`,
    nothingEmpty:
      "Nothing finished yet. When a bot ends a job with something to hand over — a page, a report, a set of pictures — it lands here.",
    nothingPick:
      "Pick something on the left. Each bot's work is under its face; a folder it filled is one row, and opens as a sheet.",
  },
  workspace: {
    scratchDone: "Scratch emptied",
    emptyScratchTitle: "Empty scratch?",
    emptyScratchBody: (scratch, artifacts, projects) =>
      `Everything under ${scratch}/ is deleted for good. ${artifacts}/ and ${projects}/ are untouched.`,
    emptyScratchOk: "Empty",
    revealFolder: "Reveal folder",
    emptyScratchBtn: "Empty scratch",
    filter: "Filter this folder",
    nothingMatches: "Nothing matches",
    emptyFolder: "Empty folder",
    foldersWord: "folders",
    filesWord: "files",
    showMore: (more, total) => `Show ${more} more of ${total}`,
    folderOne: "folder",
    folderMany: "folders",
    fileOne: "file",
    fileMany: "files",
    countEmpty: "empty",
    countOf: (total) => ` of ${total}`,
    nothingEmptyHead:
      "Nothing here yet. What a bot writes during a call lands in",
    nothingEmptyTail:
      "— a page, a table, a picture — and shows up here to open.",
    pickFile: "Pick a file on the left.",
    nothingListed:
      "Only what the app can open is listed — a page, a table, a picture, a note. Installed packages and tool leftovers are left out, and no folder is measured, so a folder opens as fast as it lists. Reveal folder, at the foot, opens everything else.",
    fileDeletedOk: "File deleted",
    deleteTitle: (name) => `Delete ${name}?`,
    deleteBody: "It is deleted from disk for good.",
    deleteOk: "Delete",
    openNewTab: "Open in a new tab",
    revealManager: "Reveal in the file manager",
    deleteAria: "Delete",
  },
  skills: {
    countLine: (on, off) => `${on} on · ${off} off`,
    filter: "Filter skills",
    customGroup: "Custom",
    customHint: "yours — added here · a Default skill of the same name wins",
    addSkill: "Add skill",
    botOwn: (bot) => `${bot}'s own`,
    botOwnHint: (bot) =>
      `only ${bot} reads these · what it found or wrote can be edited or deleted`,
    defaultGroup: "Default",
    defaultHint: "ships with the app · switch off, can't edit or delete",
    crowded: (count) =>
      `${count} skills are on for every bot. Each is a line in every prompt a bot reads, and one more to look past when it picks.`,
    railShipped: (count) => `${count} shipped`,
    railInstalled: (count) => `${count} installed`,
    deleteTitle: (name) => `Delete ${name}?`,
    deleteBody: "Every file in this skill is deleted for good.",
    deleteOk: "Delete",
    rowSwitch: (name) => `${name} on or off`,
    rowDelete: (name) => `Delete ${name}`,
    discardTitle: "Discard your changes?",
    discardBody: (file) => `What you wrote in ${file} is not saved.`,
    discardOk: "Discard",
    editBtn: "Edit",
    cancelBtn: "Cancel",
    saveBtn: "Save",
    savedOk: "Saved",
    fileContents: (name) => `${name} contents`,
    tooLong: "Too long to show here — a bot still reads it from disk.",
    notText: "Not a text file — a bot can still read it from disk.",
    newTitle: "New skill",
    newDesc: "Instructions a bot reads when a job calls for them.",
    cancelAction: "Cancel",
    createAction: "Create",
    uploadAction: "Upload",
    writeTab: "Write",
    uploadTab: "Upload",
    nameField: "Name",
    descField: "Description",
    descPlaceholder:
      "What it does, then when to use it — a bot reads this to decide",
    contentField: "Content",
    contentPlaceholder: "Markdown. The steps, the rules, the examples.",
    overLimit: (mb) => ` · over ${mb} MB`,
    dropHint: "Drop a file here, or click to choose",
    reqTitle: "File requirements",
    reqMdLine:
      "A .md file needs a YAML block with the skill's name and description.",
    reqZipLine:
      "A .zip or .skill archive needs a SKILL.md inside — the rest of its folder comes along.",
    reqMax: (mb) => `Up to ${mb} MB.`,
  },
  mcp: {
    railNone: "Nothing connected yet — a preset is the shortest way in",
    railLine: (connected, tools) => `${connected} connected · ${tools} tools`,
    railFailed: (failed) => ` · ${failed} failed`,
    connectedGroup: "Connected",
    addServer: "Add server",
    deletedOk: "Server deleted",
    deleteTitle: (name) => `Delete ${name}?`,
    deleteBody: "Its connection and saved authorization go with it.",
    deleteOk: "Delete",
    unreadable: "This server could not be read.",
    deleteBtn: "Delete",
    reconnectBtn: "Reconnect",
    filterTools: "Filter tools",
    toolOne: "tool",
    toolMany: "tools",
    noToolsYet: "No tools yet",
    noToolMatch: "No tool here goes by that.",
    schemaBtn: "Schema",
    testBtn: "Test",
    runBtn: "Run",
    badJson: "Not valid JSON",
    addTitle: "Add MCP server",
    addDesc: "Its tools become available to every bot.",
    cancelBtn: "Cancel",
    connectBtn: "Connect",
    nameField: "Name",
    jsonField: "JSON",
    transportField: "Transport",
    urlField: "URL",
    headersField: "Headers",
    commandField: "Command",
    argsField: "Args",
    envField: "Env",
    removeRow: "Remove this row",
    addRowBtn: "Add",
    needUrl: "Needs a valid url",
    needCommand: "Needs a command",
    needUrlOrCommand: "Needs a url or a command",
    noServerIn: "No server in there",
    authTitle: (name) => `${name} needs authorization`,
    authDesc: "Approve access in the window that just opened",
    connectFail: (name) => `${name} could not connect`,
    connectedOk: (name) => `${name} connected`,
    toolsAvailable: (count) =>
      `${count} ${count === 1 ? "tool" : "tools"} available`,
    presetsGroup: "Presets",
    filterPresets: "Filter presets",
    resultCount: (shown, total) => `${shown} of ${total}`,
  },
  signins: {
    railNote:
      "A site's session as the browser held it — never a password. Kept on this machine, outside the folder the bots work in. It is the whole session: signed in with Google, it carries the Google sign-in too.",
    empty:
      "Nothing is kept yet. When a bot needs you signed in somewhere, it opens a window for you to sign in — and that sign-in is kept here for its later work.",
    steps: [
      {
        title: "A bot opens a window",
        text: "When its work needs you signed in to a site, it opens that site on your screen and asks.",
      },
      {
        title: "You sign in there",
        text: "The app keeps that sign-in here — the site's session, never your password. A second account on a site is kept beside the first.",
      },
      {
        title: "Only that bot uses it",
        text: "Later work is signed in without asking. Another bot has to ask you first.",
      },
    ],
    accountsWord: "accounts",
    usedWord: "used",
    keptWord: "kept",
    signOutTitleOne: (site) => `Sign out of ${site}?`,
    signOutTitleAccount: (account, site) =>
      `Sign out of ${account} on ${site}?`,
    signOutBody: (others, site) =>
      `What is kept here is removed, and the bots that used it ask you to sign in again.${others ? ` Your other ${site} ${others === 1 ? "account stays" : "accounts stay"}.` : ""} The site itself may still list the session until it ends it.`,
    signOutOk: "Sign out",
    signOutBtn: "Sign out",
    signOutAria: (account) => `Sign out of ${account}`,
    revokeAria: (name) => `${name} may no longer use it`,
    noBot: "No bot may use it. One that needs it will ask.",
    asksSuffix: "asks",
    allowBtn: "Allow",
    ownChromeTitle: "Your own Chrome",
    ownChromeDesc:
      "For a site that will not stay signed in. A bot gets a tab of its own, signed in as you — to every site your Chrome is, not only that one.",
    getExtension: "Get the extension",
  },
  ai: {
    pickModel: "Pick a model",
    notPicked: "Not picked",
    appDefault: "App default",
    noKeyYet: (label) => `${label} has no key yet.`,
    lostSignin: (label) => `The ${label} sign-in saved before`,
    lostKey: (label) => `The ${label} key saved before`,
    signInAgain: "Sign in again.",
    pasteAgain: "Paste it again.",
    everyCarries: (label) =>
      `Every model ${label} carries, with what each costs.`,
    catalogNoRead: "Could not read the catalog — type an id",
    typeModelId: "or type a model id",
    modelAria: "Model",
    searchModels: "Search models",
    searchPlaceholder: "name, id or provider",
    sortAria: "Sort",
    sortCheap: "Cheapest first",
    sortDear: "Dearest first",
    sortName: "By name",
    per1M: "per 1M in / out",
    takeAsId: (query) => `Use “${query}” as the id`,
    noMatch: (query) => `Nothing matches “${query}”.`,
    clearSearch: "Clear search",
    nothingPicked: "Nothing picked — the field keeps what it has",
    cancelBtn: "Cancel",
    useModel: "Use this model",
    freeWord: "free",
    retiringWord: "retiring",
    kindText: "Text",
    kindTitles: {
      image: "Image",
      video: "Video",
      speech: "Speech",
      transcription: "Transcription",
    },
    matchCount: (count, query) => `${count} matching “${query}”`,
    shelfCountKind: (count, label) => `${count} on ${label}`,
    shelfCountTools: (count, total, label) =>
      `${count} of ${total} on ${label} can call tools`,
    emptyShelf: "Nothing on the shelf — search for an id.",
    pickModelFirst: "Pick a model first",
    autoWord: "auto",
    modelDefaultTitle: "The model's own default",
    effortAria: "Thinking effort",
    effortStep: (step) => `Thinking effort ${step}`,
    ladderUnknown: "This model's steps are unknown",
    ladderNone: "This model has no effort to set",
    ladderSteps: (count) => `${count} steps, plus Auto`,
    blockedTitle: "The sign-in window was blocked",
    blockedDesc: "Allow pop-ups for this page, then try again",
    signinBtn: "Sign in with ChatGPT",
    runsOnPlan: "Runs on your plan once you sign in",
    saveKeyBtn: "Save key",
    pasteKeyFallback: "Paste the key",
    voiceAria: "Voice",
    clickHear: "click a name to hear it",
    anotherVoiceId: "another voice id",
    anotherVoiceAria: "Another voice id",
    saveAction: "Save",
    closeAria: "Close",
    clipUnreadable: "The clip could not be read.",
    sampleFailTitle: "Voice sample did not play",
    mismatchNot: (label) => `Not ${label}?`,
    saveBtn: "Save",
    replaceIt: "Replace it",
    keyAria: "OpenAI API key",
    voiceKeyTitle: "Voice key",
    notNow: "Not now",
    keyNotSaved: "That key was not saved.",
    lostKeyAgain: "Paste it again.",
    liveShareNote: "Live voice and reasoning share this OpenAI API key.",
    liveSeparateNote:
      "Live uses an OpenAI API key, billed separately from ChatGPT. Stored on this machine, in this app's database.",
    callLinesEnough: "Either one is enough.",
    signInLost: "The sign-in saved before can't be unlocked any more.",
    noCallsPlan: "Bots and writing run on this plan; spoken calls don't.",
    runsOnPlanLine: "Calls and bots run on your plan.",
    runsOnKeyLine: "Bots run on your plan; calls run on the key.",
    planDefault: "Your ChatGPT plan. No key, no bill by the minute.",
    signInAgainBtn: "Sign in again",
    signInBtn: "Sign in",
    keyTitle: "OpenAI API key",
    keyPerMinute: "Billed by the minute of call, apart from ChatGPT.",
    keyRunsOnPlan: "Calls run on your plan; switch in Settings › Thursday.",
    keyRunsNow: "Calls run on it now, billed by the minute.",
    signedInWord: "Signed in",
    savedWord: "Saved",
    pasteKeyBtn: "Paste a key",
    getKeyShort: "Get a key",
  },
  reach: {
    note: "Only the one person you allow can write: direct messages in a chat app, and by email only mail from the address you name. Nobody else is ever written back to. Work started here runs whether or not a tab is open, while Thursday is running on this computer.",
    stoppedToken: "Stopped — the saved token can't be unlocked any more",
    tokensIn: (have, total) => `${have} of ${total} tokens in`,
    notSet: "Not set",
    stoppedTurned: (label) => `Stopped — ${label} turned the token away`,
    reconnecting: (problem) => `Reconnecting ${problem}`,
    connecting: (problem) => `Connecting ${problem}`,
    listeningAs: (bot, name) => `Listening as ${bot ?? ""}. ${name} is let in.`,
    connectingDots: "Connecting…",
    waitingFirst: (bot) =>
      `Listening as ${bot ?? ""} — waiting for your first message`,
    mailStoppedPassword:
      "Stopped — the saved app password can't be unlocked any more",
    mailStoppedService:
      "Stopped — the mail service turned her mailbox's sign-in away",
    mailHeld: (bot, holding) =>
      `Listening as ${bot ?? ""} — a mail is held: ${holding}`,
    mailCanWrite: (bot, name) =>
      `Listening as ${bot ?? ""}. ${name} can write.`,
    mailNameAddress: (bot) =>
      `Listening as ${bot ?? ""} — name your own address`,
    waitingFirstMsg: "Waiting for your first message…",
    cameraAria: (shown) => `A picture of ${shown} for a phone camera`,
    changeToken: "Change the token",
    tokenAria: "Token",
    replaceBtn: "Replace",
    saveBtn: "Save",
    cancelBtn: "Cancel",
    removeBtn: "Remove",
    removeTokenTitle: "Remove this token?",
    removeTokenBody: "That service stops, and whoever is let in is let go.",
    removeTokenOk: "Remove",
    copiedBtn: "Copied",
    copyManifest: "Copy the manifest",
    letInLine: (who) => `${who} is let in.`,
    canWriteLine: (who) => `${who} can write from a phone.`,
    letGoTitle: (who) => `Let ${who} go?`,
    letGoBody:
      "Nobody can write to Thursday through this service until someone is let in again.",
    letGoOk: "Let them go",
    letGoBtn: "Let them go",
    lostTokenAgain: "The token saved here",
    mailboxAppPassword: "Her mailbox's app password",
    removeMailboxTitle: "Remove her mailbox?",
    removeMailboxBody:
      "Email stops, and the address that could write is let go. The mailbox itself is not touched.",
    removeMailboxOk: "Remove",
    changeBtn: "Change",
    addressField: "Address",
    appPasswordField: "App password",
    appPasswordPlaceholder: "paste it here",
    domainFallback: "Its domain",
    noServersNote: (domain) =>
      `${domain} doesn't say where its mail servers are. Its help pages name them — one for reading mail (IMAP) and one for sending it (SMTP).`,
    readingServer: "Reading server",
    sendingServer: "Sending server",
    portField: "Port",
    replaceAction: "Replace",
    saveAction: "Save",
    stopMailTitle: (who) => `Stop reading mail from ${who}?`,
    stopMailBody:
      "Nobody can write to Thursday by email until an address is named again.",
    stopMailOk: "Stop",
    ownAddressAria: "Your own address",
    writeTo: (address) => `Write to ${address}`,
    copyHerAddress: "Copy her address",
    mailtoFallback: "Paste it again.",
    steps: {
      telegram: [
        {
          body: [
            "In Telegram, write to ",
            { bold: "@BotFather" },
            ", send ",
            { bold: "/newbot" },
            " and pick a name. It answers with a ",
            { bold: "token" },
            ".",
          ],
          slot: { open: "https://t.me/BotFather", label: "Open @BotFather" },
        },
        {
          body: ["Paste the token here."],
          slot: { key: "TELEGRAM_BOT_TOKEN", looks: "123456789:AAE…" },
        },
        {
          body: ["From your phone, write anything to your bot."],
          slot: { says: "Point your phone's camera at it to open the chat." },
        },
        {
          body: [
            "A question with a code appears on this computer. Press ",
            { bold: "Allow" },
            " if your phone shows the same code.",
          ],
        },
      ],
      discord: [
        {
          body: [
            "At ",
            { bold: "discord.com/developers" },
            ", make a ",
            { bold: "New Application" },
            ". So nobody else can add it to a server, set ",
            { bold: "Install Link" },
            " to ",
            { bold: "None" },
            " on its ",
            { bold: "Installation" },
            " page and turn off ",
            { bold: "Public Bot" },
            " on its ",
            { bold: "Bot" },
            " page. There, press ",
            { bold: "Reset Token" },
            " and copy it.",
          ],
          slot: {
            open: "https://discord.com/developers/applications",
            label: "Open discord.com/developers",
          },
        },
        {
          body: ["Paste the token here."],
          slot: { key: "DISCORD_BOT_TOKEN", looks: "MTE…" },
        },
        {
          body: [
            { bold: "Add the bot to a server of your own" },
            " — Discord only delivers a message to a bot you share a server with. A private server made for this is fine.",
          ],
          slot: {
            says: "Point your phone's camera at it, or open it here. It asks which server, and adds the bot with no permissions in it.",
            does: "Add the bot to a server",
          },
        },
        {
          body: [
            { bold: "Send the bot a direct message" },
            ", not in the server: on a phone, tap the bot in the server's member list, then ",
            { bold: "Message" },
            ". A question with a code appears here: press ",
            { bold: "Allow" },
            " if your phone shows the same code.",
          ],
        },
      ],
      slack: [
        {
          body: [
            "At ",
            {
              link: {
                href: "https://api.slack.com/apps",
                label: "api.slack.com/apps",
              },
            },
            ", ",
            { bold: "Create New App › From a manifest" },
            ", and paste the manifest.",
          ],
          slot: { manifest: true },
        },
        {
          body: [
            { bold: "Basic Information › App-Level Tokens" },
            ": generate one with ",
            { bold: "connections:write" },
            ". It starts with xapp-.",
          ],
          slot: { key: "SLACK_APP_TOKEN", looks: "xapp-…" },
        },
        {
          body: [
            { bold: "Install App" },
            " to your workspace. The Bot User OAuth Token starts with xoxb-.",
          ],
          slot: { key: "SLACK_BOT_TOKEN", looks: "xoxb-…" },
        },
        {
          body: [
            "In Slack, open the app under ",
            { bold: "Apps" },
            " and write in its ",
            { bold: "Messages" },
            " tab. A question with a code appears here: press ",
            { bold: "Allow" },
            " if Slack shows the same code.",
          ],
        },
      ],
      email: [
        {
          body: [
            "Make a ",
            { bold: "mailbox of her own" },
            " — a new account at a mail service that gives app passwords (Outlook no longer does). Turn on ",
            { bold: "two-step sign-in" },
            " there and create an ",
            { bold: "app password" },
            " for Thursday: how on ",
            {
              link: {
                href: "https://support.google.com/accounts/answer/185833",
                label: "Gmail",
              },
            },
            ", ",
            {
              link: {
                href: "https://support.apple.com/en-us/102654",
                label: "iCloud",
              },
            },
            ", ",
            {
              link: {
                href: "https://www.fastmail.help/hc/en-us/articles/360058752854-App-passwords",
                label: "Fastmail",
              },
            },
            ". Your own inbox stays out of it.",
          ],
        },
        {
          body: ["Her address and the app password."],
          slot: { mailbox: true },
        },
        {
          body: [
            "Your own address. Only mail from it reaches her, and only once its mail service vouches it was sent from there.",
          ],
          slot: { person: true },
        },
        {
          body: [
            "From your address, write anything to hers. She answers in the same thread.",
          ],
          slot: { write: true },
        },
      ],
    },
  },
  bot: {
    botsMost: (count, max) => `${count} bots · ${max} is the most`,
    newBot: "New bot",
    crowded: (count, app) =>
      `${count} bots are on. Each is a line in every prompt, and one more for ${app} to choose between.`,
    emptyPitch: (app) =>
      `${app} talks; bots do the rest — search the web, draft a reply, check a schedule. Give one a job and a model, and work gets handed over mid-call while the conversation keeps going.`,
    readyMade: "Ready-made",
    addDialogTitle: "Bots you can add",
    addDialogDesc:
      "Each one is a starting point — re-prompt it, give it a model of its own. What a bot needs before it can work stands on its row.",
    addDialogTail:
      "What a bot needs before it can work stands on its row; until then it runs on the app default model.",
    alreadyAdded: "already added",
    cancel: "Cancel",
    addOne: (name) => `Add ${name}`,
    addMany: (count) => `Add ${count} bots`,
    readyMadeAria: (count) => `Ready-made bots, ${count} on offer`,
    roomFits: (room) => `${room} more ${room === 1 ? "fits" : "fit"}`,
    noteFullTick: "untick one to pick another",
    noteFullUnticked: (wanted, fit) => `${wanted} ticked · ${fit}`,
    noteNone: "nothing ticked",
    noteSome: (wanted, total) => `${wanted} of ${total} ticked`,
    needsMedia: (needs) => `needs ${needs}`,
    needsAnd: "and",
    mediaWords: {
      image: "an image model",
      video: "a video model",
      speech: "a speech model",
      transcription: "a transcription model",
    },
    createdOk: "Bot created",
    deletedOk: "Bot deleted",
    deleteTitle: (name) => `Delete ${name}?`,
    deleteBody: (app) =>
      `${app} can no longer hand work to it, and what it kept for itself goes with it: its memory and the skills it installed. What it finished stays in Settings › Files, under its name.`,
    deleteOk: "Delete",
    clearLineTitle: (name) => `Clear ${name}'s line?`,
    clearLineBody: (app) =>
      `${app} and the other bots read your description alone again.`,
    clearOk: "Clear",
    newBotTitle: "New bot",
    offWord: "off",
    onOrOffBot: (name) => `${name} on or off`,
    handWorkTip: (app) => `${app} can hand it work`,
    deleteBotAria: "Delete this bot",
    nameRow: "Name",
    namePlaceholder: "e.g. researcher",
    nameHintMade: (app) =>
      `What ${app} calls it when she hands it work. Fixed once the bot is made.`,
    nameHintNew: (app, max) =>
      `What ${app} calls it when she hands it work. Up to ${max} characters, and it can’t be renamed later.`,
    descRow: "Description",
    descPlaceholder: "e.g. Searches the web and answers",
    descHint: (app) =>
      `The one line ${app} and the other bots read when they decide who gets a job.`,
    clearLineAria: "Clear its line",
    mayAddLine: (name) => `${name} may add its own line`,
    mayAddLineHint: "It may add its own line when its work changes for good",
    runsOnRow: "Runs on",
    runsOnHint:
      "What this bot thinks with. App default puts it back on the one in Settings › Models.",
    appDefaultHint: "App default model, and its effort with it.",
    effortRow: "Effort",
    effortHint:
      "How hard it thinks, on the steps this model takes. Auto leaves the step to the model.",
    compactRow: "Compacts at",
    compactFromDefault: "From the app default model",
    compactUnit: "k tokens",
    compactSummary: "A job summarizes itself here and carries on.",
    compactFromDefaultLong: (summarize: string) =>
      `Worked out from the app default model's context window at each run. ${summarize}`,
    compactHandDefault: (summarize: string) =>
      `Set by hand. Emptied, it is worked out from the app default model again. ${summarize}`,
    compactHandModel: (summarize: string) =>
      `Set by hand. Picking a model fills in its own again. ${summarize}`,
    compactPct: (pct: number, k: string, summarize: string) =>
      `${pct}% of this model's ${k}k context window. ${summarize}`,
    compactUnknown: (summarize: string) =>
      `This model's context window is unknown, so the default is filled in. ${summarize}`,
    toolsRow: "Tools",
    promptRow: "Prompt",
    promptPlaceholder:
      "How it should work (optional). e.g.\nSearch the web, answer with a short summary and links.",
    memoryWord: "Memory",
    fileOne: "1 file",
    fileMany: (count: number) => `${count} files`,
    showInManager: "Show in the file manager",
    folderWord: "Folder",
    nothingKept: "Nothing kept yet.",
    deleteFileTitle: (file) => `Delete ${file}?`,
    deleteFileBody: (bot) =>
      `It is deleted from disk for good, and ${bot}'s next job starts without it.`,
    deleteFileAria: (file) => `Delete ${file}`,
    fileDeletedOk: "File deleted",
    railOff: "off",
    tokensSome: (count) => `${count} tokens`,
    tokensNone: "no tokens yet",
    sinceWord: "since",
    needsMissing: (missing) => `Needs ${missing}`,
    keepMemory: "Bots keep their own memory",
    createBot: "Create bot",
    missingName: "a name",
    missingDesc: "a description",
    recentWord: "Recent",
    historyWord: "History",
    recentEmpty: "Nothing handed over yet.",
    jobWaiting: "waiting on you",
    jobWorking: "working",
    jobStopped: "stopped",
    jobDone: "done",
    pinHint:
      "Nothing to pin — connect an MCP server first (Settings › Connectors).",
    pickTools: "Pick tools",
    unpinTool: (name) => `Unpin ${name}`,
    loadedHint: "Loaded from the start — everything else stays searchable",
    searchTools: "Search tools",
    nothingMatches: "Nothing matches",
    rosterWaiting: "waiting on you",
    rosterWorking: (label) => `working · ${label}`,
    rosterOff: "off",
    rosterIdleNone: "idle · no jobs yet",
    rosterIdleLast: (ago) => `idle · last job ${ago}`,
    justNow: "just now",
    agoWord: (ago) => `${ago} ago`,
    seedHints: {
      Jarvis: "Takes whatever nobody else is for",
      Analyst: "Finds out, cites, and lays it out",
      Curator: "Brings what is worth their time",
      Concierge: "Takes errands to the last step",
      Designer: "Draws the options to pick from",
      Tutor: "Explains anything, a picture at a time",
      Writer: "Drafts it in their voice, ready to send",
    },
  },
  config: {
    groups: {
      voice: {
        title: "voice",
        hint: "calls run on this key, or on a paid GPT Subscription sign-in",
        note: "calls need this or the GPT Subscription",
      },
      easy: {
        title: "the easy ways",
        hint: "one sign-in or one key opens every bot",
      },
      text: {
        title: "or a provider's own key",
        hint: "what bots think with — add any, or none",
      },
      search: {
        title: "search",
        hint: "how calls and bots look things up — one key, or their own model's",
      },
      phone: { title: "phone", hint: "tokens" },
      bots: {
        title: "Bots",
        hint: "what a bot runs on when it has not picked its own — start small: a small model is quick and costs little",
      },
      studio: {
        title: "Studio",
        hint: "what a bot draws, films and speaks with — off until you pick one; a paid GPT Subscription draws by itself",
      },
    },
    groupNoteFallback: "Required",
    readyWord: "ready",
    modelsFooter:
      "Her own voice and backend models are in Thursday. A bot can pick its own on its page.",
    keysFooterSet: (set, total) => `${set} of ${total} set`,
    keysFooterLost: (lost) => ` · ${lost} to enter again`,
    keysFooterNeedCall: " · a call needs the GPT Subscription or an OpenAI key",
    keysFooterStay: " · your keys stay on this machine",
    moreProviders: (count) => `${count} more providers`,
    moreWord: "More",
    searchHint:
      "Web search, if you want it: without a key, a bot searches only when its own model can.",
    ariaSet: "set",
    ariaSetEnv: "set in env",
    ariaLost: "enter it again",
    ariaUnset: "not set",
    keyRefused: "Key refused",
    creditsLeft: (amount) => `${amount} left`,
    signInAgain: "Sign in again",
    enterAgain: "Enter again",
    signedOut: "Signed out",
    notSet: "Not set",
    signedIn: "Signed in",
    setWord: "Set",
    setInEnv: "Set in env",
    signinRefused: "Sign-in refused",
    limitReached: "Limit reached",
    usedPercent: (pct) => `${pct}% used`,
    resetsIn: (when) => `resets in ${when}`,
    signedInWord: "signed in",
    signInWithAccount: "sign in with your account",
    planUsedAria: "Plan used",
    automaticWord: "Automatic",
    offWord: "off",
    autoWord: "auto",
    unsetPlanRuns: (label) => `Automatic · ${label}`,
    unsetNoOffer: "Not offered to bots until you pick one",
    effortWord: "effort",
    signOutOf: (label) => `Sign out of ${label}?`,
    signedOutOf: (label) => `Signed out of ${label}`,
    signInInstead: "Sign in with your ChatGPT account instead of a key",
    closeBtn: "Close",
    cancelBtn: "Cancel",
    signOutBtn: "Sign out",
    signOutConfirmBody: "Nothing runs on your plan until you sign in again.",
    planSpendNote:
      "Bots on this subscription spend your plan's usage, not a key. When it runs out, the job stops and says when it resets.",
    signInWindowNote:
      "The sign-in opens in its own window. Approve it there, and this turns to signed in by itself.",
    lostSigninAgain: "Sign in again.",
    saveKeyOk: (label) => `${label} key saved`,
    removeKeyOk: (label) => `${label} key removed`,
    removeKeyTitle: (label) => `Remove the ${label} key?`,
    removeKeyBody:
      "It is deleted from this computer, and nothing runs on it until a key is pasted again.",
    closeAction: "Close",
    removeAction: "Remove",
    cancelAction: "Cancel",
    replaceAction: "Replace",
    saveAction: "Save",
    newValuePlaceholder: "New value — replaces the current key",
    pasteAgainPlaceholder: "Paste the key again",
    pasteKeyFallback: "Paste the key",
    getKeyAt: (host) => `Get a key at ${host}`,
    lostKeyAgain: "Paste it again.",
    envSetNote: (label) =>
      `${label} is set in the environment the app started with — a .env or your shell — and that one is used over one saved here. Change or remove it there, then start the app again.`,
    mediaLabels: {
      image: { label: "Image model", hint: "What bots draw with" },
      video: {
        label: "Video model",
        hint: "What bots film with — minutes a clip",
      },
      speech: {
        label: "Speech model",
        hint: "What reads text aloud into a file",
      },
      transcription: {
        label: "Transcription model",
        hint: "What turns a recording into text",
      },
    },
    mediaMissing: (kind) => `a ${kind} model`,
    phoneFooter:
      "Nothing on this computer is opened to the internet: the app asks the chat service, or her mailbox, what was written.",
    entryHints: {
      DEFAULT_MODEL: "What a bot thinks with until it picks its own",
      EXA_API_KEY: "web search in one call — dashboard.exa.ai",
      TELEGRAM_BOT_TOKEN:
        "a bot token from @BotFather — then write to your bot, and allow it here",
      DISCORD_BOT_TOKEN:
        "a bot token from discord.com/developers — add the bot to a server of yours, then write to it directly",
      SLACK_APP_TOKEN:
        "starts with xapp- — opens the connection. Slack takes this and the bot token",
      SLACK_BOT_TOKEN: "starts with xoxb- — speaks as the app",
      EMAIL_APP_PASSWORD:
        "the app password her mailbox's service made for Thursday — saved with her address in Settings › Phone",
      IMAGE_MODEL: "What bots draw with",
      VIDEO_MODEL: "What bots film with — minutes a clip",
      SPEECH_MODEL: "What reads text aloud into a file",
      TRANSCRIPTION_MODEL: "What turns a recording into text",
    },
    entryLabels: {
      DEFAULT_MODEL: "Default model",
      DEFAULT_EFFORT: "Default effort",
    },
  },
};
