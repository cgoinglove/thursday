"use client";

import { Maximize, Minus, Plus } from "lucide-react";
import {
  Fragment,
  memo,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { queryKey } from "@/app/api/query-key";
import { Markdown } from "@/components/ui/markdown";
import { ShinyText } from "@/components/ui/shiny-text";
import { BotMark, iconProps } from "@/features/bot/components/bot-mark";
import { markStill } from "@/features/bot/mark.geometry";
import {
  backOf,
  clockOf,
  filesOf,
  type OfficeScene,
  type Plate,
  plateOf,
  reportAt,
  type SeatKey,
  type SeatState,
  type Sign,
  seatAt,
  signOf,
  wordsOf,
} from "@/features/bot/office";
import {
  CAMERA,
  type Camera,
  type Moment,
  type Mug,
  momentOf,
  motionOf,
  type Paper,
  type Piece,
  restAt,
  type Screen,
  type Sheet,
  SIGN_BOX,
  type Stage,
  type Stroke,
  stageOf,
  tricksOf,
  tripsOf,
  type Walker,
} from "@/features/bot/office.scene";
import {
  type BotRef,
  officePointed,
  useOfficeCaption,
  useOfficePointed,
} from "@/features/bot/thread.store";
import { fileIcon } from "@/features/workspace/components/file-thumb";
import { FileLink } from "@/features/workspace/components/file-view";
import type { FileOnDisk } from "@/features/workspace/workspace.schema";
import { useServerRoute } from "@/lib/protocol/use-server-route";
import { cn } from "@/lib/utils";

/**
 * The zooms the buttons step through, as a browser's do: from far enough out to see the ground
 * well around the building to near enough to read a desk. The wheel goes between them.
 */
const ZOOMS = [
  0.3, 0.4, 0.5, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
];
/** The zoom the office opens at, and comes back to, of the fit to its box. */
const ZOOM_START = 0.7;

/** How long the zoom buttons and the frame button take to get where they go (ms). */
const GLIDE_MS = 300;

type View = { z: number; x: number; y: number };

const zoomAt = (view: View, fx: number, fy: number, next: number): View => {
  const z = Math.min(ZOOMS[ZOOMS.length - 1], Math.max(ZOOMS[0], next));
  return {
    z,
    x: fx - (z / view.z) * (fx - view.x),
    y: fy - (z / view.z) * (fy - view.y),
  };
};

/** The next of the buttons' zooms from `z`, in or out. */
const stepFrom = (z: number, zoomIn: boolean) =>
  zoomIn
    ? (ZOOMS.find((step) => step > z + 0.001) ?? z)
    : (ZOOMS.findLast((step) => step < z - 0.001) ?? z);

/** The view the office opens at: `ZOOM_START` about the middle of its box. */
const startOf = (size: { w: number; h: number }): View =>
  zoomAt({ z: 1, x: 0, y: 0 }, size.w / 2, size.h / 2, ZOOM_START);

/** The box the office is fitted into, measured, so it redraws when the window changes. */
function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const read = () => {
      const w = Math.round(node.clientWidth);
      const h = Math.round(node.clientHeight);
      setSize((was) => (was && was.w === w && was.h === h ? was : { w, h }));
    };
    read();
    const watch = new ResizeObserver(read);
    watch.observe(node);
    return () => watch.disconnect();
  }, [ref]);
  return size;
}

/**
 * The scene's clock, in seconds since the handover. It runs frame by frame only while the
 * drawing moves (`spans`, office.scene motionOf) and otherwise rests until the next movement is
 * due, so an office nobody walks in costs nothing between; a changed scene reads it again at
 * once. It holds its first reading while the office builds itself (`spans` null).
 */
