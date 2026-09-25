"use client";

import { type KeyboardEvent, memo, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonViewProps = {
  data: unknown;
  name?: string;
  initialExpandDepth?: number;
};

function tryParseJson(str: string): { success: boolean; data: JsonValue } {
  const trimmed = str.trim();
  if (
    !(trimmed.startsWith("{") && trimmed.endsWith("}")) &&
    !(trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return { success: false, data: str };
  }
  try {
    return { success: true, data: JSON.parse(str) };
  } catch {
    return { success: false, data: str };
  }
}

const JsonView = memo(
  ({ data, name, initialExpandDepth = 2 }: JsonViewProps) => {
    // Parse a JSON string once, not on every render.
    const normalizedData = useMemo(
      () => (typeof data === "string" ? tryParseJson(data).data : data),
      [data],
    );

    return (
      <div className="text-sm">
        <JsonNode
          data={normalizedData as JsonValue}
          name={name}
          depth={0}
          initialExpandDepth={initialExpandDepth}
        />
      </div>
    );
  },
);

JsonView.displayName = "JsonView";

/**
 * A fold drawn as text rather than a button (a <pre> may not sit in a <button>) still
 * takes focus, and Enter or Space presses it as they would a button.
 */
const toggleProps = (expanded: boolean, toggle: () => void) => ({
  role: "button" as const,
  tabIndex: 0,
  "aria-expanded": expanded,
  onClick: toggle,
  onKeyDown: (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggle();
  },
});

/** Only on keyboard focus, as the app's buttons draw it. */
const TOGGLE_FOCUS =
  "outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

interface JsonNodeProps {
  data: JsonValue;
  name?: string;
  depth: number;
  initialExpandDepth: number;
}

const JsonNode = memo(
  ({ data, name, depth = 0, initialExpandDepth }: JsonNodeProps) => {
    const getDataType = (value: JsonValue): string => {
      if (value === undefined) return "undefined";
      if (Array.isArray(value)) return "array";
      if (value === null) return "null";
      return typeof value;
    };

    const dataType = getDataType(data);
    const [isExpanded, setIsExpanded] = useState(
      dataType === "string" ? false : depth < initialExpandDepth,
    );

    const typeStyleMap: Record<string, string> = {
      number: "text-blue-500",
      boolean: "text-amber-500",
      null: "text-purple-500",
      undefined: "text-gray-500",
      string: "text-foreground break-all whitespace-pre-wrap",
      default: "text-muted-foreground",
    };

    const renderCollapsible = (isArray: boolean) => {
      const items = isArray
        ? (data as JsonValue[])
        : Object.entries(data as Record<string, JsonValue>);
      const itemCount = items.length;
      const isEmpty = itemCount === 0;

      const symbolMap = {
        open: isArray ? "[" : "{",
        close: isArray ? "]" : "}",
        collapsed: isArray ? "[ ... ]" : "{ ... }",
        empty: isArray ? "[]" : "{}",
      };

      if (isEmpty) {
        return (
          <div className="flex items-center">
            {name && (
              <span className="mr-1 text-muted-foreground">{name}:</span>
            )}
            <span className="text-muted-foreground">{symbolMap.empty}</span>
          </div>
        );
      }

      return (
        <div className="flex flex-col">
          <div
            className={cn(
              "flex items-center mr-1 rounded cursor-pointer group hover:bg-input/30",
              TOGGLE_FOCUS,
            )}
            {...toggleProps(isExpanded, () => setIsExpanded(!isExpanded))}
          >
            {name && (
              <span className="mr-1 text-muted-foreground hover:text-foreground">
                {name}:
              </span>
            )}
            {isExpanded ? (
              <span className="text-muted-foreground group-hover:text-foreground">
                {symbolMap.open}
              </span>
            ) : (
              <>
                <span className="text-muted-foreground group-hover:text-foreground">
                  {symbolMap.collapsed}
                </span>
                <span className="ml-1 text-muted-foreground group-hover:text-foreground">
                  {itemCount} {itemCount === 1 ? "item" : "items"}
                </span>
              </>
            )}
          </div>
          {isExpanded && (
            <>
              <div className="pl-2 ml-4 border-l border-border">
                {isArray
                  ? (items as JsonValue[]).map((item, index) => (
                      <div key={index} className="my-1">
                        <JsonNode
                          data={item}
                          name={`${index}`}
                          depth={depth + 1}
                          initialExpandDepth={initialExpandDepth}
                        />
                      </div>
                    ))
                  : (items as [string, JsonValue][]).map(([key, value]) => (
                      <div key={key} className="my-1">
                        <JsonNode
                          data={value}
                          name={key}
                          depth={depth + 1}
                          initialExpandDepth={initialExpandDepth}
                        />
                      </div>
                    ))}
              </div>
              <div className="text-muted-foreground">{symbolMap.close}</div>
            </>
          )}
        </div>
      );
    };

    const renderString = (value: string) => {
      const maxLength = 100;
      const isTooLong = value.length > maxLength;

      if (!isTooLong) {
        return (
          <div className="flex mr-1 rounded hover:bg-input/30">
            {name && (
              <span className="mr-1 text-muted-foreground">{name}:</span>
            )}
            <pre className={typeStyleMap.string}>&quot;{value}&quot;</pre>
          </div>
        );
      }

      return (
        <div className="flex mr-1 rounded group hover:bg-input/30">
          {name && (
            <span className="mr-1 text-muted-foreground hover:text-foreground">
              {name}:
            </span>
          )}
          <pre
            className={cn(
              typeStyleMap.string,
              "cursor-pointer group-hover:text-foreground",
              TOGGLE_FOCUS,
            )}
            {...toggleProps(isExpanded, () => setIsExpanded(!isExpanded))}
            title={isExpanded ? "Click to collapse" : "Click to expand"}
          >
            {isExpanded ? `"${value}"` : `"${value.slice(0, maxLength)}..."`}
          </pre>
        </div>
      );
    };

    switch (dataType) {
      case "object":
      case "array":
        return renderCollapsible(dataType === "array");
      case "string":
        return renderString(data as string);
      case "undefined":
        return (
          <div className="flex items-center mr-1 rounded hover:bg-input/30">
            {name && (
              <span className="mr-1 text-muted-foreground">{name}:</span>
            )}
            <span className={typeStyleMap.undefined}>undefined</span>
          </div>
        );
      default:
        return (
          <div className="flex items-center mr-1 rounded hover:bg-input/30">
            {name && (
              <span className="mr-1 text-muted-foreground">{name}:</span>
            )}
            <span className={typeStyleMap[dataType] || typeStyleMap.default}>
              {data === null ? "null" : String(data)}
            </span>
          </div>
        );
    }
  },
);

JsonNode.displayName = "JsonNode";

export default JsonView;
