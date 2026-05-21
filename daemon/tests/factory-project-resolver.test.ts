import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Factory, resolveConsumerRoot } from "../src/factory/generator.js";
import { ConsumerProjectSchema, KNOWN_CONSUMER_PROJECTS } from "../src/schemas/artifact.js";
import type { AgentSmithConfig } from "../src/config.js";

describe("AS2 — ConsumerProjectSchema widening + path-resolver fallback", () => {
  let scratchBase: string;
  let originalEnv: string | undefined;

  beforeAll(() => {
    scratchBase = mkdtempSync(join(tmpdir(), "agentsmith-as2-"));
    originalEnv = process.env["AGENTSMITH_CONSUMER_BASE"];
    process.env["AGENTSMITH_CONSUMER_BASE"] = scratchBase;
  });

  afterAll(() => {
    if (originalEnv === undefined) delete process.env["AGENTSMITH_CONSUMER_BASE"];
    else process.env["AGENTSMITH_CONSUMER_BASE"] = originalEnv;
    rmSync(scratchBase, { recursive: true, force: true });
  });

  it("accepts the 7 legacy camelCase project names", () => {
    for (const name of KNOWN_CONSUMER_PROJECTS) {
      expect(ConsumerProjectSchema.safeParse(name).success).toBe(true);
    }
  });

  it("accepts a brand-new kebab-case project slug", () => {
    expect(ConsumerProjectSchema.safeParse("consumer-project-x").success).toBe(true);
    expect(ConsumerProjectSchema.safeParse("rlm-platform").success).toBe(true);
  });

  it("rejects path-traversal / injection nonsense", () => {
    expect(ConsumerProjectSchema.safeParse("../etc/passwd").success).toBe(false);
    expect(ConsumerProjectSchema.safeParse("hydra/sub").success).toBe(false);
    expect(ConsumerProjectSchema.safeParse("HYDRA").success).toBe(false);
    expect(ConsumerProjectSchema.safeParse("9hydra").success).toBe(false);
    expect(ConsumerProjectSchema.safeParse("hydra.bad").success).toBe(false);
    expect(ConsumerProjectSchema.safeParse("hydra bad").success).toBe(false);
    expect(ConsumerProjectSchema.safeParse("").success).toBe(false);
  });

  // Minimal cfg stub — only the fields resolveConsumerRoot reads.
  function stubCfg(consumerRoots: Record<string, string> = {}): AgentSmithConfig {
    return {
      agentsmithHome: scratchBase,
      statePath: join(scratchBase, "state.db"),
      decisionsPath: join(scratchBase, "decisions.jsonl"),
      quarantineDir: join(scratchBase, "quarantine"),
      registryCachePath: join(scratchBase, "registry-cache.json"),
      logsDir: join(scratchBase, "logs"),
      constitutionPath: join(scratchBase, "constitution.md"),
      consumerRoots,
      replicationQuotaPerScope: 4,
      keymakerScanBudgetMs: 500,
      inspectorBudgetMs: 200,
    };
  }

  it("resolveConsumerRoot returns explicit consumerRoots entry when present (back-compat)", () => {
    const explicit = join(scratchBase, "explicit-hydra");
    mkdirSync(explicit, { recursive: true });
    const cfg = stubCfg({ hydra: explicit });
    expect(resolveConsumerRoot(cfg, "hydra")).toBe(explicit);
  });

  it("resolveConsumerRoot falls back to <CONSUMER_BASE>/<slug> when slug exists with .claude/", () => {
    const projDir = join(scratchBase, "consumer-project-x");
    mkdirSync(join(projDir, ".claude"), { recursive: true });
    const cfg = stubCfg();
    const root = resolveConsumerRoot(cfg, "consumer-project-x");
    expect(root.replace(/\\/g, "/")).toBe(projDir.replace(/\\/g, "/"));
  });

  it("resolveConsumerRoot accepts a fallback dir with AGENTS.md signal", () => {
    const projDir = join(scratchBase, "agents-only-project");
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, "AGENTS.md"), "# AGENTS\n");
    const cfg = stubCfg();
    const root = resolveConsumerRoot(cfg, "agents-only-project");
    expect(root.replace(/\\/g, "/")).toBe(projDir.replace(/\\/g, "/"));
  });

  it("resolveConsumerRoot accepts a fallback dir with CLAUDE.md signal", () => {
    const projDir = join(scratchBase, "claudemd-project");
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, "CLAUDE.md"), "# CLAUDE\n");
    const cfg = stubCfg();
    const root = resolveConsumerRoot(cfg, "claudemd-project");
    expect(root.replace(/\\/g, "/")).toBe(projDir.replace(/\\/g, "/"));
  });

  it("resolveConsumerRoot throws a clear error when fallback path doesn't exist", () => {
    const cfg = stubCfg();
    expect(() => resolveConsumerRoot(cfg, "totally-missing-project")).toThrow(
      /totally-missing-project/,
    );
    expect(() => resolveConsumerRoot(cfg, "totally-missing-project")).toThrow(
      /does not exist/,
    );
  });

  it("resolveConsumerRoot throws when fallback exists but lacks required signals", () => {
    const projDir = join(scratchBase, "empty-project");
    mkdirSync(projDir, { recursive: true });
    const cfg = stubCfg();
    expect(() => resolveConsumerRoot(cfg, "empty-project")).toThrow(
      /missing all of the required signals/,
    );
    expect(() => resolveConsumerRoot(cfg, "empty-project")).toThrow(/\.claude/);
    expect(() => resolveConsumerRoot(cfg, "empty-project")).toThrow(/AGENTS\.md/);
    expect(() => resolveConsumerRoot(cfg, "empty-project")).toThrow(/CLAUDE\.md/);
  });

  it("Factory.scaffold resolves new kebab-case slug via fallback path", () => {
    const projDir = join(scratchBase, "rlm-platform");
    mkdirSync(join(projDir, ".claude"), { recursive: true });
    const cfg = stubCfg();
    const factory = new Factory(cfg);
    const draft = factory.scaffold({ kind: "agent", slug: "test-agent", project: "rlm-platform" });
    expect(draft.target_path).toContain("rlm-platform");
    expect(draft.project).toBe("rlm-platform");
  });

  it("Factory.scaffold throws a clear error for an unconfigured + non-existent slug", () => {
    const cfg = stubCfg();
    const factory = new Factory(cfg);
    expect(() =>
      factory.scaffold({ kind: "agent", slug: "x", project: "still-totally-missing" }),
    ).toThrow(/still-totally-missing/);
  });
});
