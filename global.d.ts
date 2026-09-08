interface ObjectSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  [keyword: string]: unknown;
}
