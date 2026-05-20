export { Watcher, type AnomalyHandler } from "./watcher.js";
export { Classifier } from "./classifier.js";
export { ReplicationController } from "./replication-controller.js";
export { detectDrift, type DriftReport } from "./drift.js";
export { SIGNATURES } from "./signatures.js";
export { tailJsonlFile } from "./tail.js";
export { startHydraTail, type HydraTailOptions } from "./hydra-tail.js";
export { startEightsTail, type EightsTailOptions } from "./eights-tail.js";

import type { AnomalySignature } from "../schemas/anomaly.js";
import { SIGNATURES } from "./signatures.js";

export function loadDefaultSignatures(): AnomalySignature[] {
  return SIGNATURES.slice();
}
