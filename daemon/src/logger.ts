import pino, { type Logger } from "pino";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export function makeLogger(logsDir: string): Logger {
  mkdirSync(logsDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  // Write directly to the log file via pino.destination() rather than the
  // worker-thread `transport: { target: "pino/file" }` form. The worker
  // transport (thread-stream + atomic-sleep) can block the main thread on
  // Atomics.wait during boot; a fail-closed governance daemon must never let
  // logging stall the MCP transport. Same file / level / base fields.
  return pino(
    {
      level: process.env["AGENTSMITH_LOG_LEVEL"] ?? "info",
      base: { service: "agentsmith" },
    },
    pino.destination({
      dest: join(logsDir, `agentsmith-${stamp}.log`),
      mkdir: true,
      sync: false,
    }),
  );
}
