"use client";

import { useAppEvent } from "@/app/api/events/app-event.client";
import { toast } from "@/components/ui/toast";
import { FileViewer, useOpenFile } from "./file-view";

/**
 * Opens a document the server announces with an `artifact` event. A new tab
 * needs a user gesture, so when the browser blocks it a toast offers the click.
 */
export function ArtifactView() {
  return (
    <FileViewer>
      <Opener />
    </FileViewer>
  );
}

function Opener() {
  const open = useOpenFile();

  useAppEvent({
    artifact: (event) => {
      if (open(event.path)) return;
      const name = event.path.split("/").pop() ?? event.path;
      toast.add({
        type: "success",
        title: event.label,
        description: `${name} is ready.`,
        actionProps: { children: "Open", onClick: () => open(event.path) },
      });
    },
  });

  return null;
}
