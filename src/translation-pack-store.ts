import type { LocalPackKey, ScopeAwarePackStore } from "@trans-hub/translation-export-client";
import { normalizePath, type Vault } from "obsidian";

import { sha256Hex } from "./identity";

export class ObsidianTranslationPackStore implements ScopeAwarePackStore {
  readonly #cacheDirectory: string;
  readonly #rollbackJournalPath: string;
  #operationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly vault: Vault,
    pluginId: string,
  ) {
    this.#cacheDirectory = normalizePath(
      `${vault.configDir}/plugins/${pluginId}/translation-cache`,
    );
    this.#rollbackJournalPath = normalizePath(
      `${this.#cacheDirectory}/batch-rollback.json`,
    );
  }

  async getVerified(key: LocalPackKey): Promise<Uint8Array | undefined> {
    return this.#serialized(async () => {
      const path = await this.#path(key);
      await this.#recoverPendingBatch();
      await this.#recoverStandaloneBackup(path);
      if (!(await this.vault.adapter.exists(path))) return undefined;
      return new Uint8Array(await this.vault.adapter.readBinary(path));
    });
  }

  async putVerified(key: LocalPackKey, bytes: Uint8Array): Promise<void> {
    await this.putVerifiedBatch([{ key, bytes }]);
  }

  async putVerifiedBatch(
    entries: readonly Readonly<{ key: LocalPackKey; bytes: Uint8Array }>[],
  ): Promise<void> {
    await this.#serialized(async () => {
      await this.#ensureDirectory();
      await this.#recoverPendingBatch();
      const staged: RollbackJournalEntry[] = [];
      try {
        for (const { key, bytes } of entries) {
          const path = await this.#path(key);
          await this.#recoverStandaloneBackup(path);
          const temporary = `${path}.${crypto.randomUUID()}.tmp`;
          const buffer = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer;
          await this.vault.adapter.writeBinary(temporary, buffer);
          staged.push({
            path,
            temporary,
            backup: `${path}.previous`,
            hadOriginal: await this.vault.adapter.exists(path),
          });
        }
      } catch (error) {
        await this.#removeTemporaryFilesBestEffort(staged);
        throw error;
      }
      const journal: RollbackJournal = { revision: 1, entries: staged };
      try {
        await this.#writeRollbackJournal(journal);
        for (const item of staged) {
          if (item.hadOriginal) {
            await this.vault.adapter.rename(item.path, item.backup);
          }
          await this.vault.adapter.rename(item.temporary, item.path);
        }
        // Removing the rollback journal is the batch commit point. Backups are
        // intentionally retained until after it succeeds, so a failed commit
        // can still restore every old value.
        await this.vault.adapter.remove(this.#rollbackJournalPath);
      } catch (error) {
        const rollbackErrors = await this.#rollbackBatch(journal);
        if (rollbackErrors.length > 0) {
          throw new AggregateError(
            [error, ...rollbackErrors],
            `translation_pack_batch_rollback_incomplete:${errorMessage(error)}`,
          );
        }
        throw error;
      }
      for (const item of staged) {
        if (await this.vault.adapter.exists(item.backup)) {
          try {
            await this.vault.adapter.remove(item.backup);
          } catch {
            // The new verified cache is already installed. Leaving the old
            // recovery copy is safe; the next serialized operation cleans it.
          }
        }
      }
    });
  }

  async removeVerified(key: LocalPackKey): Promise<void> {
    await this.#serialized(async () => {
      await this.#recoverPendingBatch();
      const path = await this.#path(key);
      if (await this.vault.adapter.exists(path)) await this.vault.adapter.remove(path);
      const backup = `${path}.previous`;
      if (await this.vault.adapter.exists(backup)) await this.vault.adapter.remove(backup);
    });
  }

  async clearAll(): Promise<void> {
    await this.#serialized(async () => {
      if (await this.vault.adapter.exists(this.#cacheDirectory)) {
        await this.vault.adapter.rmdir(this.#cacheDirectory, true);
      }
    });
  }

  /**
   * Retain only packs still referenced by persisted, authenticated manifests.
   * The caller supplies logical keys, never filesystem paths; journals are
   * recovered before any delete so an interrupted cache write remains
   * recoverable.
   */
  async pruneUnreferenced(keep: readonly LocalPackKey[]): Promise<number> {
    return this.#serialized(async () => {
      if (!(await this.vault.adapter.exists(this.#cacheDirectory))) return 0;
      await this.#recoverPendingBatch();
      const retained = new Set(await Promise.all(keep.map((key) => this.#path(key))));
      const listed = await this.vault.adapter.list(this.#cacheDirectory);
      let removed = 0;
      for (const path of listed.files) {
        if (!isManagedCachePath(path, this.#cacheDirectory)
          && !isManagedTemporaryPath(path, this.#cacheDirectory)) continue;
        const canonical = path.endsWith(".previous") ? path.slice(0, -".previous".length) : path;
        if (retained.has(canonical)) continue;
        await this.vault.adapter.remove(path);
        removed += 1;
      }
      return removed;
    });
  }

  async #path(key: LocalPackKey): Promise<string> {
    const digest = await sha256Hex([
      key.scopeKey,
      key.logicalObjectDigest,
      key.objectVersion,
    ].join("\u0000"));
    return normalizePath(`${this.#cacheDirectory}/${digest}.json`);
  }

  async #ensureDirectory(): Promise<void> {
    if (!(await this.vault.adapter.exists(this.#cacheDirectory))) {
      await this.vault.adapter.mkdir(this.#cacheDirectory);
    }
  }

  async #recoverStandaloneBackup(path: string): Promise<void> {
    const backup = `${path}.previous`;
    const hasPath = await this.vault.adapter.exists(path);
    if (!(await this.vault.adapter.exists(backup))) return;
    if (hasPath) {
      await this.vault.adapter.remove(backup);
      return;
    }
    await this.vault.adapter.rename(backup, path);
  }

  async #writeRollbackJournal(journal: RollbackJournal): Promise<void> {
    const bytes = new TextEncoder().encode(JSON.stringify(journal));
    const temporary = `${this.#rollbackJournalPath}.${crypto.randomUUID()}.tmp`;
    try {
      await this.vault.adapter.writeBinary(
        temporary,
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      );
      // No formal pack changes until a complete recovery journal is installed.
      await this.vault.adapter.rename(temporary, this.#rollbackJournalPath);
    } catch (error) {
      try {
        if (await this.vault.adapter.exists(temporary)) await this.vault.adapter.remove(temporary);
      } catch (cleanupError) {
        console.warn("[Trans-Hub] 无法清理未提交的缓存日志：", cleanupError);
      }
      throw error;
    }
  }

  async #recoverPendingBatch(): Promise<void> {
    if (!(await this.vault.adapter.exists(this.#rollbackJournalPath))) return;
    const bytes = new Uint8Array(
      await this.vault.adapter.readBinary(this.#rollbackJournalPath),
    );
    const journal = parseRollbackJournal(
      new TextDecoder().decode(bytes),
      this.#cacheDirectory,
    );
    const errors = await this.#rollbackBatch(journal);
    if (errors.length > 0) {
      throw new AggregateError(errors, "translation_pack_batch_recovery_incomplete");
    }
  }

  async #rollbackBatch(journal: RollbackJournal): Promise<unknown[]> {
    const errors: unknown[] = [];
    for (const item of [...journal.entries].reverse()) {
      if (item.hadOriginal) {
        await captureFailure(errors, async () => {
          if (await this.vault.adapter.exists(item.backup)) {
            if (await this.vault.adapter.exists(item.path)) {
              await this.vault.adapter.remove(item.path);
            }
            if (!(await this.vault.adapter.exists(item.path))) {
              await this.vault.adapter.rename(item.backup, item.path);
            }
          }
          if (!(await this.vault.adapter.exists(item.path))) {
            throw new Error(`translation_pack_rollback_original_missing:${item.path}`);
          }
          if (await this.vault.adapter.exists(item.backup)) {
            throw new Error(`translation_pack_rollback_backup_not_restored:${item.path}`);
          }
        });
      } else {
        await captureFailure(errors, async () => {
          if (await this.vault.adapter.exists(item.path)) {
            await this.vault.adapter.remove(item.path);
          }
          if (await this.vault.adapter.exists(item.path)) {
            throw new Error(`translation_pack_rollback_new_value_present:${item.path}`);
          }
        });
      }
      await captureFailure(errors, async () => {
        if (await this.vault.adapter.exists(item.temporary)) {
          await this.vault.adapter.remove(item.temporary);
        }
      });
    }
    if (errors.length === 0) {
      await captureFailure(errors, async () => {
        if (await this.vault.adapter.exists(this.#rollbackJournalPath)) {
          await this.vault.adapter.remove(this.#rollbackJournalPath);
        }
      });
    }
    return errors;
  }

  async #removeTemporaryFilesBestEffort(
    entries: readonly RollbackJournalEntry[],
  ): Promise<void> {
    for (const item of entries) {
      try {
        if (await this.vault.adapter.exists(item.temporary)) {
          await this.vault.adapter.remove(item.temporary);
        }
      } catch {
        // No formal cache path was changed and no rollback evidence exists.
        // A uniquely named temporary file is inert and may be removed later.
      }
    }
  }

  #serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operationTail.then(operation, operation);
    this.#operationTail = result.then(() => undefined, () => undefined);
    return result;
  }
}

interface RollbackJournalEntry {
  readonly path: string;
  readonly temporary: string;
  readonly backup: string;
  readonly hadOriginal: boolean;
}

interface RollbackJournal {
  readonly revision: 1;
  readonly entries: readonly RollbackJournalEntry[];
}

async function captureFailure(
  errors: unknown[],
  operation: () => Promise<void>,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    errors.push(error);
  }
}

function parseRollbackJournal(raw: string, cacheDirectory: string): RollbackJournal {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("translation_pack_rollback_journal_invalid");
  }
  if (!isRecord(value) || value.revision !== 1 || !Array.isArray(value.entries)) {
    throw new Error("translation_pack_rollback_journal_invalid");
  }
  const entries = value.entries.map((entry): RollbackJournalEntry => {
    if (!isRecord(entry) || typeof entry.hadOriginal !== "boolean") {
      throw new Error("translation_pack_rollback_journal_invalid");
    }
    const path = requiredJournalPath(entry.path, cacheDirectory, ".json");
    const backup = requiredJournalPath(entry.backup, cacheDirectory, ".json.previous");
    const temporary = requiredJournalPath(entry.temporary, cacheDirectory, ".tmp");
    if (backup !== `${path}.previous` || !temporary.startsWith(`${path}.`)) {
      throw new Error("translation_pack_rollback_journal_invalid");
    }
    return { path, backup, temporary, hadOriginal: entry.hadOriginal };
  });
  return { revision: 1, entries };
}

function requiredJournalPath(value: unknown, cacheDirectory: string, suffix: string): string {
  if (
    typeof value !== "string"
    || !value.startsWith(`${cacheDirectory}/`)
    || !value.endsWith(suffix)
    || value.includes("..")
  ) {
    throw new Error("translation_pack_rollback_journal_invalid");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}

function isManagedCachePath(path: string, cacheDirectory: string): boolean {
  return new RegExp(`^${escapeRegExp(cacheDirectory)}/[0-9a-f]{64}\\.json(?:\\.previous)?$`, "u")
    .test(path);
}

function isManagedTemporaryPath(path: string, cacheDirectory: string): boolean {
  return new RegExp(`^${escapeRegExp(cacheDirectory)}/(?:[0-9a-f]{64}|batch-rollback)\\.json\\.[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\\.tmp$`, "u")
    .test(path);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
