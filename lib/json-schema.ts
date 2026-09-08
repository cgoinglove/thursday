/** Renders a JSON Schema as a TypeScript-like type string. Unsupported keywords become `unknown`. */
export function schemaToType(schema: unknown, indent = 0): string {
  if (!schema || typeof schema !== "object") return "unknown";
  const node = schema as Record<string, any>;
  const pad = "  ".repeat(indent + 1);
  const close = "  ".repeat(indent);

  if (Array.isArray(node.enum)) {
    return node.enum.map((value: unknown) => JSON.stringify(value)).join(" | ");
  }

  const union = node.anyOf ?? node.oneOf;
  if (Array.isArray(union)) {
    return union.map((entry) => schemaToType(entry, indent)).join(" | ");
  }

  if (node.type === "array") {
    const item = schemaToType(node.items, indent);
    // Parenthesized only when the item type would bind wrong
    return /[|{]/.test(item) ? `(${item})[]` : `${item}[]`;
  }

  if (node.type === "object" || node.properties) {
    const properties = node.properties as Record<string, unknown> | undefined;
    if (!properties || Object.keys(properties).length === 0) return "{}";
    const required: string[] = node.required ?? [];

    const lines = Object.entries(properties).map(([key, value]) => {
      const optional = required.includes(key) ? "" : "?";
      const description = (value as Record<string, unknown>)?.description;
      const comment =
        typeof description === "string" && description.length <= 60
          ? `  // ${description}`
          : "";
      return `${pad}${key}${optional}: ${schemaToType(value, indent + 1)}${comment}`;
    });
    return `{\n${lines.join("\n")}\n${close}}`;
  }

  if (Array.isArray(node.type)) return node.type.join(" | ");
  return typeof node.type === "string" ? node.type : "unknown";
}
