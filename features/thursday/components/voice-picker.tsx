"use client";

import { Check, ChevronDown, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, inputClassName } from "@/components/ui/input";
import { ShinyText } from "@/components/ui/shiny-text";
import { toast } from "@/components/ui/toast";
import {
  LIVE_VOICE_NOTE,
  LIVE_VOICES,
  voiceSamplePath,
} from "@/features/ai/live.schema";
import { Face } from "@/features/thursday/components/face";
import { createClipTap, SPECTRUM_BANDS } from "@/lib/live/live.tap";
import { cn, errorToString } from "@/lib/utils";

/**
 * Choosing a voice by ear. A name plays its recorded line and her own face
 * speaks it — the same component and the same bands a call moves her with, so
 * what you hear and see here is what the call will be. Only Save writes, so
 * hearing eleven voices stores none of them.
 */

const SILENT = new Array<number>(SPECTRUM_BANDS).fill(0);

export function VoicePicker({
  voice,
  onChange,
}: {
  /** The saved voice: what the next call opens with. */
  voice: string;
  onChange: (voice: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [heard, setHeard] = useState(voice);
  const [playing, setPlaying] = useState(false);
  const [typed, setTyped] = useState("");

  const clip = useRef<HTMLAudioElement>(null);
  // A tap belongs to the element it routes, which exists only while the picker is open.
  const tap = useRef<{
    element: HTMLAudioElement;
    clip: ReturnType<typeof createClipTap>;
  } | null>(null);
  // Each play and each stop takes the next number; a failure reported for an
  // earlier one changes nothing.
  const plays = useRef(0);
  // The face reads the spectrum once per animation frame, so what it reads is a
  // ref, not state: a stable function, and silence when nothing is playing.
  const sounding = useRef(false);
  const spectrum = useCallback(
    () => (tap.current && sounding.current ? tap.current.clip.read() : SILENT),
    [],
  );
  const showPlaying = (on: boolean) => {
    sounding.current = on;
    setPlaying(on);
  };

  // The element goes when the picker closes; its graph goes with it.
  useEffect(() => {
    if (!open) return;
    return () => {
      const held = tap.current;
      tap.current = null;
      if (!held) return;
      held.element.pause();
      void held.clip.close();
    };
  }, [open]);

  const failed = (play: number, cause: unknown) => {
    if (play !== plays.current) return;
    plays.current++;
    showPlaying(false);
    toast.add({
      type: "error",
      title: "Voice sample did not play",
      description: errorToString(cause),
    });
  };

  const stop = () => {
    plays.current++;
    const audio = clip.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    showPlaying(false);
  };

  const audition = (next: string) => {
    const audio = clip.current;
    if (!audio) return;
    if (playing && next === heard) {
      stop();
      return;
    }
    setHeard(next);
    setTyped("");
    // The graph is built inside the gesture that plays: an AudioContext made
    // before one is refused. An element is routed once, so it keeps its tap.
    if (tap.current?.element !== audio) {
      void tap.current?.clip.close();
      tap.current = { element: audio, clip: createClipTap(audio) };
    }
    void tap.current.clip.resume();
    const play = ++plays.current;
    audio.src = voiceSamplePath(next);
    showPlaying(true);
    void audio.play().catch((cause: unknown) => {
      // A later click or a stop cut this one short; that play owns the state.
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      failed(play, cause);
    });
  };

  const close = () => {
    stop();
    setOpen(false);
    setTyped("");
    setHeard(voice);
  };

  const save = () => {
    const picked = typed.trim() || heard;
    stop();
    setOpen(false);
    setTyped("");
    setHeard(picked);
    if (picked !== voice) onChange(picked);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Voice"
        className={cn(
          inputClassName,
          "flex items-center gap-2 text-left font-mono text-sm hover:border-ring",
        )}
      >
        <span className="shrink-0">{voice}</span>
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">
          {LIVE_VOICE_NOTE[voice as keyof typeof LIVE_VOICE_NOTE]}
        </span>
        <ChevronDown className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
      </button>
    );
  }

  return (
    <div className="@container space-y-2">
      {/* Nothing here plays through the page's own speakers but this element. */}
      <audio
        ref={clip}
        onEnded={() => showPlaying(false)}
        // A clip that breaks after it starts fails here, not in play()
        onError={(event) => {
          if (!sounding.current) return;
          failed(
            plays.current,
            event.currentTarget.error?.message || "The clip could not be read.",
          );
        }}
      >
        <track kind="captions" />
      </audio>

      <div className="rounded-xl border border-border/60 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="font-mono text-[11px] text-muted-foreground">
            click a name to hear it
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="ml-auto"
            aria-label="Close"
            onClick={close}
          >
            <X />
          </Button>
        </div>

        <div className="grid gap-4 @md:grid-cols-[11rem_minmax(0,1fr)]">
          <div className="flex flex-col items-center gap-2">
            <Face
              status={playing ? "speaking" : "idle"}
              getSpectrum={spectrum}
              className="w-44"
            />
            <span className="text-sm font-medium">
              {playing ? <ShinyText text={heard} /> : heard}
            </span>
            <span className="h-4 font-mono text-[11px] text-muted-foreground">
              {LIVE_VOICE_NOTE[heard as keyof typeof LIVE_VOICE_NOTE]}
            </span>
          </div>

          <div className="max-h-56 min-w-0 overflow-y-auto">
            {LIVE_VOICES.map((name) => (
              <button
                type="button"
                key={name}
                onClick={() => audition(name)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-sm outline-none hover:bg-accent focus-visible:bg-accent",
                  name === heard && "bg-accent text-accent-foreground",
                )}
              >
                <span className="flex-1 text-left">
                  {playing && name === heard ? <ShinyText text={name} /> : name}
                </span>
                <span className="shrink truncate font-mono text-[11px] text-muted-foreground">
                  {LIVE_VOICE_NOTE[name]}
                </span>
                <Check
                  className={cn(
                    "size-3.5 shrink-0",
                    name === voice ? "opacity-100" : "opacity-0",
                  )}
                />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* A voice id that is not on the list still runs; it simply has no clip. */}
      <div className="flex gap-2">
        <Input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="another voice id"
          aria-label="Another voice id"
          spellCheck={false}
          className="font-mono text-sm"
        />
        <Button className="shrink-0" onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}
