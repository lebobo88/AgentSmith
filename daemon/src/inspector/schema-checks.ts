import { parse as parseYaml } from "yaml";
import { ZodError, type ZodTypeAny } from "zod";
import {
  ArtifactKindSchema,
  type ArtifactKind,
  type ConsumerProject,
} from "../schemas/artifact.js";
import type { SmithVerdict } from "../schemas/verdict.js";
import { PROJECT_SCHEMAS } from "./schemas/index.js";

const FRONTMATTER_FENCE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

// Kinds that ship as pure-YAML documents (no `---` fence). For these, parse the
// whole file body as YAML rather than expecting frontmatter.
const PURE_YAML_KINDS = new Set<ArtifactKind>(["team", "squad"]);

export interface SchemaCheckInput {
  kind: ArtifactKind;
  content: string;
  path?: string;
  project?: ConsumerProject;
}

/** Infer a consumer project from an artifact path; defaults to "agentSmith". */
export function inferProject(p: string | undefined): ConsumerProject {
  if (!p) return "agentSmith";
  const norm = p.replace(/\\/g, "/").toLowerCase();
  if (norm.includes("/hydra/")) return "hydra";
  if (norm.includes("/theeights/") || norm.includes("/eights/")) return "eights";
  if (norm.includes("/executivesuite/")) return "executiveSuite";
  if (norm.includes("/marketbliss/")) return "marketBliss";
  if (norm.includes("/rlm-creative/") || norm.includes("/rlmcreative/")) return "rlmCreative";
  if (norm.includes("/pair-programmer/") || norm.includes("/pairprogrammer/")) return "pairProgrammer";
  return "agentSmith";
}

export function checkSchema(input: SchemaCheckInput): SmithVerdict {
  ArtifactKindSchema.parse(input.kind);
  const now = new Date().toISOString();
  const project: ConsumerProject = input.project ?? inferProject(input.path);

  // Non-frontmatter kinds: validate with kind-specific shape rules.
  if (input.kind === "mcp") {
    return checkMcp(input.content, now);
  }
  if (input.kind === "hook") {
    return checkHook(input.content, now);
  }

  const schema = PROJECT_SCHEMAS[project]?.[input.kind];
  if (!schema) {
    return passVerdict(
      now,
      `no schema registered for (${project}, ${input.kind}) — pass`,
    );
  }

  // Extract YAML payload: fenced frontmatter for most kinds; whole document for pure YAML.
  let yamlBody: string;
  if (PURE_YAML_KINDS.has(input.kind)) {
    yamlBody = input.content;
  } else {
    const fence = input.content.match(FRONTMATTER_FENCE);
    if (!fence) {
      return failVerdict(now, `missing YAML frontmatter in ${input.kind}`);
    }
    yamlBody = fence[1] ?? "";
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(yamlBody) ?? {};
  } catch (err) {
    return failVerdict(now, `invalid YAML: ${String(err)}`);
  }

  return runZod(schema, parsed, now, project, input.kind);
}

function runZod(
  schema: ZodTypeAny,
  parsed: unknown,
  now: string,
  project: ConsumerProject,
  kind: ArtifactKind,
): SmithVerdict {
  const result = schema.safeParse(parsed);
  if (result.success) {
    return passVerdict(now, `frontmatter conforms to (${project}, ${kind}) schema`);
  }
  const summary = summarizeZodError(result.error);
  return failVerdict(
    now,
    `schema violation for (${project}, ${kind}): ${summary}`,
  );
}

function summarizeZodError(err: ZodError): string {
  return err.issues
    .map((iss) => {
      const path = iss.path.length > 0 ? iss.path.join(".") : "<root>";
      return `${path}: ${iss.message}`;
    })
    .join("; ");
}

function checkMcp(content: string, now: string): SmithVerdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    return failVerdict(now, `mcp config is not valid JSON: ${String(err)}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    return failVerdict(now, "mcp config must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  if (!("mcpServers" in obj) || typeof obj.mcpServers !== "object" || obj.mcpServers === null) {
    return failVerdict(now, "mcp config missing required key: mcpServers");
  }
  return passVerdict(now, "mcp config has mcpServers map");
}

function checkHook(content: string, now: string): SmithVerdict {
  if (content.trim().length === 0) {
    return failVerdict(now, "hook script is empty");
  }
  return passVerdict(now, "hook is non-empty");
}

function passVerdict(decided_at: string, rationale: string): SmithVerdict {
  return {
    outcome: "allow",
    rationale,
    cited_invariants: [],
    evidence: [],
    decided_at,
  };
}

function failVerdict(decided_at: string, rationale: string): SmithVerdict {
  return {
    outcome: "deny",
    rationale,
    cited_invariants: ["N7"],
    suggested_fix:
      "restore conforming frontmatter; see C:/AiAppDeployments/AgentSmith/.claude/skills/cross-project-conventions/SKILL.md",
    evidence: [],
    decided_at,
  };
}
