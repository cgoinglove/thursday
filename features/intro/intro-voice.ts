import { useCallback, useEffect, useRef, useState } from "react";
import { createClipTap, SPECTRUM_BANDS } from "@/lib/live/live.tap";

/**
 * Her recorded voice on the first run: each of her lines there is also a clip, so she can
 * be heard before any key exists. Everything about it is here — what she says aloud, where
 * a clip lives, and the hook that plays one — and `scripts/intro-voice.mts` records the
 * clips from this script. What she says aloud is its own text, not the caption's: a line
 * on screen can be rewritten freely, and she opens by saying this is a recording, which a
 * caption has no need to. A clip is named by a hash of its words, so a line rewritten here
 * is silent until it is recorded again, never a clip saying the old words.
 */

/** How the clips are made (scripts/intro-voice.mts): the default call voice, asked to sound like a call. */
export const INTRO_VOICE = {
  model: "gpt-4o-mini-tts",
  voice: "marin",
  instructions:
    "Warm, relaxed and conversational, like a friend on the phone who is glad you called. Natural pace, a light smile in the voice. American English.",
  dir: "voices/intro",
} as const;

/** What she says aloud, by the line it goes with. Plain words: whoever hears this may never have seen an API key. */
export const INTRO_SPOKEN = {
  /** Said once, ahead of whichever line comes first: she says what this is before anything else. */
  hello:
    "Hi, I'm Thursday. One thing first: this is a recording. You'll hear my real voice on our first call.",
  key: "My real voice comes from OpenAI, and it needs a key — think of it as a password. Paste one in, and I wake up. Don't have one yet? No problem, skip ahead. I'll ask again later.",
  awake:
    "There we go — I'm awake. That key is all a call needs. The rest is quick: your microphone, who does the work for you, and what they think with.",
  mic: "Now let me hear you. Your browser will ask before it turns the microphone on. Say yes, then say anything — and watch the line under me move. It's only on during a call, unless you ask for more.",
  heard:
    "I hear you — that line is your voice. If you'd rather wake me by saying my name instead of tapping, switch that on here and give it a try.",
  bots: "Big jobs go to my helper bots, so you and I can keep talking while they work. They work right here on your computer, with a browser and your files. Signing in and paying always stay with you.",
  models:
    "Every bot runs on an A.I. model that you pick. Start small: a small one is fast and cheap, and you can move any bot up later. Your OpenAI key already covers it. A GPT subscription, or a Vercel key, opens up a lot more.",
  style:
    "One more, and it's the fun one: who I am to you. There are ten of me, and the only difference is how I talk. Pick whoever sounds like someone you'd call — you can change your mind anytime.",
  call: "That's everything. Call me, tell me what to call you, and ask for one thing — anything you'd ask someone sitting next to you. From here on, it's my real voice. I'll show you the rest as we go.",
  asleep:
    "I still don't have a voice of my own, so no calls yet — but everything else works. Have a look around. When you have a key, tap me, and I'll take it from there.",
} as const;

export type IntroLine = keyof typeof INTRO_SPOKEN;

/** FNV-1a over the voice and the words: the same eight characters in the browser and in the script. */
function stamp(words: string): string {
  let hash = 0x811c9dc5;
  for (const char of `${INTRO_VOICE.voice}|${words}`) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** The clip's file name: the line, and the stamp of what it says. */
export const introClipName = (line: IntroLine) =>
  `${line}-${stamp(INTRO_SPOKEN[line])}.ogg`;

const SILENT = new Array<number>(SPECTRUM_BANDS).fill(0);

/** Where the choice is kept: someone who muted her once is not spoken to again. */
const MUTED_KEY = "thursday.intro.muted";

/** Whether she was muted on an earlier visit; the opening's sounds keep to it too (echoes.tsx). */
export function introMuted() {
  try {
    return window.localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Plays her clips. The first one has to start inside a click (`say` from the handler): a
 * browser lets a page make sound only from there, and an element that has played once may
 * play again by itself, which is how the later lines follow their step. Each line is said
 * once a visit, several in a row when asked for together, and a new ask cuts in. A clip
 * that is missing or refused is silence, never an error.
 */
export function useIntroVoice(line: IntroLine | null) {
  const held = useRef<{
    audio: HTMLAudioElement;
    clip: ReturnType<typeof createClipTap>;
  } | null>(null);
  const said = useRef(new Set<IntroLine>());
  /** What follows the clip now playing. */
  const next = useRef<IntroLine[]>([]);
  const sounding = useRef(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedNow = useRef(false);

  useEffect(() => {
    try {
      const was = window.localStorage.getItem(MUTED_KEY) === "1";
      mutedNow.current = was;
      setMuted(was);
    } catch {
      // storage may be blocked; she speaks
    }
  }, []);

  const hush = useCallback(() => {
    next.current = [];
    held.current?.audio.pause();
  }, []);

  const play = useCallback(() => {
    const one = next.current.shift();
    if (!one || !held.current) return;
    const { audio, clip } = held.current;
    void clip.resume();
    audio.src = `/${INTRO_VOICE.dir}/${introClipName(one)}`;
    void audio.play().catch(() => {});
  }, []);

  const say = useCallback(
    (...lines: IntroLine[]) => {
      const fresh = lines.filter((one) => !said.current.has(one));
      if (mutedNow.current || !fresh.length) return;
      if (!held.current) {
        const audio = new Audio();
        const heard = (on: boolean) => () => {
          sounding.current = on;
          setSpeaking(on);
        };
        audio.addEventListener("playing", heard(true));
        for (const over of ["pause", "ended", "error"])
          audio.addEventListener(over, heard(false));
        // one clip over, the next begins; a clip that will not load is skipped
        audio.addEventListener("ended", play);
        audio.addEventListener("error", play);
        // An element is routed once, so the tap lasts as long as the element does
        held.current = { audio, clip: createClipTap(audio) };
      }
      for (const one of fresh) said.current.add(one);
      next.current = fresh;
      play();
    },
    [play],
  );

  // The lines after the first follow their step by themselves
  useEffect(() => {
    if (line && held.current) say(line);
  }, [line, say]);

  // Gone with the intro: she must not talk over the call it ends on
  useEffect(
    () => () => {
      held.current?.audio.pause();
      void held.current?.clip.close();
      held.current = null;
    },
    [],
  );

  const toggle = useCallback(() => {
    const next = !mutedNow.current;
    mutedNow.current = next;
    setMuted(next);
    try {
      window.localStorage.setItem(MUTED_KEY, next ? "1" : "0");
    } catch {
      // kept for this visit only
    }
    if (next) return hush();
    // Switched back on inside this click: the line on screen is said again
    if (line) {
      said.current.delete(line);
      say(line);
    }
  }, [hush, line, say]);

  const spectrum = useCallback(
    () =>
      held.current && sounding.current ? held.current.clip.read() : SILENT,
    [],
  );

  return { say, hush, speaking, muted, toggle, spectrum };
}
