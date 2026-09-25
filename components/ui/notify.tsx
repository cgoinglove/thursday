"use client";

import { ReactNode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Alert = {
  title?: ReactNode;
  description?: ReactNode;
};

/**
 * A root of its own on the body, for a dialog opened from outside React. `unmount`
 * takes the root down and its node off the body.
 */
const mount = () => {
  const container = document.createElement("div");
  container.id = crypto.randomUUID();
  document.body.appendChild(container);
  const root = createRoot(container);
  return {
    render: (node: ReactNode) => root.render(node),
    unmount: () => {
      root.unmount();
      container.remove();
    },
  };
};

export const notify = {
  component({
    renderer,
    className,
  }: {
    renderer: (dialog: {
      /** Closes it without asking: for after a save, or a cancel pressed on purpose. */
      close: () => void;
      /**
       * Tells the dialog how to know it holds words not saved. Esc, the backdrop and ×
       * then ask before throwing them away; a dialog that never calls it closes at once.
       */
      guard: (unsaved: () => boolean) => void;
    }) => ReactNode;
    className?: string;
  }) {
    return new Promise<void>((resolve) => {
      const dialog = mount();
      let unsaved: (() => boolean) | null = null;
      const close = () => {
        dialog.unmount();
        resolve();
      };
      const leave = async () => {
        if (
          unsaved?.() &&
          !(await notify.confirm({
            title: "Discard your changes?",
            description: "What you wrote here is not saved.",
            okText: "Discard",
            destructive: true,
          }))
        )
          return;
        close();
      };
      const guard = (ask: () => boolean) => {
        unsaved = ask;
      };
      dialog.render(
        <Dialog open onOpenChange={leave}>
          {/* Named by what the renderer draws: SettingDialogContent's title is its DialogTitle */}
          <DialogContent className={cn("px-0", className)}>
            {renderer({ close, guard })}
          </DialogContent>
        </Dialog>,
      );
    });
  },
  alert(alert: Alert & { okText?: ReactNode }) {
    return new Promise<void>((resolve) => {
      const dialog = mount();
      const close = () => {
        dialog.unmount();
        resolve();
      };
      dialog.render(
        <Dialog open onOpenChange={close}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>{alert.title}</DialogTitle>
              <DialogDescription>{alert.description}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant={"ghost"} onClick={close} autoFocus>
                {alert.okText || "OK"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>,
      );
    });
  },
  /**
   * `destructive` also moves the initial focus to the cancel button, so Enter
   * cannot confirm an irreversible action; `cautious` does the same without the red.
   */
  confirm: (
    confirm: Alert & {
      okText?: ReactNode;
      cancelText?: ReactNode;
      /** Irreversible action: red button, focus starts on cancel. */
      destructive?: boolean;
      /**
       * Something granted that is not seen being used — a dialog that opens by itself must
       * not be answered by a key already on its way: focus starts on cancel.
       */
      cautious?: boolean;
      /** What the question is about, between its words and its answers. */
      body?: ReactNode;
      /** Settled somewhere else: the dialog closes, answering `false`. */
      signal?: AbortSignal;
    },
  ) => {
    return new Promise<boolean>((resolve) => {
      if (confirm.signal?.aborted) {
        resolve(false);
        return;
      }
      const dialog = mount();
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        confirm.signal?.removeEventListener("abort", taken);
        dialog.unmount();
      };
      const ok = () => {
        resolve(true);
        close();
      };
      const cancel = () => {
        resolve(false);
        close();
      };
      // Out of whatever the caller was doing when it aborted: a root is not unmounted mid-render
      const taken = () => queueMicrotask(cancel);
      confirm.signal?.addEventListener("abort", taken, { once: true });
      const guarded = Boolean(confirm.destructive || confirm.cautious);

      function Component() {
        return (
          <Dialog open onOpenChange={cancel}>
            <DialogContent showCloseButton={false}>
              <DialogHeader>
                <DialogTitle>{confirm.title}</DialogTitle>
                <DialogDescription>{confirm.description}</DialogDescription>
              </DialogHeader>
              {confirm.body}
              <DialogFooter>
                <Button variant={"ghost"} onClick={cancel} autoFocus={guarded}>
                  {confirm.cancelText || "Never mind"}
                </Button>
                <Button
                  variant={confirm.destructive ? "destructive" : "secondary"}
                  onClick={ok}
                  autoFocus={!guarded}
                >
                  {confirm.okText || "OK"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      }

      dialog.render(<Component />);
    });
  },
  prompt: (
    prompt: Alert & {
      multiline?: boolean;
      placeholder?: string;
      okText?: ReactNode;
      cancelText?: ReactNode;
      maxLength?: number;
    },
  ) => {
    return new Promise<string>((resolve) => {
      const dialog = mount();

      const close = (text: string = "") => {
        dialog.unmount();
        resolve(text);
      };
      const Component = () => {
        const [text, setText] = useState("");
        const handleKeyDown = (
          e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
        ) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            close(text);
          }
        };

        return (
          <Dialog open onOpenChange={() => close()}>
            <DialogContent showCloseButton={false}>
              <DialogHeader>
                <DialogTitle>{prompt.title}</DialogTitle>
                <DialogDescription>{prompt.description}</DialogDescription>
                {prompt.multiline ? (
                  <Textarea
                    className="resize-none max-h-[200px]"
                    placeholder={prompt.placeholder}
                    autoFocus
                    value={text}
                    maxLength={prompt.maxLength}
                    onKeyDown={handleKeyDown}
                    onChange={(e) => setText(e.target.value)}
                  />
                ) : (
                  <Input
                    placeholder={prompt.placeholder}
                    autoFocus
                    value={text}
                    maxLength={prompt.maxLength}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={handleKeyDown}
                  />
                )}
              </DialogHeader>
              <DialogFooter>
                <Button variant={"ghost"} onClick={() => close()}>
                  {prompt.cancelText || "Cancel"}
                </Button>
                <Button
                  disabled={!text.trim()}
                  variant={"secondary"}
                  onClick={() => close(text)}
                >
                  {prompt.okText || "OK"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      };

      dialog.render(<Component />);
    });
  },
};
