import { nanoid } from "nanoid";
import type { SmithClone, ReplicationQuota } from "../schemas/replication.js";
import type { AgentSmithConfig } from "../config.js";

/**
 * In-memory replication controller. Persists to SQLite in Phase 3.
 * Enforces invariant N5: replication is capped per scope.
 */
export class ReplicationController {
  private clones = new Map<string, SmithClone>();
  private quotas = new Map<string, ReplicationQuota>();

  constructor(private cfg: AgentSmithConfig) {}

  spawn(scope: string, reason: string): SmithClone {
    const quota = this.ensureQuota(scope);
    if (quota.active >= quota.max_clones) {
      throw new Error(`replication-capped: scope=${scope} active=${quota.active} max=${quota.max_clones} (N5)`);
    }
    const clone: SmithClone = {
      clone_id: `clone_${nanoid(8)}`,
      parent_scope: scope,
      spawned_for: reason,
      spawned_at: new Date().toISOString(),
      active: true,
    };
    this.clones.set(clone.clone_id, clone);
    quota.active += 1;
    quota.reason_last_spawn = reason;
    quota.last_changed_at = clone.spawned_at;
    return clone;
  }

  teardown(clone_id: string): void {
    const clone = this.clones.get(clone_id);
    if (!clone || !clone.active) return;
    clone.active = false;
    clone.torn_down_at = new Date().toISOString();
    const quota = this.quotas.get(clone.parent_scope);
    if (quota && quota.active > 0) {
      quota.active -= 1;
      quota.last_changed_at = clone.torn_down_at;
    }
  }

  list(): SmithClone[] {
    return Array.from(this.clones.values()).filter((c) => c.active);
  }

  quota(scope: string): ReplicationQuota {
    return this.ensureQuota(scope);
  }

  private ensureQuota(scope: string): ReplicationQuota {
    let q = this.quotas.get(scope);
    if (!q) {
      q = {
        scope,
        max_clones: this.cfg.replicationQuotaPerScope,
        active: 0,
        last_changed_at: new Date().toISOString(),
      };
      this.quotas.set(scope, q);
    }
    return q;
  }
}
