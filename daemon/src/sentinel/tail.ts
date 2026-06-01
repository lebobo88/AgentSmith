import { existsSync, statSync, openSync, readSync, closeSync, watch, type FSWatcher } from "node:fs";

/**
 * Tail a JSONL file: emit each newly appended line as a parsed JSON record.
 *
 * Resilient to:
 *  - file not yet existing (polls until it appears)
 *  - truncation (offset > size triggers reset to 0)
 *  - rotation (inode/size jump — reset and re-read from start of the new file)
 *  - malformed lines (skipped, never throws into the hot path)
 *
 * `opts.seekToEnd` (default false): when true, the initial attach seeds the
 * read offset to the file's *current* size instead of 0, so pre-existing
 * historical content is NOT replayed (true `tail -f` semantics). Only bytes
 * appended after attach are emitted. This is essential for boot safety: a
 * sentinel attaching to a multi-hundred-MB event log must not read+parse the
 * whole file synchronously on the event loop. The size is captured BEFORE the
 * watcher is wired so bytes appended during attach are still consumed.
 */
export function tailJsonlFile(
  path: string,
  onLine: (record: unknown) => void,
  opts: { seekToEnd?: boolean } = {}
): { stop: () => void } {
  const seekToEnd = opts.seekToEnd ?? false;
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
      // Capture size BEFORE wiring the watcher so any bytes appended between
      // this measurement and the first watcher fire are still consumed by the
      // readNew() below (no append-during-attach gap).
      let startOffset = 0;
      if (seekToEnd) {
        try {
          startOffset = statSync(path).size;
        } catch {
          startOffset = 0;
        }
      }
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
      // Seed the offset: from current EOF (seekToEnd — skip pre-existing
      // history) or from 0 (replay current contents). readNew() then consumes
      // everything past startOffset, including bytes appended during attach.
      offset = startOffset;
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
