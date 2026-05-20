import type { AnomalyEvent, AnomalySignature } from "../schemas/anomaly.js";

/**
 * Phase 0 classifier: signature-table match by event source + payload regex.
 * Phase 3 will swap in a learned classifier with TheEights miner integration.
 */
export class Classifier {
  private signatures: AnomalySignature[] = [];

  loadSignatures(sigs: AnomalySignature[]): void {
    this.signatures = sigs;
  }

  classify(event: AnomalyEvent): { matched: AnomalySignature | null; confidence: number } {
    for (const sig of this.signatures) {
      if (sig.match.source !== event.source) continue;
      try {
        const re = new RegExp(sig.match.pattern);
        if (re.test(event.payload_summary)) {
          return { matched: sig, confidence: 1.0 };
        }
      } catch {
        // skip malformed pattern
      }
    }
    return { matched: null, confidence: 0 };
  }
}
