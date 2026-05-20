import { existsSync, statSync, openSync, readSync, closeSync, watch, type FSWatcher } from "node:fs";

/**
 * Tail a JSONL file: emit each newly appended line as a parsed JSON record.
 *
 * Resilient to:
 *  - file not yet existing (polls until it appears)
 *  - truncation (offset > size triggers reset to 0)
 *  - rotation (inode/size jump — reset and re-read from start of the new file)
 *  - malformed lines (skipped, never throws into the hot path)
 */
export function tailJsonlFile(
  path: string,
  onLine: (record: unknown) => void
): { stop: () => void } {
  let offset = 0;
  let buffer = "";
  let watcher: FSWatcher | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  let stopped = false;

  const readNew = (): void => {
    if (stopped) return;
    if (!existsSync(path)) return;
    let st;
    try {
      st = statSync(path);
    } catch {
      return;
    }
    if (st.size < offset) {
      // truncation / rotation — start over
      offset = 0;
      buffer = "";
    }
    if (st.size === offset) return;
    let fd: number;
    try {
      fd = openSync(path, "r");
    } catch {
      return;
    }
    try {
      const len = st.size - offset;
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, offset);
      offset = st.size;
      buffer += buf.toString("utf8");
      let nlIdx = buffer.indexOf("\n");
      while (nlIdx !== -1) {
        const line = buffer.slice(0, nlIdx).replace(/\r$/, "");
        buffer = buffer.slice(nlIdx + 1);
        if (line.length > 0) {
          try {
            const rec = JSON.parse(line);
            try {
              onLine(rec);
            } catch {
              // handler must not break the tail
            }
          } catch {
            // malformed JSON line — skip
          }
        }
        nlIdx = buffer.indexOf("\n");
      }
    } catch {
      // best-effort
    } finally {
      try {
        closeSync(fd);
      } catch {
        /* noop */
      }
    }
  };

  const tryAttachWatcher = (): void => {
    if (stopped || watcher) return;
    if (!existsSync(path)) return;
    try {
      watcher = watch(path, { persistent: false }, () => {
        readNew();
      });
      watcher.on("error", () => {
        try {
          watcher?.close();
        } catch {
          /* noop */
        }
        watcher = null;
      });
      // initial read of current contents — start from 0
      offset = 0;
      buffer = "";
      readNew();
    } catch {
      watcher = null;
    }
  };

  // Poll loop: re-attaches watcher if file appears/rotates, and serves as fallback
  // for filesystems where fs.watch under-reports (Windows network shares, etc.).
  pollTimer = setInterval(() => {
    if (stopped) return;
    if (!watcher) tryAttachWatcher();
    else readNew();
  }, 1000);

  tryAttachWatcher();

  return {
    stop: () => {
      stopped = true;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (watcher) {
        try {
          watcher.close();
        } catch {
          /* noop */
        }
        watcher = null;
      }
    },
  };
}
