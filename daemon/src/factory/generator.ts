import { nanoid } from "nanoid";
import { join } from "node:path";
import {
  type ArtifactKind,
  type ConsumerProject,
  type ArtifactDraft,
  ARTIFACT_KINDS,
} from "../schemas/artifact.js";
import type { AgentSmithConfig } from "../config.js";
import { resolveTemplate } from "./templates/index.js";
import { renderMarkdown, type RiskClass, type TemplateOptions } from "./templates/types.js";

export interface ScaffoldInput {
  kind: ArtifactKind;
  slug: string;
  project: ConsumerProject;
  options?: TemplateOptions;
}

export interface ScaffoldResult extends ArtifactDraft {
  risk_class: RiskClass;
  template_source: "project" | "generic";
}

/** Kinds we render as Markdown-with-frontmatter. All others get raw body. */
const MARKDOWN_KINDS: ReadonlySet<ArtifactKind> = new Set<ArtifactKind>([
  "agent",
  "skill",
  "command",
]);

/** Per-kind/per-project Factory. Looks up the template registry; falls back to generic. */
export class Factory {
  constructor(private cfg: AgentSmithConfig) {}

  scaffold(input: ScaffoldInput): ScaffoldResult {
    if (!ARTIFACT_KINDS.includes(input.kind)) {
      throw new Error(`unknown artifact kind: ${input.kind}`);
    }
    const projectRoot = this.cfg.consumerRoots[input.project];
    if (!projectRoot) throw new Error(`unknown consumer project: ${input.project}`);

    const { fn, fromGeneric } = resolveTemplate(input.project, input.kind);
    if (fromGeneric) {
      // eslint-disable-next-line no-console
      console.warn(
        `[agentsmith.factory] no ${input.project}/${input.kind} template — falling back to generic`,
      );
    }

    const tpl = fn(input.slug, input.options);

    const content = MARKDOWN_KINDS.has(input.kind)
      ? renderMarkdown(tpl.frontmatter, tpl.body)
      : tpl.body;

    const target_path = join(projectRoot, tpl.target_subpath).replace(/\\/g, "/");

    const draft: ScaffoldResult = {
      draft_id: `draft_${nanoid(10)}`,
      kind: input.kind,
      slug: input.slug,
      project: input.project,
      target_path,
      content,
      frontmatter: MARKDOWN_KINDS.has(input.kind) ? tpl.frontmatter : undefined,
      template_id: `${input.project}/${input.kind}${fromGeneric ? "@generic" : ""}`,
      created_at: new Date().toISOString(),
      risk_class: tpl.risk_class,
      template_source: fromGeneric ? "generic" : "project",
    };
    return draft;
  }
}
