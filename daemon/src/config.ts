import { homedir } from "node:os";
import { join } from "node:path";

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
  const repoRoot = process.env["AGENTSMITH_REPO"] ?? "C:/AiAppDeployments/AgentSmith";

  return {
    agentsmithHome: home,
    statePath: join(home, "state.db"),
    decisionsPath: join(home, "decisions.jsonl"),
    quarantineDir: join(home, "quarantine"),
    registryCachePath: join(home, "registry-cache.json"),
    logsDir: join(home, "logs"),
    constitutionPath: join(repoRoot, "daemon", "src", "constitution", "smith-constitution.md"),
    consumerRoots: {
      hydra: "C:/AiAppDeployments/Hydra",
      eights: "C:/AiAppDeployments/TheEights",
      executiveSuite: "C:/AiAppDeployments/ExecutiveSuite",
      marketBliss: "C:/AiAppDeployments/MarketBliss",
      rlmCreative: "C:/AiAppDeployments/RLM-Creative",
      pairProgrammer: "C:/AiAppDeployments/pair-programmer",
      agentSmith: repoRoot,
    },
    replicationQuotaPerScope: Number(process.env["AGENTSMITH_REPLICATION_QUOTA"] ?? 4),
    keymakerScanBudgetMs: 500,
    inspectorBudgetMs: 200,
  };
}
