import { nanoid } from "nanoid";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  type ArtifactKind,
  type ConsumerProject,
  type ArtifactDraft,
  ARTIFACT_KINDS,
} from "../schemas/artifact.js";
import { type AgentSmithConfig, consumerBase } from "../config.js";
import { resolveTemplate } from "./templates/index.js";
import { renderMarkdown, type RiskClass, type TemplateOptions } from "./templates/types.js";

/** Platform-appropriate default root for ad-hoc consumer projects. Read at
 *  call-time (not module-load) so tests can override via env. Resolution:
 *  AGENTSMITH_CONSUMER_BASE -> AIAPP_BASE -> dirname(repoRoot()). */
function defaultConsumerBase(): string {
  return consumerBase();
}

/** Signals that mark a directory as a real consumer project root. */
const CONSUMER_PROJECT_SIGNALS = [".claude", "AGENTS.md", "CLAUDE.md"] as const;

/**
 * Resolve the on-disk root for a consumer project slug.
 *
 * Resolution order:
 *   1. Explicit entry in `cfg.consumerRoots` (back-compat for the 7 legacy
 *      camelCase names: hydra, eights, executiveSuite, marketBliss,
 *      rlmCreative, pairProgrammer, agentSmith).
 *   2. Fallback: `<consumerBase()>/<slug>` (resolution:
 *      AGENTSMITH_CONSUMER_BASE -> AIAPP_BASE -> dirname(repoRoot()), i.e.
 *      `<AIAPP_BASE>/<slug>`). The resolved directory must EXIST
 *      and contain at least one of `.claude/`, `AGENTS.md`, or `CLAUDE.md`
 *      — otherwise a clear error is thrown listing all three signals.
 *
 * Throws on:
 *   - resolved path does not exist
 *   - resolved path exists but is not a directory
 *   - resolved path is a directory but contains none of the required signals
 */
export function resolveConsumerRoot(
  cfg: AgentSmithConfig,
  project: ConsumerProject,
): string {
  const explicit = cfg.consumerRoots[project];
  if (explicit) return explicit;

  const fallback = join(defaultConsumerBase(), project).replace(/\\/g, "/");
  if (!existsSync(fallback)) {
    throw new Error(
      `unknown consumer project: "${project}" — no entry in cfg.consumerRoots and ` +
        `fallback path "${fallback}" does not exist. Either register the project ` +
        `via AGENTSMITH_CONSUMER_BASE/<slug>, or add it to cfg.consumerRoots.`,
    );
  }
  let st;
  try {
    st = statSync(fallback);
  } catch (err) {
    throw new Error(
      `consumer project "${project}" path "${fallback}" stat failed: ${String(err)}`,
    );
  }
  if (!st.isDirectory()) {
    throw new Error(
      `consumer project "${project}" path "${fallback}" is not a directory`,
    );
  }
  const hasSignal = CONSUMER_PROJECT_SIGNALS.some((sig) =>
    existsSync(join(fallback, sig)),
  );
  if (!hasSignal) {
    throw new Error(
      `consumer project "${project}" path "${fallback}" is missing all of the ` +
        `required signals: ${CONSUMER_PROJECT_SIGNALS.join(", ")}. At least one ` +
        `must exist to confirm this is a real consumer project (and not a ` +
        `mistyped slug or unrelated directory).`,
    );
  }
  return fallback;
}

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
    const projectRoot = resolveConsumerRoot(this.cfg, input.project);

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