function useSceneClock(start: number, spans: [number, number][] | null) {
  const [t, setT] = useState(() => (Date.now() - start) / 1000);
  useEffect(() => {
    if (!spans) return;
    let frame = 0;
    let timer: number | undefined;
    const tick = () => {
      const now = (Date.now() - start) / 1000;
      setT(now);
      const rest = restAt(spans, now);
      if (rest === 0) frame = requestAnimationFrame(tick);
      else if (Number.isFinite(rest))
        timer = window.setTimeout(tick, rest * 1000);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [start, spans]);
  return t;
}

const ink = (percent: number) =>
  `color-mix(in oklab, var(--ink) ${percent}%, transparent)`;

/**
 * The office: a sketch of the thread's rooms, its bots at their desks and on the move, pan and
 * zoom like a canvas. It builds itself as it opens, and its bots leap now and then (office.scene
 * tricksOf). A plate stands over a bot only with something to say — at work, wanting the user,
 * its report ready — and pressing a bot opens its words over it (Reads) and its tab in the room;
 * nothing opens by itself. The job's name heads it at the top
 * left with how it stands, how the job stands is written on the ground beside the building too,
 * and the scoreboard behind the building keeps its time and its crew.
 */
export function OfficeStage({
  scene,
  start,
  label,
  faces,
  from,
  onBot,
  onAnswer,
  camera = CAMERA,
  desk,
  className,
}: {
  scene: OfficeScene;
  /**
   * The thread's bot alone at its desk, as its page shows it (office-view BotDesk): no building
   * around it (office.scene stageOf `alone`), and a view that stays put, with no pan, zoom or
   * buttons for them, nor the job's head, scoreboard and sign.
   */
  desk?: boolean;
  /** Where it is seen from (office.scene Camera); a film holds its own. */
  camera?: Camera;
  /** Takes the user to what wants them in the room: the question, or Continue (bot-room). */
  onAnswer?: () => void;
  /** When the job was handed over (ms): the scene's clock counts from here. */
  start: number;
  label: string;
  /** Each bot's face, by name. */
  faces: BotRef[];
  /** The thread it draws, where a note about one of its files goes (file-note). */
  from: string;
  /** A bot pressed: the room opens its tab, where what it did reads in full (bot-room). */
  onBot?: (bot: string) => void;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const size = useSize(box);
  // A machine asked to hold still gets the work walked and no leaps of the bots' own
  const [calm] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const stage = useMemo(
    () =>
      size && size.w > 0 && size.h > 0
        ? stageOf(scene, size, camera, desk)
        : null,
    [scene, size, camera, desk],
  );
  const trips = useMemo(
    () => (stage ? tripsOf(scene, stage.plan) : []),
    [scene, stage],
  );
  // The build runs once, from the first drawing; when it is over the office stands (scene
  // seconds) and the clock may move
  const [stood, setStood] = useState<number | null>(null);
  const built = stood !== null;
  const builds = stage?.built ?? null;
  useEffect(() => {
    if (builds === null || built) return;
    const done = window.setTimeout(
      () => setStood((Date.now() - start) / 1000),
      builds,
    );
    return () => window.clearTimeout(done);
  }, [builds === null, built, start]);
  const tricks = useMemo(
    () => (calm ? [] : tricksOf(scene, trips, stood)),
    [calm, scene, trips, stood],
  );
  const spans = useMemo(
    () => (stage ? motionOf(scene, stage, trips, tricks) : null),
    [scene, stage, trips, tricks],
  );
  const t = useSceneClock(start, built ? spans : null);
  const moment = stage ? momentOf(scene, stage, trips, tricks, t) : null;
  const sign = signOf(scene);
  // What the job handed over, only what is on disk: the plates and the report name it
  const files = useMemo(() => filesOf(scene), [scene]);
  const { data: found } = useServerRoute<FileOnDisk[]>(
    files.length ? queryKey.workspaceFiles(files) : null,
  );
  const onDisk = useCallback(
    (path: string) => found?.some((one) => one.path === path) ?? false,
    [found],
  );
  // Null until panned or zoomed: the view it opens at, kept about the middle as the box changes
  const [panned, setView] = useState<View | null>(null);
  // A desk alone is fitted to its box as it is laid out (office.scene deskFitOf)
  const opening = desk
    ? { z: 1, x: 0, y: 0 }
    : size
      ? startOf(size)
      : { z: ZOOM_START, x: 0, y: 0 };
  const view = panned ?? opening;
  const openingRef = useRef(opening);
  openingRef.current = opening;
  // A glide under way (the zoom buttons, the frame button) and where it goes: a second press
  // steps on from there, and a wheel or a drag stops it and takes the view as it stands
  const glide = useRef(0);
  const gliding = useRef<View | null>(null);
  const stopGlide = () => {
    cancelAnimationFrame(glide.current);
    gliding.current = null;
  };
  const drag = useRef<{
    x: number;
    y: number;
    from: View;
    moved: boolean;
    /** Down on a plate or its bot, where a tap is theirs. */
    onPlate: boolean;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  // Whose words stand open over it (office wordsOf): a bot pressed, until it is pressed again or
  // the floor is tapped. Nothing opens by itself: once the report stands, the thread's bot wears
  // its plate unfolded (report ready) and its words open when it is pressed. A new report closes
  // whatever stood open
  const report = reportAt(scene, t)?.id ?? null;
  const [opened, setOpened] = useState<{
    bot: string | null;
    report: string | null;
  }>({ bot: null, report });
  const reading = opened.report === report ? opened.bot : null;
  const pick = (bot: string) => {
    setOpened({ bot: reading === bot ? null : bot, report });
    onBot?.(bot);
  };

  // The wheel zooms where the pointer is, as a canvas does; not passive, so the page stays put.
  // A held desk lets the wheel scroll the page it sits on
  useEffect(() => {
    const node = box.current;
    if (!node || desk) return;
    const onWheel = (event: WheelEvent) => {
      // Words opened over a bot scroll as a page does
      if ((event.target as HTMLElement).closest("[data-reads]")) return;
      event.preventDefault();
      cancelAnimationFrame(glide.current);
      gliding.current = null;
      const rect = node.getBoundingClientRect();
      const fx = event.clientX - rect.left;
      const fy = event.clientY - rect.top;
      setView((was) => {
        const from = was ?? openingRef.current;
        return zoomAt(
          from,
          fx,
          fy,
          from.z * Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0022)),
        );
      });
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [desk]);

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || target.closest("button, a, [data-reads]")) return;
    // A held desk does not move; a tap on its floor still puts the open words away (up)
    if (desk) {
      drag.current = {
        x: event.clientX,
        y: event.clientY,
        from: view,
        moved: false,
        onPlate: !!target.closest("[data-plate]"),
      };
      return;
    }
    stopGlide();
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      from: view,
      moved: false,
      onPlate: !!target.closest("[data-plate]"),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const was = drag.current;
    if (!was || desk) return;
    const dx = event.clientX - was.x;
    const dy = event.clientY - was.y;
    if (!was.moved && Math.hypot(dx, dy) < 3) return;
    was.moved = true;
    setDragging(true);
    setView({ ...was.from, x: was.from.x + dx, y: was.from.y + dy });
  };
  const up = () => {
    const was = drag.current;
    drag.current = null;
    setDragging(false);
    // A tap on the floor, not a drag, puts the open words away
    if (was && !was.moved && !was.onPlate && reading)
      setOpened({ bot: null, report });
  };

  // The zoom buttons and the frame button glide there rather than jump; the wheel and a drag
  // move it as they go
  const glideTo = (target: View | null) => {
    cancelAnimationFrame(glide.current);
    const from = view;
    const to = target ?? openingRef.current;
    gliding.current = to;
    const began = performance.now();
    const step = () => {
      const p = Math.min(1, (performance.now() - began) / GLIDE_MS);
      const k = 1 - (1 - p) ** 3;
      setView(
        p >= 1
          ? target
          : {
              z: from.z + (to.z - from.z) * k,
              x: from.x + (to.x - from.x) * k,
              y: from.y + (to.y - from.y) * k,
            },
      );
      if (p < 1) glide.current = requestAnimationFrame(step);
      else gliding.current = null;
    };
    glide.current = requestAnimationFrame(step);
  };
  /** The zoom a button press steps from: where a glide under way goes, else where the view is. */
  const stepBase = () => gliding.current ?? view;
  useEffect(
    () => () => {
      cancelAnimationFrame(glide.current);
      // pointed at as it went: no pointerleave comes, so the next office would open lit
      officePointed.set(null);
    },
    [],
  );
  const world = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
  const at = (x: number, y: number) => ({
    x: view.x + view.z * x,
    y: view.y + view.z * y,
  });
  const faceOf = (bot: string) => faces.find((one) => one.name === bot);
  // A bot pointed at here or at its tab in the room: its plate unfolds
  const pointed = useOfficePointed();
  // A plate stands 20 px tall at the opening zoom and its full 26 from the fit up
  const plateScale = Math.min(1, Math.max(20 / 26, view.z / 0.9));
  // Each bot's plate, read once: the crowding pass and the plates themselves read the same
  const plates = (moment?.tags ?? []).map((tag) => ({
    tag,
    plate: plateOf(scene, tag.bot, t),
  }));
  // Where each plate sits while its bot is at its desk: plates are judged for room there, so
  // one walking past another does not fold and unfold it as it goes
  const homeOf = (bot: string) => {
    const seat =
      bot === scene.office.coord
        ? stage?.plan.own.seat
        : stage?.plan.byBot.get(bot)?.seat;
    if (!stage || !seat) return null;
    const [x, y] = stage.fit.at(seat[0], seat[1], 0);
    return at(x, y - stage.botSize - 6);
  };
  const { crowded, onRoom } = useCrowding(
    plates.flatMap(({ tag, plate }) => {
      // Judged where the bot stands, unless it is on its way: one walking past another does not
      // fold and unfold it as it goes
      const home = tag.walking
        ? homeOf(tag.bot)
        : at(tag.x, tag.foot - (stage?.botSize ?? 0) - 6);
      return home
        ? [
            {
              bot: tag.bot,
              home,
              open: plate !== null,
              first: plate?.tone === "you",
              words: plate?.words ?? "",
            },
          ]
        : [];
    }),
    plateScale,
  );

  return (
    <div
      ref={box}
      // what is dropped on the office is the thread's, as on the room (given-files roomDrop)
      data-room
      data-building={built ? undefined : ""}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      className={cn(
        "relative select-none overflow-hidden",
        // a held desk leaves touch to the page it sits on
        !desk && "touch-none",
        !desk && (dragging ? "cursor-grabbing" : "cursor-grab"),
        className,
      )}
    >
      {stage && moment && size && (
        <>
          {/* The ground's long lines, faded at the window's edges so none ends on a cut */}
          <div className="office-fade pointer-events-none absolute inset-0 [mask-composite:intersect] [mask-image:linear-gradient(to_right,transparent,#000_80px,#000_calc(100%-80px),transparent),linear-gradient(to_bottom,transparent,#000_60px,#000_calc(100%-60px),transparent)]">
            <div
              className="absolute top-0 left-0 origin-top-left"
              style={{ width: size.w, height: size.h, transform: world }}
            >
              <svg
                width={size.w}
                height={size.h}
                className="overflow-visible"
                aria-hidden
              >
                <Fades />
                <Alarm stage={stage} on={built && sign === "paused"} />
                {stage.guides.map((line) => (
                  <line
                    key={line.id}
                    x1={line.x1}
                    y1={line.y1}
                    x2={line.x2}
                    y2={line.y2}
                    style={{
                      stroke: line.color,
                      strokeWidth: line.width,
                      strokeLinecap: "round",
                    }}
                  />
                ))}
              </svg>
            </div>
          </div>
          <div
            className="absolute top-0 left-0 origin-top-left"
            style={{ width: size.w, height: size.h, transform: world }}
          >
            {!desk && (
              <Scoreboard
                stage={stage}
                scene={scene}
                sign={sign}
                start={start}
                label={label}
                faces={faces}
              />
            )}
            <svg
              width={size.w}
              height={size.h}
              className="overflow-visible"
              role="img"
              aria-label={`The office for ${label}`}
            >
              <Patterns />
              <Built stage={stage} />
              <Pools stage={stage} here={moment.here} />
              {moment.shades.map((shade) => (
                <polygon
                  key={shade.points}
                  className="office-drop"
                  points={shade.points}
                  fill="url(#office-hatch-shade)"
                  style={{ animationDelay: `${shade.delay}ms` }}
                />
              ))}
              {/* What lies on the floor and the board comes once they have landed */}
              <g
                className="office-fade"
                style={{ animationDelay: `${stage.popAt}ms` }}
              >
                <Links links={moment.links} />
                {moment.pins.map((paper) => (
                  <PaperShape key={paper.id} paper={paper} />
                ))}
              </g>
              {moment.tossed.map(
                (sheet) =>
                  sheet.landed && <SheetShape key={sheet.id} sheet={sheet} />,
              )}
              {moment.trail.map((step) => (
                <ellipse
                  key={step.id}
                  cx={step.x}
                  cy={step.y}
                  rx={3}
                  ry={1.5}
                  style={{ fill: "var(--ink)", opacity: step.opacity }}
                />
              ))}
              {moment.sprites.map((sprite) =>
                sprite.kind === "piece" ? (
                  <PieceShape
                    key={sprite.piece.id}
                    piece={sprite.piece}
                    draw={sprite.draw}
                    awake={
                      !sprite.piece.screen ||
                      moment.here.has(sprite.piece.screen.bot)
                    }
                  />
                ) : sprite.kind === "bot" ? (
                  <BotSprite
                    key={`bot-${sprite.walker.bot}`}
                    walker={sprite.walker}
                    face={faceOf(sprite.walker.bot)}
                    popAt={stage.popAt}
                  />
                ) : (
                  <PaperShape
                    key={sprite.paper.id}
                    paper={sprite.paper}
                    land={stage.popAt}
                  />
                ),
              )}
              {moment.tossed.map(
                (sheet) =>
                  !sheet.landed && <SheetShape key={sheet.id} sheet={sheet} />,
              )}
              {moment.flying.map((paper) => (
                <g
                  key={paper.id}
                  transform={`translate(${paper.x} ${paper.y}) rotate(${paper.turn}) scale(${paper.scale})`}
                >
                  <HeldPaper dark={paper.dark} ember={paper.ember} />
                </g>
              ))}
            </svg>
            {!desk && (
              <GroundSign
                stage={stage}
                sign={sign}
                land={built ? 0 : stage.popAt + 250}
              />
            )}
          </div>
          <div
            className="office-fade pointer-events-none absolute inset-0"
            style={{ animationDelay: `${stage.popAt}ms` }}
          >
            {moment.stamp && (
              <Refused
                spot={at(moment.stamp.x, moment.stamp.y)}
                scale={moment.stamp.scale}
                text={moment.stamp.text}
              />
            )}
            {plates.map(({ tag, plate }) => (
              <PlateAt
                key={tag.bot}
                plate={plate}
                state={seatAt(scene, tag.bot)}
                crowded={crowded.includes(tag.bot)}
                onRoom={onRoom}
                bot={tag.bot}
                head={at(tag.x, tag.head)}
                foot={at(tag.x, tag.foot).y}
                lift={tag.carrying ? 32 * view.z : 0}
                size={stage.botSize * view.z}
                width={size.w}
                hush={moment.hush}
                pointed={pointed === tag.bot}
                scale={plateScale}
                words={
                  reading === tag.bot ? wordsOf(scene, tag.bot, t) : undefined
                }
                onPick={() => pick(tag.bot)}
              />
            ))}
          </div>
          {!desk && (
            <OfficeHead
              label={label}
              bots={scene.office.bots.length}
              files={scene.office.status === "done" ? files.filter(onDisk) : []}
              from={from}
              scene={scene}
              sign={sign}
              onAnswer={onAnswer}
            />
          )}
          {!desk && (
            <div className="absolute bottom-3.5 left-4 flex items-center gap-0.5 rounded-full bg-background p-0.75 shadow-sm ring-1 ring-border">
              <ZoomButton
                label="Zoom out"
                onClick={() => {
                  const from = stepBase();
                  glideTo(
                    zoomAt(
                      from,
                      size.w / 2,
                      size.h / 2,
                      stepFrom(from.z, false),
                    ),
                  );
                }}
              >
                <Minus className="size-3.5" />
              </ZoomButton>
              <span className="min-w-11 text-center font-mono text-[11.5px] text-foreground/80 tabular-nums">
                {Math.round(view.z * 100)}%
              </span>
              <ZoomButton
                label="Zoom in"
                onClick={() => {
                  const from = stepBase();
                  glideTo(
                    zoomAt(
                      from,
                      size.w / 2,
                      size.h / 2,
                      stepFrom(from.z, true),
                    ),
                  );
                }}
              >
                <Plus className="size-3.5" />
              </ZoomButton>
              <span className="mx-0.5 h-4 w-px bg-border" />
              <ZoomButton label="Fit the office" onClick={() => glideTo(null)}>
                <Maximize className="size-3.5" />
              </ZoomButton>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-7.5 place-items-center rounded-full outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {children}
    </button>
  );
}

/** How many of the job's files the head shows before the rest fold under "+N more". */
const HEAD_FILES = 3;

/**
 * The office's head, at its top left: the job's name and, on its line, how the job stands; once
 * it is done, how many bots worked on it and the files it handed over, pressing one opening it.
 * Past the first few the rest fold under "+N more", opened in place. How long it has run is the
 * scoreboard's (Scoreboard). During a call her words stand above it (thursday), and it steps
 * down under them.
 */
function OfficeHead({
  label,
  bots,
  files,
  from,
  scene,
  sign,
  onAnswer,
}: {
  label: string;
  bots: number;
  files: string[];
  from: string;
  scene: OfficeScene;
  sign: Sign;
  onAnswer?: () => void;
}) {
  const captioned = useOfficeCaption();
  const [unfolded, setUnfolded] = useState(false);
  // Folding away a single file saves nothing
  const folds = files.length > HEAD_FILES + 1;
  const all = unfolded && folds;
  const shown = folds && !all ? files.slice(0, HEAD_FILES) : files;
  return (
    <div
      className={cn(
        "pointer-events-none absolute left-6 flex max-w-[min(34rem,calc(100%-3rem))] animate-in flex-col gap-3 fade-in transition-[top] duration-300",
        captioned ? "top-24" : "top-5",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="line-clamp-2 max-w-[28rem] text-balance font-semibold text-[22px] leading-tight tracking-tight">
          {label}
        </h2>
        <StateLine scene={scene} sign={sign} onAnswer={onAnswer} />
      </div>
      {files.length > 0 && (
        <div className="flex animate-in flex-col gap-2 fade-in slide-in-from-top-1 duration-300">
          <span className="font-mono text-[11.5px] text-muted-foreground tabular-nums">
            {bots} {bots === 1 ? "bot" : "bots"} · {files.length}{" "}
            {files.length === 1 ? "file" : "files"}
          </span>
          <div
            className={cn(
              "pointer-events-auto flex flex-wrap gap-1.5",
              all &&
                "max-h-60 overflow-y-auto rounded-2xl bg-background/80 p-1.5 ring-1 ring-border scrollbar-none",
            )}
          >
            {shown.map((path) => {
              const Icon = fileIcon(path);
              return (
                <FileLink
                  key={path}
                  path={path}
                  from={from}
                  className="flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-full bg-background pr-3 pl-2.5 text-[12.5px] shadow-sm outline-none ring-1 ring-border transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">
                    {path.split("/").pop()}
                  </span>
                </FileLink>
              );
            })}
            {folds && (
              <button
                type="button"
                onClick={() => setUnfolded((was) => !was)}
                aria-expanded={all}
                className="flex h-7 items-center rounded-full bg-foreground/7 px-3 text-[12.5px] outline-none transition-colors hover:bg-foreground/12 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {all ? "Fewer" : `+${files.length - HEAD_FILES} more`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Seven segments, lit or not. */
const SEGMENTS = {
  a: "2.3,1.7 4,0 16,0 17.7,1.7 16,3.4 4,3.4",
  g: "2.3,18 4,16.3 16,16.3 17.7,18 16,19.7 4,19.7",
  d: "2.3,34.3 4,32.6 16,32.6 17.7,34.3 16,36 4,36",
  f: "1.7,2.3 3.4,4 3.4,15.7 1.7,17.4 0,15.7 0,4",
  e: "1.7,18.6 3.4,20.3 3.4,32 1.7,33.7 0,32 0,20.3",
  b: "18.3,2.3 20,4 20,15.7 18.3,17.4 16.6,15.7 16.6,4",
  c: "18.3,18.6 20,20.3 20,32 18.3,33.7 16.6,32 16.6,20.3",
} as const;
const DIGITS = [
  "abcdef",
  "bc",
  "abdeg",
  "abcdg",
  "bcfg",
  "acdfg",
  "acdefg",
  "abc",
  "abcdefg",
  "abcdfg",
];

/** A digit in seven segments, `tall` px high; the segments not lit show faintly. */
function Digit({
  value,
  tall = 41,
  lit = "var(--ink)",
  unlit = ink(5.5),
}: {
  value: number;
  tall?: number;
  lit?: string;
  unlit?: string;
}) {
  return (
    <svg
      width={(23 * tall) / 41}
      height={tall}
      viewBox="-0.5 -0.5 21 37"
      className="-skew-x-[7deg] overflow-visible"
      aria-hidden
    >
      {(Object.keys(SEGMENTS) as (keyof typeof SEGMENTS)[]).map((segment) => (
        <polygon
          key={segment}
          points={SEGMENTS[segment]}
          style={{
            fill: DIGITS[value].includes(segment) ? lit : unlit,
          }}
        />
      ))}
    </svg>
  );
}

/** The most the scoreboard's clock shows, 99:59:59, and a key for each of its groups. */
const CLOCK_MAX = 99 * 3600 + 59 * 60 + 59;
const CLOCK_GROUPS = ["first", "second", "third"];

/**
 * How large each state's words are written (px): 150 at most, and no wider than the plot's 640
 * after its margin. Measured in the app's face at 150: DONE 445 across, PAUSED 629, STOPPED 725,
 * YOUR TURN 902.
 */
const SIGN_SIZE: Record<Exclude<Sign, "work">, number> = {
  done: 150,
  paused: 150,
  stopped: 132,
  you: 106,
};

/** The words written on the ground for each state of the job. */
const SIGN_WORDS: Record<Sign, string> = {
  work: "AT WORK",
  you: "YOUR TURN",
  paused: "PAUSED",
  stopped: "STOPPED",
  done: "DONE",
};

/**
 * How the job stands, written large on a plot of ground beside the building (office.scene
 * SIGN_BOX, fitted in view with it): a band of tape while it is at work, then plain capitals —
 * ember when it is the user's turn or paused on Continue, the ink when it is done, faint when
 * stopped. The words standing go first as the state changes (the tape rolls up, capitals sink),
 * then the new ones come; DONE is painted on. Words that stand as the office opens come in once
 * the office stands (`land`), so they are seen.
 */
function GroundSign({
  stage,
  sign,
  land,
}: {
  stage: Stage;
  sign: Sign;
  /** How long the words wait to come in (ms): until the office stands, as it opens; at once after. */
  land: number;
}) {
  return (
    <div
      className="office-fade pointer-events-none absolute top-0 left-0 origin-top-left"
      style={{
        width: SIGN_BOX.w,
        height: SIGN_BOX.h,
        transform: stage.sign.matrix,
        animationDelay: `${stage.popAt}ms`,
      }}
    >
      <SignSwap sign={sign} land={land} />
    </div>
  );
}

/** The words standing, then, once they have gone, the new ones. */
function SignSwap({ sign, land }: { sign: Sign; land: number }) {
  const [was, setWas] = useState<Sign | null>(null);
  const [last, setLast] = useState(sign);
  if (last !== sign) {
    setWas(last);
    setLast(sign);
  }
  useEffect(() => {
    if (was === null) return;
    // kept until the new words are in, the longest being DONE painted on (180 + 600 ms): the
    // old ones stay gone meanwhile, held at their last frame
    const out = window.setTimeout(() => setWas(null), 800);
    return () => window.clearTimeout(out);
  }, [was]);
  return (
    <>
      {was !== null && (
        <div
          className={cn(
            "absolute inset-0",
            was === "work"
              ? "origin-right animate-office-tape-out"
              : "animate-office-sign-out",
          )}
        >
          <SignWords sign={was} land={0} />
        </div>
      )}
      <div
        key={sign}
        className={cn(
          "absolute inset-0",
          was !== null &&
            (sign === "done"
              ? "animate-office-paint"
              : "animate-in fade-in delay-200 duration-300 fill-mode-backwards"),
        )}
      >
        <SignWords sign={sign} land={was !== null ? 0 : land} />
      </div>
    </>
  );
}

function SignWords({ sign, land }: { sign: Sign; land: number }) {
  // Read as it mounts: words that change later come in at once
  const [wait] = useState(land);
  if (sign === "work")
    return (
      <div className="absolute inset-x-0 top-5 flex h-27 items-center overflow-hidden pl-7 font-bold text-[64px] text-foreground/45 tracking-[0.2em]">
        {/* One repeat wider than the tape, slid along by a repeat and round again (office-tape) */}
        <span
          aria-hidden
          className="absolute inset-y-0 right-0 -left-[51px] animate-office-tape bg-[repeating-linear-gradient(-45deg,color-mix(in_oklab,var(--ink)_14%,transparent)_0_18px,transparent_18px_36px)] motion-reduce:animate-none"
        />
        <span className="relative">{SIGN_WORDS.work}</span>
      </div>
    );
  return (
    <div
      className={cn(
        "absolute top-4.5 left-6 flex animate-office-sign flex-col gap-2.5 whitespace-nowrap motion-reduce:animate-none",
        sign === "done" && "text-foreground/82",
        (sign === "you" || sign === "paused") && "text-waiting/85",
        sign === "stopped" && "text-foreground/40",
      )}
      style={{ animationDelay: `${wait}ms` }}
    >
      <span
        className="font-extrabold leading-[0.9] tracking-[0.02em]"
        style={{ fontSize: SIGN_SIZE[sign] }}
      >
        {SIGN_WORDS[sign]}
      </span>
    </div>
  );
}

/**
 * A faint red on the ground the building stands on, not its floors, while the app has stopped the
 * job and waits on Continue (office signOf "paused": a failed model call, a restart, the step
 * limit). It comes and goes slowly, under the ground's lines.
 */
function Alarm({ stage, on }: { stage: Stage; on: boolean }) {
  const { matrix, w, d } = stage.ground;
  return (
    <g
      transform={matrix}
      style={{ opacity: on ? 1 : 0, transition: "opacity 1.2s ease" }}
    >
      <defs>
        <radialGradient id="office-alarm">
          <stop
            offset="0"
            style={{ stopColor: "var(--destructive)", stopOpacity: 0.12 }}
          />
          <stop
            offset="0.55"
            style={{ stopColor: "var(--destructive)", stopOpacity: 0.07 }}
          />
          <stop
            offset="1"
            style={{ stopColor: "var(--destructive)", stopOpacity: 0 }}
          />
        </radialGradient>
      </defs>
      <ellipse
        cx={w / 2}
        cy={d / 2}
        rx={w / 2 + 100}
        ry={d / 2 + 100}
        fill="url(#office-alarm)"
      />
    </g>
  );
}

/** The ground's lines fade toward their ends. */
function Fades() {
  const stops = (
    <>
      <stop offset="0" style={{ stopColor: "var(--ink)", stopOpacity: 0 }} />
      <stop
        offset="0.3"
        style={{ stopColor: "var(--ink)", stopOpacity: 0.2 }}
      />
      <stop
        offset="0.7"
        style={{ stopColor: "var(--ink)", stopOpacity: 0.2 }}
      />
      <stop offset="1" style={{ stopColor: "var(--ink)", stopOpacity: 0 }} />
    </>
  );
  return (
    <defs>
      <linearGradient id="office-fade-x" x1="0" y1="0" x2="1" y2="1">
        {stops}
      </linearGradient>
      <linearGradient id="office-fade-y" x1="1" y1="0" x2="0" y2="1">
        {stops}
      </linearGradient>
    </defs>
  );
}

/** The sketch's hatching and the floors' light, in the theme's own greys. */
function Patterns() {
  const hatch = (id: string, gap: number, turn: number, percent: number) => (
    <pattern
      id={id}
      width={gap}
      height={gap}
      patternUnits="userSpaceOnUse"
      patternTransform={`rotate(${turn})`}
    >
      <line
        x1="0"
        y1="0"
        x2="0"
        y2={gap}
        style={{ stroke: ink(percent), strokeWidth: 0.8 }}
      />
    </pattern>
  );
  const floor = (id: string, from: string, to: string) => (
    <linearGradient id={id} x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" style={{ stopColor: from }} />
      <stop offset="1" style={{ stopColor: to }} />
    </linearGradient>
  );
  return (
    <defs>
      {hatch("office-hatch-side", 3.4, -38, 20)}
      {hatch("office-hatch-shade", 3, 28, 30)}
      {hatch("office-hatch-soft", 3.2, 28, 14)}
      {floor("office-floor-own", "var(--gray-25)", "var(--gray-100)")}
      {floor("office-floor-lobby", "var(--gray-50)", "var(--gray-150)")}
      {floor("office-floor-work", "var(--gray-0)", "var(--gray-75)")}
    </defs>
  );
}

/** The building itself: slab, floors, walls and the board, each landing at its own moment. */
const Built = memo(function Built({ stage }: { stage: Stage }) {
  return (
    <>
      {stage.faces.map((face) => (
        <Fragment key={face.id}>
          <polygon
            className="office-drop"
            points={face.points}
            style={{ fill: face.fill, animationDelay: `${face.delay}ms` }}
          />
          {face.hatch && (
            <polygon
              className="office-drop"
              points={face.points}
              fill="url(#office-hatch-side)"
              style={{ animationDelay: `${face.delay}ms` }}
            />
          )}
        </Fragment>
      ))}
      {stage.lines.map((line) => (
        <Edge
          key={line.id}
          line={line}
          className="office-drop"
          style={{ animationDelay: `${line.delay}ms` }}
        />
      ))}
    </>
  );
});

function Edge({
  line,
  className,
  style,
}: {
  line: Stroke;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <line
      className={className}
      x1={line.x1}
      y1={line.y1}
      x2={line.x2}
      y2={line.y2}
      style={{
        stroke: line.color,
        strokeWidth: line.width,
        strokeLinecap: "round",
        ...style,
      }}
    />
  );
}

/**
 * Who a held hand-off waits on, over the floor: a dashed line from each of them to the bot it is
 * for, ending in a dot at its feet. Drawn under the furniture, as a mark on the ground.
 */
function Links({ links }: { links: Moment["links"] }) {
  return (
    <>
      {links.map((link) => {
        // A little sag toward the viewer, so two lines between near desks do not lie on one another
        const mx = (link.x1 + link.x2) / 2;
        const my =
          (link.y1 + link.y2) / 2 + Math.abs(link.x2 - link.x1) * 0.12 + 6;
        return (
          <g key={link.id} opacity={link.opacity}>
            <path
              d={`M${link.x1} ${link.y1} Q${mx} ${my} ${link.x2} ${link.y2}`}
              style={{
                fill: "none",
                stroke: ink(42),
                strokeWidth: 1.3,
                strokeDasharray: "3 3.5",
                strokeLinecap: "round",
              }}
            />
            <circle
              cx={link.x2}
              cy={link.y2}
              r={2.6}
              style={{ fill: ink(55) }}
            />
          </g>
        );
      })}
    </>
  );
}

const easeOut = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - (1 - x) ** 3);

/** A piece of furniture or wall; a helper's desk is drawn in line by line as its bot joins. */
const PieceShape = memo(function PieceShape({
  piece,
  draw,
  awake = true,
}: {
  piece: Piece;
  draw: number;
  /** Its laptop's bot is at its desk: before it comes, a working screen shows dim. */
  awake?: boolean;
}) {
  const drawing = draw < 1;
  return (
    <g className="office-drop" style={{ animationDelay: `${piece.delay}ms` }}>
      <g opacity={drawing ? easeOut((draw - 0.35) / 0.65) : 1}>
        {piece.faces.map((face) => (
          <Fragment key={face.id}>
            <polygon points={face.points} style={{ fill: face.fill }} />
            {face.hatch && (
              <polygon points={face.points} fill="url(#office-hatch-side)" />
            )}
          </Fragment>
        ))}
      </g>
      {piece.edges.map((edge) => (
        <Edge
          key={edge.id}
          line={edge}
          style={
            drawing
              ? {
                  strokeDasharray: `${edge.length} ${edge.length}`,
                  strokeDashoffset: edge.length * (1 - easeOut(draw)),
                }
              : undefined
          }
        />
      ))}
      {(!drawing || draw > 0.7) && (
        <>
          {piece.mugs.map((mug) => (
            <MugShape key={`${mug.cx},${mug.cy}`} mug={mug} />
          ))}
          {piece.screen && <ScreenShape screen={piece.screen} awake={awake} />}
          {piece.check && (
            <polyline
              points={piece.check}
              style={{
                fill: "none",
                stroke: "var(--ink)",
                strokeWidth: 1.6,
                strokeLinecap: "round",
                strokeLinejoin: "round",
              }}
            />
          )}
        </>
      )}
    </g>
  );
});

/** How far apart the lines on a working screen run, in its own units (office.scene Screen). */
const SCREEN_LINES = [0.5, 0.95, 1.4, 1.85, 2.3, 2.75, 3.2, 3.65, 4.1, 4.55];

/**
 * A laptop's screen as its bot stands (office.scene Screen): lit, its lines running up a line at
 * a time while the bot works; dim with two still lines while it waits; dark once stopped; an ember
 * pause mark when the app paused it, an ember dot while it asks the user.
 */
function ScreenShape({ screen, awake }: { screen: Screen; awake: boolean }) {
  const { w, h } = screen;
  const mode = !awake && screen.mode === "lit" ? "dim" : screen.mode;
  const clip = useId();
  return (
    <g transform={screen.matrix}>
      <defs>
        <clipPath id={clip} clipPathUnits="userSpaceOnUse">
          <rect x={0} y={0} width={w} height={h} />
        </clipPath>
      </defs>
      <rect
        x={0}
        y={0}
        width={w}
        height={h}
        rx={0.15}
        style={{
          fill:
            mode === "lit"
              ? "var(--office-screen-lit)"
              : mode === "dim" || mode === "asking"
                ? "var(--office-screen-dim)"
                : "var(--office-screen-dark)",
        }}
      />
      {mode === "lit" && (
        <g clipPath={`url(#${clip})`}>
          <g className="animate-office-screen">
            {SCREEN_LINES.map((y, index) => (
              <line
                key={y}
                x1={0.55}
                y1={y}
                x2={w * (index % 3 === 2 ? 0.45 : index % 2 ? 0.7 : 0.85)}
                y2={y}
                style={{
                  stroke: "var(--office-screen-line)",
                  strokeWidth: 0.26,
                  strokeLinecap: "round",
                }}
              />
            ))}
          </g>
        </g>
      )}
      {mode === "dim" &&
        [0.7, 1.2].map((y, index) => (
          <line
            key={y}
            x1={0.55}
            y1={y}
            x2={w * (index ? 0.4 : 0.65)}
            y2={y}
            style={{
              stroke:
                "color-mix(in oklab, var(--office-screen-lit) 35%, transparent)",
              strokeWidth: 0.2,
              strokeLinecap: "round",
            }}
          />
        ))}
      {mode === "paused" && (
        <g style={{ fill: "var(--waiting)" }}>
          <rect
            x={w / 2 - 0.55}
            y={h / 2 - 0.7}
            width={0.36}
            height={1.4}
            rx={0.12}
          />
          <rect
            x={w / 2 + 0.19}
            y={h / 2 - 0.7}
            width={0.36}
            height={1.4}
            rx={0.12}
          />
        </g>
      )}
      {mode === "asking" && (
        <circle
          cx={w / 2}
          cy={h / 2}
          r={0.55}
          style={{ fill: "var(--waiting)" }}
        />
      )}
    </g>
  );
}

/** A soft pool of light on the floor under each desk at work with its bot there, on the floor's plane. */
function Pools({ stage, here }: { stage: Stage; here: Set<string> }) {
  const glow = useId();
  const pools = stage.pools.filter((pool) => here.has(pool.bot));
  if (!pools.length) return null;
  return (
    <g transform={stage.floor}>
      <defs>
        <radialGradient id={glow}>
          <stop
            offset="0"
            style={{ stopColor: "var(--ink)", stopOpacity: 0.16 }}
          />
          <stop
            offset="0.6"
            style={{ stopColor: "var(--ink)", stopOpacity: 0.08 }}
          />
          <stop
            offset="1"
            style={{ stopColor: "var(--ink)", stopOpacity: 0 }}
          />
        </radialGradient>
      </defs>
      {pools.map((pool) => (
        <ellipse
          key={pool.id}
          className="office-fade"
          cx={pool.cx}
          cy={pool.cy}
          rx={pool.r}
          ry={pool.r}
          fill={`url(#${glow})`}
          style={{ animationDelay: `${stage.popAt}ms` }}
        />
      ))}
    </g>
  );
}

function MugShape({ mug }: { mug: Mug }) {
  const line = { stroke: ink(60), strokeWidth: 1 };
  return (
    <g>
      <ellipse
        cx={mug.bx}
        cy={mug.by}
        rx={mug.rx}
        ry={mug.ry}
        style={{ fill: "var(--gray-50)", ...line }}
      />
      <rect
        x={mug.cx - mug.rx}
        y={mug.cy}
        width={mug.rx * 2}
        height={Math.max(0, mug.by - mug.cy)}
        style={{ fill: "var(--gray-50)" }}
      />
      <line
        x1={mug.cx - mug.rx}
        y1={mug.cy}
        x2={mug.bx - mug.rx}
        y2={mug.by}
        style={line}
      />
      <line
        x1={mug.cx + mug.rx}
        y1={mug.cy}
        x2={mug.bx + mug.rx}
        y2={mug.by}
        style={line}
      />
      <ellipse
        cx={mug.cx}
        cy={mug.cy}
        rx={mug.rx}
        ry={mug.ry}
        style={{ fill: "var(--gray-0)", ...line }}
      />
    </g>
  );
}

/**
 * A paper lying on a surface or pinned on the board: an order, or an answer in ink. As the office
 * builds itself, one on a desk comes once the desk has landed (`land`, ms).
 */
function PaperShape({ paper, land }: { paper: Paper; land?: number }) {
  return (
    <g
      opacity={paper.opacity}
      className={land === undefined ? undefined : "office-fade"}
      style={land === undefined ? undefined : { animationDelay: `${land}ms` }}
    >
      <polygon
        points={paper.points}
        style={{
          fill: paper.dark ? "var(--ink)" : "var(--gray-0)",
          stroke: paper.ember
            ? "var(--waiting)"
            : paper.dark
              ? "var(--ink)"
              : ink(50),
          strokeWidth: paper.ember ? 1.6 : 1,
          strokeLinejoin: "round",
        }}
      />
      {paper.lines.map((points) => (
        <polyline
          key={points}
          points={points}
          style={{
            fill: "none",
            stroke: paper.dark
              ? "color-mix(in oklab, var(--gray-0) 55%, transparent)"
              : ink(32),
            strokeWidth: 1.2,
            strokeLinecap: "round",
          }}
        />
      ))}
    </g>
  );
}

/** A sheet thrown up at the report, lying in the ground's plane: its lines on its face, its back blank. */
function SheetShape({ sheet }: { sheet: Sheet }) {
  return (
    <g
      transform={`${sheet.plane} rotate(${sheet.turn}) scale(${sheet.face} 1)`}
      opacity={sheet.opacity}
    >
      <rect
        x={-7}
        y={-9}
        width={14}
        height={18}
        rx={1.6}
        style={{
          fill: sheet.dark ? "var(--ink)" : "var(--gray-0)",
          stroke: sheet.dark ? "var(--ink)" : ink(45),
          strokeWidth: 0.8,
        }}
      />
      {sheet.face > 0 &&
        [-5, -2, 1].map((top, index) => (
          <rect
            key={top}
            x={-4.5}
            y={top}
            width={index === 2 ? 5 : 9}
            height={1.4}
            style={{
              fill: sheet.dark
                ? "color-mix(in oklab, var(--gray-0) 55%, transparent)"
                : ink(32),
            }}
          />
        ))}
    </g>
  );
}

/**
 * A bot where it stands or walks, with the paper it carries trailing its hands; it pops in once
 * the office stands. Walking, it looks where it goes. A leap lifts it, squashes it about its feet
 * and, in a flip, turns it over about its middle; at work at its desk it rocks a little, typing.
 */
function BotSprite({
  walker,
  face,
  popAt,
}: {
  walker: Walker;
  face?: BotRef;
  popAt: number;
}) {
  const { x, y, hop, tilt, spin, squash, scale, size, opacity } = walker;
  return (
    <g className="office-fade" style={{ animationDelay: `${popAt}ms` }}>
      <ellipse
        cx={x}
        cy={y}
        rx={Math.max(1, size * 0.27 - Math.min(hop * 0.5, size * 0.15))}
        ry={Math.max(1, size * 0.1 - Math.min(hop * 0.2, size * 0.05))}
        fill="url(#office-hatch-shade)"
        opacity={opacity}
      />
      <g
        transform={`translate(${x} ${y - hop}) rotate(${tilt}) scale(${scale * (1 + squash * 0.6)} ${scale * (1 - squash)}) translate(0 ${-size / 2}) rotate(${spin}) translate(${-size / 2} ${-size / 2})`}
        opacity={opacity}
      >
        <g className="office-pop" style={{ animationDelay: `${popAt}ms` }}>
          {/* At work, it bobs over its desk as one typing does */}
          <g
            className={cn(
              "origin-bottom [transform-box:fill-box]",
              walker.working &&
                "animate-office-work motion-reduce:animate-none",
            )}
          >
            <BotMark
              size={size}
              seed={walker.bot}
              {...iconProps(face?.icon)}
              state={walker.working ? "thinking" : "idle"}
              gazeX={walker.gaze[0]}
              gazeY={walker.gaze[1]}
              crossed={walker.crossed}
              notify={false}
            />
          </g>
        </g>
      </g>
      {walker.carry && (
        <g
          transform={
            walker.lag
              ? `translate(${x + size * 0.1 + walker.lag[0] * 0.8} ${y - hop * 0.6 - size - 16 + walker.lag[1] * 0.4}) rotate(${walker.lag[2] - 4})`
              : `translate(${x + size * 0.1} ${y - hop - size - 16}) rotate(${-tilt * 1.4 - 4})`
          }
        >
          <HeldPaper {...walker.carry} />
        </g>
      )}
    </g>
  );
}

/** A paper in a bot's hands or in its short flight to where it lands: an order, or an answer in ink. */
function HeldPaper({
  dark,
  ember,
  stamp = false,
}: {
  dark: boolean;
  ember: boolean;
  stamp?: boolean;
}) {
  return (
    <>
      <rect
        x={-11}
        y={-14}
        width={22}
        height={28}
        rx={2.5}
        style={{
          fill: dark ? "var(--ink)" : "var(--gray-0)",
          stroke: ember ? "var(--waiting)" : dark ? "var(--ink)" : ink(45),
          strokeWidth: 1.3,
        }}
      />
      {[-8, -3.5, 1].map((top, index) => (
        <rect
          key={top}
          x={-6.5}
          y={top}
          width={index === 2 ? 7.5 : 13}
          height={2}
          style={{
            fill: dark
              ? "color-mix(in oklab, var(--gray-0) 55%, transparent)"
              : ink(32),
          }}
        />
      ))}
      {stamp && (
        <rect
          x={-8.5}
          y={3.5}
          width={15}
          height={7}
          rx={1.5}
          transform="rotate(-14)"
          style={{
            fill: "none",
            stroke: "var(--destructive)",
            strokeWidth: 1.5,
          }}
        />
      )}
    </>
  );
}

/** A send the room turned down, stamped where it stopped, with the room's words for why. */
function Refused({
  spot,
  scale,
  text,
}: {
  spot: { x: number; y: number };
  scale: number;
  text: string;
}) {
  return (
    <div
      className="absolute flex items-center gap-2"
      style={{ left: spot.x + 30, top: spot.y - 8 }}
    >
      <div className="relative h-9.5 w-7.5 shrink-0 -rotate-5 rounded-[3px] border border-foreground/30 bg-background">
        <span
          className="absolute top-3.5 -left-0.5 rounded-[3px] border-2 border-destructive bg-background/90 px-0.75 font-semibold text-[10.5px] text-destructive"
          style={{ transform: `rotate(-14deg) scale(${scale})` }}
        >
          Refused
        </span>
      </div>
      <span className="line-clamp-3 w-48 rounded-lg border border-border bg-background/95 px-2 py-1 text-[11.5px] text-foreground/80 leading-snug">
        {text}
      </span>
    </div>
  );
}

/**
 * A plate's measure: the pill's own padding about its mark (`pl-2`, `pr-2.25`), how tall it
 * stands (`h-6.5`), and the room kept between two plates.
 */
const PLATE_PAD = 17;
const PLATE_TALL = 26;
const PLATE_GAP = 4;
/** How near the office's side an open plate may come before it unfolds inward instead. */
const PLATE_EDGE = 12;

/** How much room a plate takes as drawn: folded to its mark, and what its name and line add open. */
type Room = { mark: number; rest: number };

/**
 * Which plates would lie over another, as the bots stand (at their desks while walking): those
 * fold to their marks, until pointed at. One that wants the user is never the one folded, and is
 * drawn over the rest; the others fold in the office's order, so a crowded office still reads
 * plate by plate rather than as words written over one another. Judged by the room each plate
 * takes as drawn (PlateAt) at the size it is drawn (`scale`), not by a guess at its letters.
 */
function useCrowding(
  entries: {
    bot: string;
    home: { x: number; y: number };
    open: boolean;
    first: boolean;
    words: string;
  }[],
  scale: number,
) {
  const rooms = useRef(new Map<string, Room>());
  const onRoom = useCallback((bot: string, room: Room) => {
    rooms.current.set(bot, room);
  }, []);
  const [crowded, setCrowded] = useState<string[]>([]);
  // Judged again when a plate's words or where it sits changes; the plates measure themselves
  // first, in their own layout effects
  const key = JSON.stringify([
    scale,
    ...entries.map((one) => [
      one.bot,
      Math.round(one.home.x),
      Math.round(one.home.y),
      one.open,
      one.words,
    ]),
  ]);
  useLayoutEffect(() => {
    const box = (bot: string, x: number, y: number, wide: number) => ({
      bot,
      l: x - (wide * scale) / 2,
      r: x + (wide * scale) / 2,
      t: y - PLATE_TALL * scale,
      b: y,
    });
    type Box = ReturnType<typeof box>;
    const over = (a: Box, b: Box) =>
      a.l < b.r + PLATE_GAP &&
      b.l < a.r + PLATE_GAP &&
      a.t < b.b + PLATE_GAP &&
      b.t < a.b + PLATE_GAP;
    const shown = entries.filter((one) => one.open);
    // Folded, a plate still shows its mark
    const marks = shown.flatMap((one) => {
      const room = rooms.current.get(one.bot);
      return room ? [box(one.bot, one.home.x, one.home.y, room.mark)] : [];
    });
    const open: Box[] = [];
    const shut: string[] = [];
    for (const one of shown.sort((a, b) => Number(b.first) - Number(a.first))) {
      const room = rooms.current.get(one.bot);
      if (!room) continue;
      const wide = box(one.bot, one.home.x, one.home.y, room.mark + room.rest);
      if (one.first) {
        open.push(wide);
        continue;
      }
      if (
        [...marks, ...open].some(
          (other) => other.bot !== one.bot && over(wide, other),
        )
      )
        shut.push(one.bot);
      else open.push(wide);
    }
    setCrowded((was) =>
      was.length === shut.length && was.every((bot) => shut.includes(bot))
        ? was
        : shut,
    );
  }, [key]);
  return { crowded, onRoom };
}

/**
 * A bot's plate over its head, only while there is something to say (office plateOf): the bot at
 * work, the one that wants the user in ember, the coordinator with its report. Every other bot
 * stands as it is; pointed at or focused, here or at its tab in the room (`pointed`), its plate
 * shows the mark of how it stands and its name. A plate comes up out of its bot's head, and one
 * that has just come to want the user rings once. Opened (`words`), its words stand over it in
 * place of the plate (Reads). Pressing the bot or its plate opens or puts them away (`onPick`)
 * and opens its tab in the room. By an edge a plate is held by its mark and unfolds inward; one
 * that would lie over another folds to its mark (useCrowding). While sheets fly at the report
 * the plates step back.
 */
function PlateAt({
  plate,
  state,
  crowded,
  onRoom,
  bot,
  head,
  foot,
  lift,
  size,
  width,
  hush,
  words,
  pointed,
  scale,
  onPick,
}: {
  /** Pointed at here or at its tab in the room: unfolded as a hovered plate is. */
  pointed: boolean;
  /** Drawn at this share of its size (20 of its 26 px at the opening zoom). */
  scale: number;
  plate: Plate | null;
  state: SeatState;
  /** It would lie over another plate: folded to its mark, until pointed at (useCrowding). */
  crowded: boolean;
  onRoom: (bot: string, room: Room) => void;
  bot: string;
  head: { x: number; y: number };
  foot: number;
  lift: number;
  size: number;
  width: number;
  hush: boolean;
  /** Its words opened over it (office wordsOf; null: it has none yet), or left shut. */
  words?: ReturnType<typeof wordsOf>;
  onPick: () => void;
}) {
  const top = head.y - 6 - lift;
  const folded = (plate === null || crowded) && !pointed;
  // How much room it takes, folded and open, as drawn: for the crowding pass, and so a plate
  // near the office's edge unfolds away from it rather than past it
  const pill = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  const [room, setRoom] = useState<Room | null>(null);
  // Measured again only when what it says changes, and as its words close, since the plate is
  // hidden while they stand. Measured on every render, it forced a layout per plate on each
  // frame the office moved (useSceneClock re-renders it per frame)
  const says = `${state.key} ${plate?.tone ?? ""} ${plate?.words ?? ""}`;
  const hidden = words !== undefined;
  useLayoutEffect(() => {
    if (!pill.current || !mark.current) return;
    let rest = 0;
    for (const inner of pill.current.querySelectorAll<HTMLElement>(
      "[data-unfold]",
    ))
      rest += inner.scrollWidth;
    const next = { mark: mark.current.offsetWidth + PLATE_PAD, rest };
    onRoom(bot, next);
    setRoom((was) =>
      was && was.mark === next.mark && was.rest === next.rest ? was : next,
    );
  }, [bot, says, hidden, onRoom]);
  const open = room ? room.mark + room.rest : 0;
  const anchor = !room
    ? null
    : head.x + open / 2 > width - PLATE_EDGE
      ? { right: -room.mark / 2 }
      : head.x - open / 2 < PLATE_EDGE
        ? { left: -room.mark / 2 }
        : null;
  return (
    <div
      data-plate
      onPointerEnter={() => officePointed.set(bot)}
      onPointerLeave={() => officePointed.set(null)}
      className={cn(
        "group/plate absolute size-0 transition-opacity duration-500",
        words !== undefined
          ? "z-40"
          : // the plate that wants the user is never under another, one pointed at included
            plate?.tone === "you"
            ? "z-31"
            : pointed
              ? "z-30"
              : folded
                ? "z-10 hover:z-30 has-[:focus-visible]:z-30"
                : "z-20 hover:z-30 has-[:focus-visible]:z-30",
        hush && "opacity-15",
      )}
      style={{ left: head.x, top }}
    >
      {/* The bot's body answers to the pointer too; the plate's own button is the one keys and
          readers reach */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={onPick}
        className="pointer-events-auto absolute top-1 cursor-pointer"
        style={{
          left: -size * 0.4,
          width: size * 0.8,
          height: Math.max(12, foot - top - 4),
        }}
      />
      {words !== undefined && (
        <Reads
          words={words}
          state={state}
          bot={bot}
          top={top}
          x={head.x}
          width={width}
          below={foot - top}
          size={size}
          onPick={onPick}
        />
      )}
      <div
        ref={pill}
        // a plate that comes to say something comes up anew
        key={plate?.tone ?? "none"}
        hidden={hidden}
        style={{
          ...anchor,
          // the plate alone is drawn smaller, about its foot by the bot's head; the bot's body
          // that answers the pointer keeps its size
          scale: scale === 1 ? undefined : String(scale),
          transformOrigin: `${anchor?.right !== undefined ? "100%" : anchor?.left !== undefined ? "0%" : "50%"} 100%`,
        }}
        className={cn(
          "pointer-events-auto absolute bottom-0 flex h-6.5 items-center whitespace-nowrap rounded-full bg-background pr-2.25 text-[12px] transition-opacity duration-120",
          !anchor && "left-0 -translate-x-1/2",
          plate?.tone === "you"
            ? "ring-[1.5px] ring-waiting"
            : "ring-[0.75px] ring-foreground/25",
          plate && "animate-office-plate",
          // Nothing to say: seen only while it or its bot is pointed at or focused
          plate === null &&
            !pointed &&
            "opacity-0 group-hover/plate:opacity-100 group-has-[:focus-visible]/plate:opacity-100",
        )}
      >
        {plate?.tone === "you" && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 animate-office-ask rounded-full"
          />
        )}
        <button
          type="button"
          onClick={onPick}
          aria-label={`${bot} · ${state.label}`}
          className="flex h-full items-center rounded-full pl-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span ref={mark} className="flex shrink-0 items-center">
            <StateGlyph state={state.key} />
          </span>
          <Unfold open={!folded}>
            <span className="font-semibold">{bot}</span>
          </Unfold>
          {plate && (
            <Unfold open={!folded}>
              {plate.tone === "work" ? (
                <ShinyText text={plate.words} />
              ) : (
                <span
                  className={
                    plate.tone === "you"
                      ? "text-waiting"
                      : "text-muted-foreground"
                  }
                >
                  {plate.words}
                </span>
              )}
            </Unfold>
          )}
        </button>
      </div>
    </div>
  );
}

/** How wide words opened over a bot stand; past `max-h-56` they scroll. */
const READS_WIDE = 300;

/** What each kind of words is called at their head. */
const READS_KIND = { report: "Report", question: "Asks you", answer: "Answer" };

/**
 * A bot's words opened over it, in place of its plate (office wordsOf): the coordinator's report,
 * a question it waits on you with, or the last answer it handed back, as the room writes them;
 * a bot that has said none of these shows how it stands. They open out of its plate. The report
 * opens under its bot at your counter, down and to the left over the empty ground before the
 * building, rather than up over the coordinator's room. Other words stand above the bot, or below
 * its plate when the window's top is too near. Kept inside the office; long words scroll within
 * it, and the wheel there scrolls them rather than zooming the office. Its head puts it away, as
 * pressing the bot does.
 */
function Reads({
  words,
  state,
  bot,
  top,
  x,
  width,
  below,
  size,
  onPick,
}: {
  words: ReturnType<typeof wordsOf>;
  state: SeatState;
  bot: string;
  top: number;
  x: number;
  width: number;
  /** From the plate's foot down to the bot's feet, and the bot's size (px). */
  below: number;
  size: number;
  onPick: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const [tall, setTall] = useState(0);
  // Measured again only when its words change, not on each frame the office moves
  const says = `${state.label} ${words?.kind ?? ""} ${words?.text ?? ""}`;
  useLayoutEffect(() => {
    const height = card.current?.offsetHeight ?? 0;
    setTall((was) => (was === height ? was : height));
  }, [says]);
  const report = words?.kind === "report";
  const down = report || (tall > 0 && top - tall < 8);
  const asks = words?.kind === "question";
  return (
    <div
      ref={card}
      data-reads
      style={
        report
          ? {
              left: Math.min(
                Math.max(-READS_WIDE + size * 0.35, PLATE_EDGE - x),
                width - PLATE_EDGE - READS_WIDE - x,
              ),
              top: below + 10,
              width: READS_WIDE,
            }
          : {
              left: Math.min(
                Math.max(-READS_WIDE / 2, PLATE_EDGE - x),
                width - PLATE_EDGE - READS_WIDE - x,
              ),
              width: READS_WIDE,
              ...(down ? { top: -PLATE_TALL } : { bottom: 0 }),
            }
      }
      className={cn(
        "pointer-events-auto absolute flex cursor-auto select-text flex-col rounded-2xl bg-background shadow-lg",
        down ? "animate-office-card-down" : "animate-office-card-up",
        asks ? "ring-[1.5px] ring-waiting" : "ring-1 ring-border",
      )}
    >
      <button
        type="button"
        onClick={onPick}
        aria-expanded
        aria-label={`${bot} · ${state.label}`}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-t-2xl px-3 text-left text-[12px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <StateGlyph state={state.key} />
        <span className="font-semibold">{bot}</span>
        <span className={asks ? "text-waiting" : "text-muted-foreground"}>
          {words ? READS_KIND[words.kind] : state.label}
        </span>
      </button>
      {words && (
        // Its last lines fade into the card's foot, so words that go on below read as more
        <div className="max-h-56 overflow-y-auto overscroll-contain px-3 pb-4 [mask-image:linear-gradient(to_bottom,#000_calc(100%-14px),transparent)]">
          <Markdown className="min-w-0 text-[12.5px] leading-relaxed wrap-anywhere break-keep [&_h1]:text-[14px] [&_h2]:text-[13.5px] [&_h3]:text-[13px] [&_li]:my-0.5 [&_table]:text-[11.5px] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            {words.text}
          </Markdown>
        </div>
      )}
    </div>
  );
}

/**
 * What a folded plate keeps back: no room at all while folded, unfolding in place while the plate
 * or its bot is pointed at or focused, and always open on a plate that is not folded.
 */
function Unfold({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        "flex overflow-hidden transition-[max-width,opacity] duration-200 ease-out motion-reduce:transition-none",
        open
          ? "max-w-80 opacity-100"
          : "max-w-0 opacity-0 group-hover/plate:max-w-80 group-hover/plate:opacity-100 group-has-[:focus-visible]/plate:max-w-80 group-has-[:focus-visible]/plate:opacity-100",
      )}
    >
      {/* Its own width even while folded, so the plate knows how wide it opens (PlateAt) */}
      <span data-unfold className="flex shrink-0 items-center pl-1.5">
        {children}
      </span>
    </span>
  );
}

/**
 * The mark a state wears on a plate, all a folded one shows: a live dot, an ember one, an open
 * ring, an hourglass, a tick, a square when stopped, a small dot for a bot not called yet.
 */
function StateGlyph({ state }: { state: SeatKey }) {
  switch (state) {
    case "run":
      return (
        <span className="size-1.75 shrink-0 animate-pulse rounded-full bg-foreground motion-reduce:animate-none" />
      );
    case "asking":
      return <span className="size-1.75 shrink-0 rounded-full bg-waiting" />;
    case "paused":
      return (
        <span className="flex h-2 shrink-0 gap-0.5" aria-hidden>
          <span className="w-0.5 rounded-full bg-waiting" />
          <span className="w-0.5 rounded-full bg-waiting" />
        </span>
      );
    case "ended":
      return (
        <span className="size-1.5 shrink-0 rounded-full border-[1.5px] border-muted-foreground" />
      );
    case "held":
      return (
        <svg
          width={8}
          height={11}
          viewBox="0 0 12 14"
          aria-hidden
          className="shrink-0"
        >
          <path
            d="M1.5 1h9M1.5 13h9M2.5 1c0 3.5 3.5 4.5 3.5 6S2.5 9.5 2.5 13M9.5 1c0 3.5-3.5 4.5-3.5 6s3.5 2.5 3.5 6"
            style={{
              fill: "none",
              stroke: "currentColor",
              strokeWidth: 1.5,
              strokeLinecap: "round",
            }}
          />
        </svg>
      );
    case "done":
      return (
        <svg
          width={10}
          height={8}
          viewBox="0 0 11 9"
          aria-hidden
          className="office-check shrink-0"
        >
          <path
            d="M1 4.5l3 3L10 1.5"
            style={{
              fill: "none",
              stroke: "currentColor",
              strokeWidth: 1.7,
              strokeLinecap: "round",
              strokeLinejoin: "round",
            }}
          />
        </svg>
      );
    case "stopped":
      return (
        <span className="size-1.75 shrink-0 rounded-xs bg-muted-foreground" />
      );
    case "none":
      return (
        <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" />
      );
  }
}

/** The mark each state of the job wears on the head's line. */
const SIGN_GLYPH: Record<Sign, SeatKey> = {
  work: "run",
  you: "asking",
  paused: "paused",
  stopped: "stopped",
  done: "done",
};

/**
 * How the job stands, in words on the title's line: at work and how many are back, the user's
 * turn and who asks, paused on Continue, stopped, done. Ember only when it wants the user, and
 * then it takes them to what they are asked in the room (`onAnswer`). How long it has run is the
 * scoreboard's.
 */
function StateLine({
  scene,
  sign,
  onAnswer,
}: {
  scene: OfficeScene;
  sign: Sign;
  onAnswer?: () => void;
}) {
  const { called, back } = backOf(scene);
  const asker = scene.office.bots.find(
    (bot) => seatAt(scene, bot).key === "asking",
  );
  const words = {
    work: called ? `At work · ${back} of ${called} back` : "At work",
    you: `Your turn — ${asker ?? "a bot"} asks`,
    paused: "Paused — waiting on Continue",
    stopped: "Stopped",
    done: "Done",
  }[sign];
  const wants = sign === "you" || sign === "paused";
  const body = (
    <>
      <span
        className={cn(
          "flex w-3 justify-center",
          !wants && "text-muted-foreground",
        )}
      >
        <StateGlyph state={SIGN_GLYPH[sign]} />
      </span>
      {words}
    </>
  );
  return wants && onAnswer ? (
    <button
      type="button"
      onClick={onAnswer}
      className="pointer-events-auto flex items-center gap-1.5 text-[15px] text-waiting underline-offset-4 outline-none hover:underline focus-visible:underline"
    >
      {body}
    </button>
  ) : (
    <span
      className={cn(
        "flex items-center gap-1.5 text-[15px]",
        wants
          ? "text-waiting"
          : sign === "stopped"
            ? "text-muted-foreground"
            : "text-foreground/70",
      )}
    >
      {body}
    </span>
  );
}

/** Seconds since the handover, moving on a second at a time while the job runs; where it was seen to end after. */
function useRunFor(start: number, ended: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (ended !== null) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [ended]);
  return ended ?? (now - start) / 1000;
}

/**
 * A time in seven segments, `tall` px high, in the colour around it: minutes and seconds, then
 * hours as well, the first group without its leading zero as a scoreboard writes 4:16.
 */
function SegmentTime({ seconds, tall }: { seconds: number; tall: number }) {
  const whole = Math.min(CLOCK_MAX, Math.max(0, Math.floor(seconds)));
  const hours = Math.floor(whole / 3600);
  const groups = [
    ...(hours ? [hours] : []),
    Math.floor(whole / 60) % (hours ? 60 : 100),
    whole % 60,
  ];
  const dot = Math.max(3, Math.round(tall / 10));
  return (
    <div
      role="img"
      aria-label={`Running for ${clockOf(seconds)}`}
      className="flex items-center"
      style={{ gap: tall / 8 }}
    >
      {groups.map((group, index) => (
        <Fragment key={CLOCK_GROUPS[index]}>
          {index > 0 && (
            <span className="flex flex-col" style={{ gap: tall / 3.2 }}>
              <span
                className="rounded-[1px] bg-current"
                style={{ width: dot, height: dot }}
              />
              <span
                className="rounded-[1px] bg-current"
                style={{ width: dot, height: dot }}
              />
            </span>
          )}
          {(index > 0 || group >= 10) && (
            <Digit
              value={Math.floor(group / 10)}
              tall={tall}
              lit="currentColor"
              unlit={ink(4)}
            />
          )}
          <Digit
            value={group % 10}
            tall={tall}
            lit="currentColor"
            unlit={ink(4)}
          />
        </Fragment>
      ))}
    </div>
  );
}

/**
 * A bot's face held still (mark.geometry markStill): the scoreboard's, with no loop of its own,
 * wearing the whole icon as BotMark does — its colour, its paint top to bottom, or its outline.
 */
function StillMark({
  bot,
  icon,
  size,
}: {
  bot: string;
  icon?: BotRef["icon"];
  size: number;
}) {
  const still = useMemo(() => markStill(bot, icon ?? null), [bot, icon]);
  const paint = useId();
  const body = still.paint ? `url(#${paint})` : still.ink;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 240 240"
      aria-hidden
      className="shrink-0"
    >
      {still.paint && (
        <defs>
          <linearGradient id={paint} x1="0" y1="0" x2="0" y2="1">
            {still.paint.map((color, index, all) => (
              <stop
                key={`${color}-${index / Math.max(1, all.length - 1)}`}
                offset={index / Math.max(1, all.length - 1)}
                style={{ stopColor: color }}
              />
            ))}
          </linearGradient>
        </defs>
      )}
      <path
        d={still.head}
        style={
          still.outline
            ? { fill: "none", stroke: body, strokeWidth: 14 }
            : { fill: body }
        }
      />
      {still.eyes.map((eye) => (
        <path
          key={eye}
          d={eye}
          style={{ fill: still.outline ? body : "var(--background)" }}
        />
      ))}
    </svg>
  );
}

/** How tall the scoreboard's time stands, in its own pixels (office.scene BOARD). */
const BOARD_TIME = 170;

/** The most bots the scoreboard's crew lists: all a thread holds (config BOT_RUN.participants). */
const BOARD_CREW = 8;

/**
 * The job as a scoreboard standing behind the building at ten o'clock, turned as its left wall is
 * (office.scene BOARD), its foot behind the wall: faint, but for the time, which is the office's
 * only clock. At its right the crew as a table: each bot with how it stands and the steps it has
 * taken, most first.
 */
function Scoreboard({
  stage,
  scene,
  sign,
  start,
  label,
  faces,
}: {
  stage: Stage;
  scene: OfficeScene;
  sign: Sign;
  start: number;
  label: string;
  faces: BotRef[];
}) {
  const seconds = useRunFor(start, scene.ended);
  const crew = scene.office.bots
    .map((bot, order) => ({
      bot,
      order,
      steps: scene.office.steps.get(bot) ?? 0,
    }))
    .sort((a, b) => b.steps - a.steps || a.order - b.order)
    .slice(0, BOARD_CREW);
  return (
    <div
      className="office-fade pointer-events-none absolute top-0 left-0 origin-top-left"
      style={{
        width: stage.board.w,
        height: stage.board.h,
        transform: stage.board.matrix,
        animationDelay: `${stage.popAt}ms`,
      }}
    >
      <div className="absolute inset-x-0 top-0 flex h-85 border-2 border-foreground/30 bg-background/70 text-foreground/40">
        <div className="flex min-w-0 flex-1 flex-col justify-between px-9 pt-7 pb-8">
          <div
            aria-hidden
            className="flex items-baseline justify-between gap-6 font-semibold text-[26px] uppercase tracking-[0.18em]"
          >
            <span className="truncate">{label}</span>
            <span className="shrink-0">{SIGN_WORDS[sign]}</span>
          </div>
          <div className="text-foreground/85">
            <SegmentTime seconds={seconds} tall={BOARD_TIME} />
          </div>
        </div>
        {/* eight rows of 28 with their gaps fit the frame under its heading */}
        <div
          aria-hidden
          className="flex w-105 shrink-0 flex-col gap-1 border-foreground/30 border-l-2 px-7 pt-6"
        >
          <span className="mb-1 flex justify-between font-mono text-[19px] uppercase tracking-[0.2em]">
            <span>Crew</span>
            <span>Steps</span>
          </span>
          {crew.map(({ bot, steps }, rank) => (
            <div key={bot} className="flex h-7 items-center gap-3 text-[22px]">
              <span className="w-5 font-mono text-[18px]">{rank + 1}</span>
              <StillMark
                bot={bot}
                icon={faces.find((one) => one.name === bot)?.icon}
                size={24}
              />
              <span className="min-w-0 flex-1 truncate font-medium text-foreground/65">
                {bot}
              </span>
              <span className="flex w-3 justify-center">
                <StateGlyph state={seatAt(scene, bot).key} />
              </span>
              <span className="w-10 text-right font-mono text-foreground/65 tabular-nums">
                {steps}
              </span>
            </div>
          ))}
        </div>
      </div>
      {/* its two posts, down behind the wall to the ground */}
      <span
        aria-hidden
        className="absolute top-85 left-24 h-40 w-0.5 bg-foreground/30"
      />
      <span
        aria-hidden
        className="absolute top-85 right-24 h-40 w-0.5 bg-foreground/30"
      />
    </div>
  );
}
