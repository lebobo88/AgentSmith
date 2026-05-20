import type { ArtifactKind, ConsumerProject } from "../../schemas/artifact.js";

export type RiskClass = "low" | "medium" | "high" | "critical";

export interface TemplateResult {
  body: string;
  frontmatter: Record<string, unknown>;
  target_subpath: string;
  risk_class: RiskClass;
}

export type TemplateOptions = Record<string, unknown> & {
  description?: string;
  model?: string;
  tools?: string[] | string;
  skills?: string[];
  color?: string;
  maxTurns?: number;
};

export type TemplateFn = (slug: string, options?: TemplateOptions) => TemplateResult;

export type ProjectTemplates = Partial<Record<ArtifactKind, TemplateFn>>;
export type TemplateRegistry = Record<ConsumerProject, ProjectTemplates>;

/** Tiny deterministic YAML emitter scoped to the shapes we generate. */
export function toYaml(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return yamlScalarString(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((v) => {
        if (v && typeof v === "object" && !Array.isArray(v)) {
          const inner = toYaml(v, indent + 1).split("\n");
          const first = inner.shift() ?? "";
          const rest = inner.length ? "\n" + inner.join("\n") : "";
          return `${pad}- ${first.trimStart()}${rest}`;
        }
        return `${pad}- ${toYaml(v, indent + 1)}`;
      })
      .join("\n");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return entries
      .map(([k, v]) => {
        if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0) {
          return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
        }
        if (Array.isArray(v) && v.length > 0) {
          return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
        }
        return `${pad}${k}: ${toYaml(v, indent + 1)}`;
      })
      .join("\n");
  }
  return String(value);
}

function yamlScalarString(s: string): string {
  if (s === "") return '""';
  // multi-line → block scalar
  if (s.includes("\n")) {
    const lines = s.split("\n").map((l) => `  ${l}`).join("\n");
    return `|\n${lines}`;
  }
  // quote when the value contains characters YAML treats as special
  if (/^[\s]|[:#&*!|>'"%@`]|[\s]$/.test(s) || /^(true|false|null|yes|no|on|off)$/i.test(s) || /^[-+]?\d/.test(s)) {
    const escaped = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return s;
}

/** Render frontmatter + markdown body into a single document. */
export function renderMarkdown(frontmatter: Record<string, unknown>, body: string): string {
  const yaml = toYaml(frontmatter);
  return `---\n${yaml}\n---\n\n${body.endsWith("\n") ? body : body + "\n"}`;
}
