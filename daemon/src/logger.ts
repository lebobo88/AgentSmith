import pino, { type Logger } from "pino";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export function makeLogger(logsDir: string): Logger {
  mkdirSync(logsDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  return pino({
    level: process.env["AGENTSMITH_LOG_LEVEL"] ?? "info",
    base: { service: "agentsmith" },
    transport: {
      target: "pino/file",
      options: { destination: join(logsDir, `agentsmith-${stamp}.log`), mkdir: true },
    },
  });
}
