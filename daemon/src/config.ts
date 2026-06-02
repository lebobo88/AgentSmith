import { homedir } from "node:os";
import { join } from "node:path";
import { repoRootDefault, siblingsBaseDefault } from "./paths.js";

export interface AgentSmithConfig {
  agentsmithHome: string;
  statePath: string;
  decisionsPath: string;
  quarantineDir: string;
  registryCachePath: string;
  logsDir: string;
  constitutionPath: string;
  consumerRoots: Record<string, string>;
  replicationQuotaPerScope: number;
  keymakerScanBudgetMs: number;
  inspectorBudgetMs: number;
}

export function loadConfig(): AgentSmithConfig {
  const home = process.env["AGENTSMITH_HOME"] ?? join(homedir(), ".agentsmith");
  const repoRoot = process.env["AGENTSMITH_REPO"] ?? repoRootDefault();
  // Sibling projects live adjacent to the clone (same parent), overridable by env.
  const consumerBase = process.env["AGENTSMITH_CONSUMER_BASE"] ?? siblingsBaseDefault();
  const sibling = (name: string) => join(consumerBase, name).replace(/\\/g, "/");

  return {
    agentsmithHome: home,
    statePath: join(home, "state.db"),
    decisionsPath: join(home, "decisions.jsonl"),
    quarantineDir: join(home, "quarantine"),
    registryCachePath: join(home, "registry-cache.json"),
    logsDir: join(home, "logs"),
    constitutionPath: join(repoRoot, "daemon", "src", "constitution", "smith-constitution.md"),
    consumerRoots: {
      hydra: sibling("Hydra"),
      eights: sibling("TheEights"),
      executiveSuite: sibling("ExecutiveSuite"),
      marketBliss: sibling("MarketBliss"),
      rlmCreative: sibling("RLM-Creative"),
      pairProgrammer: sibling("pair-programmer"),
      agentSmith: repoRoot,
    },
    replicationQuotaPerScope: Number(process.env["AGENTSMITH_REPLICATION_QUOTA"] ?? 4),
    keymakerScanBudgetMs: 500,
    inspectorBudgetMs: 200,
  };
}
