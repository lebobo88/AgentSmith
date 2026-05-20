import { z } from "zod";

export const AnomalySeveritySchema = z.enum(["info", "low", "medium", "high", "critical"]);
export type AnomalySeverity = z.infer<typeof AnomalySeveritySchema>;

export const AnomalySignatureSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  severity: AnomalySeveritySchema,
  related_invariant: z.string().optional(),
  match: z.object({
    source: z.enum(["hydra.telemetry", "eights.observability", "agentsmith.internal"]),
    pattern: z.string(),
    window_seconds: z.number().int().positive().optional(),
    threshold: z.number().optional(),
  }),
  mitigation: z.string(),
});
export type AnomalySignature = z.infer<typeof AnomalySignatureSchema>;

export const AnomalyEventSchema = z.object({
  event_id: z.string(),
  signature_id: z.string().optional(),
  severity: AnomalySeveritySchema,
  source: z.string(),
  payload_summary: z.string(),
  observed_at: z.string().datetime(),
  scope: z.string().optional(),
});
export type AnomalyEvent = z.infer<typeof AnomalyEventSchema>;
