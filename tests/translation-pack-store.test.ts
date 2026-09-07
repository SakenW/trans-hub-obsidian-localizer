import type { LocalPackKey } from "@trans-hub/translation-export-client";
import type { Vault } from "obsidian";
import { describe, expect, it } from "vitest";

import { ObsidianTranslationPackStore } from "../src/translation-pack-store";

const KEY: LocalPackKey = {
  scopeKey: "public:scope-1",
  logicalObjectDigest: `sha256:${"1".repeat(64)}`,
  objectVersion: "object-1",
};
const SECOND_KEY: LocalPackKey = {
  ...KEY,
  objectVersion: "object-2",
};
const THIRD_KEY: LocalPackKey = {
  ...KEY,
  objectVersion: "object-3",
};

describe("ObsidianTranslationPackStore", () => {
  it.each(["write", "rename"] as const)("keeps committed packs readable after a journal %s failure and reload", async (stage) => {
    const adapter = new BinaryAdapter();
    const store = new ObsidianTranslationPackStore(vault(adapter), "localizer");
    await store.putVerifiedBatch([
      { key: KEY, bytes: new Uint8Array([1]) },
      { key: SECOND_KEY, bytes: new Uint8Array([2]) },
    ]);
    adapter.failJournalAt = stage;

    await expect(store.putVerifiedBatch([
      { key: KEY, bytes: new Uint8Array([3]) },
      { key: SECOND_KEY, bytes: new Uint8Array([4]) },
    ])).rejects.toThrow("fixture_journal_failed");

    const reloaded = new ObsidianTranslationPackStore(vault(adapter), "localizer");
    await expect(reloaded.getVerified(KEY)).resolves.toEqual(new Uint8Array([1]));
    await expect(reloaded.getVerified(SECOND_KEY)).resolves.toEqual(new Uint8Array([2]));
    expect([...adapter.files.keys()].some((path) => path.includes("batch-rollback"))).toBe(false);
  });

  it("restores the previous verified cache when installing the replacement fails", async () => {
    const adapter = new BinaryAdapter();
    const store = new ObsidianTranslationPackStore(vault(adapter), "localizer");
    await store.putVerified(KEY, new Uint8Array([1, 2, 3]));
    adapter.failNextTemporaryInstall = true;

    await expect(store.putVerified(KEY, new Uint8Array([4, 5, 6])))
      .rejects.toThrow("fixture_rename_failed");
    await expect(store.getVerified(KEY)).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect([...adapter.files.keys()].some((path) => path.endsWith(".previous"))).toBe(false);
  });

  it("serializes concurrent replacements so readers observe a complete verified value", async () => {
    const adapter = new BinaryAdapter();
    const store = new ObsidianTranslationPackStore(vault(adapter), "localizer");
    await store.putVerified(KEY, new Uint8Array([1]));

    const first = store.putVerified(KEY, new Uint8Array([2]));
    const second = store.putVerified(KEY, new Uint8Array([3]));
    const read = store.getVerified(KEY);
    await expect(Promise.all([first, second, read])).resolves.toEqual([
      undefined,
      undefined,
      new Uint8Array([3]),
    ]);
    expect([...adapter.files.keys()].filter((path) => path.endsWith(".json"))).toHaveLength(1);
    expect([...adapter.files.keys()].some((path) => path.endsWith(".previous"))).toBe(false);
  });

  it("rolls back the whole batch when installing a later pack fails", async () => {
    const adapter = new BinaryAdapter();
    const store = new ObsidianTranslationPackStore(vault(adapter), "localizer");
    await store.putVerifiedBatch([
      { key: KEY, bytes: new Uint8Array([1]) },
      { key: SECOND_KEY, bytes: new Uint8Array([2]) },
    ]);
    adapter.temporaryInstallCount = 0;
    adapter.failTemporaryInstallAt = 2;

    await expect(store.putVerifiedBatch([
      { key: KEY, bytes: new Uint8Array([3]) },
      { key: SECOND_KEY, bytes: new Uint8Array([4]) },
    ])).rejects.toThrow("fixture_rename_failed");
    await expect(store.getVerified(KEY)).resolves.toEqual(new Uint8Array([1]));
    await expect(store.getVerified(SECOND_KEY)).resolves.toEqual(new Uint8Array([2]));
  });

  it("leaves no new cache entries when a later install in a fresh batch fails", async () => {
    const adapter = new BinaryAdapter();
    const store = new ObsidianTranslationPackStore(vault(adapter), "localizer");
    adapter.failTemporaryInstallAt = 2;

    await expect(store.putVerifiedBatch([
      { key: KEY, bytes: new Uint8Array([1]) },
      { key: SECOND_KEY, bytes: new Uint8Array([2]) },
    ])).rejects.toThrow("fixture_rename_failed");
    await expect(store.getVerified(KEY)).resolves.toBeUndefined();
    await expect(store.getVerified(SECOND_KEY)).resolves.toBeUndefined();
    expect(adapter.files.size).toBe(0);
  });

  it("continues multi-item rollback and preserves recovery evidence when rollback I/O also fails", async () => {
    const adapter = new BinaryAdapter();
    const store = new ObsidianTranslationPackStore(vault(adapter), "localizer");
    await store.putVerifiedBatch([
      { key: KEY, bytes: new Uint8Array([1]) },
      { key: SECOND_KEY, bytes: new Uint8Array([2]) },
      { key: THIRD_KEY, bytes: new Uint8Array([3]) },
    ]);
    adapter.temporaryInstallCount = 0;
    adapter.failTemporaryInstallAt = 3;
    adapter.failRollbackRemoveValue = 5;
    adapter.failBackupRestoreValue = 1;

    await expect(store.putVerifiedBatch([
      { key: KEY, bytes: new Uint8Array([4]) },
      { key: SECOND_KEY, bytes: new Uint8Array([5]) },
      { key: THIRD_KEY, bytes: new Uint8Array([6]) },
    ])).rejects.toThrow("translation_pack_batch_rollback_incomplete:fixture_rename_failed");

    const entriesAfterFailure = [...adapter.files.entries()];
    expect(entriesAfterFailure.some(([path, bytes]) => (
      path.endsWith(".json") && new Uint8Array(bytes)[0] === 3
    ))).toBe(true);
    expect(entriesAfterFailure.some(([path, bytes]) => (
      path.endsWith(".previous") && new Uint8Array(bytes)[0] === 1
    ))).toBe(true);
    expect(entriesAfterFailure.some(([path, bytes]) => (
      path.endsWith(".previous") && new Uint8Array(bytes)[0] === 2
    ))).toBe(true);
    expect(entriesAfterFailure.some(([path]) => path.endsWith("batch-rollback.json"))).toBe(true);

    // The injected failures are one-shot. Any later access retries the whole
    // journal before reading a formal path, restoring every original value.
    await expect(store.getVerified(KEY)).resolves.toEqual(new Uint8Array([1]));
    await expect(store.getVerified(SECOND_KEY)).resolves.toEqual(new Uint8Array([2]));
    await expect(store.getVerified(THIRD_KEY)).resolves.toEqual(new Uint8Array([3]));
    expect([...adapter.files.keys()].some((path) => (
      path.endsWith(".previous") || path.endsWith("batch-rollback.json")
    ))).toBe(false);
  });

  it("keeps referenced verified packs and removes only unreferenced cache files", async () => {
    const adapter = new BinaryAdapter();
    const store = new ObsidianTranslationPackStore(vault(adapter), "localizer");
    await store.putVerified(KEY, new Uint8Array([1]));
    await store.putVerified(SECOND_KEY, new Uint8Array([2]));
    const directory = ".obsidian/plugins/localizer/translation-cache";
    const suffix = "00000000-0000-4000-8000-000000000000.tmp";
    const packPath = [...adapter.files.keys()][0];
    await adapter.writeBinary(`${packPath}.${suffix}`, new ArrayBuffer(1));
    await adapter.writeBinary(`${directory}/batch-rollback.json.${suffix}`, new ArrayBuffer(1));
    await adapter.writeBinary(`${directory}/user-notes.tmp`, new ArrayBuffer(1));

    await expect(store.pruneUnreferenced([SECOND_KEY])).resolves.toBe(3);
    await expect(store.getVerified(KEY)).resolves.toBeUndefined();
    await expect(store.getVerified(SECOND_KEY)).resolves.toEqual(new Uint8Array([2]));
    expect(adapter.files.has(`${directory}/user-notes.tmp`)).toBe(true);
  });
});

class BinaryAdapter {
  failJournalAt: "write" | "rename" | undefined;
  readonly files = new Map<string, ArrayBuffer>();
  readonly directories = new Set<string>();
  failNextTemporaryInstall = false;
  failTemporaryInstallAt: number | undefined;
  failRollbackRemoveValue: number | undefined;
  failBackupRestoreValue: number | undefined;
  temporaryInstallCount = 0;

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path) || this.directories.has(path));
  }

  readBinary(path: string): Promise<ArrayBuffer> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`missing:${path}`);
    return Promise.resolve(value.slice(0));
  }

  writeBinary(path: string, value: ArrayBuffer): Promise<void> {
    if (path.includes("batch-rollback.json") && this.failJournalAt === "write") {
      this.failJournalAt = undefined;
      this.files.set(path, value.slice(0, 8));
      throw new Error("fixture_journal_failed");
    }
    this.files.set(path, value.slice(0));
    return Promise.resolve();
  }

  remove(path: string): Promise<void> {
    const value = this.files.get(path);
    if (
      value !== undefined
      && new Uint8Array(value)[0] === this.failRollbackRemoveValue
      && this.files.has(`${path}.previous`)
    ) {
      this.failRollbackRemoveValue = undefined;
      throw new Error("fixture_rollback_remove_failed");
    }
    this.files.delete(path);
    return Promise.resolve();
  }

  rename(from: string, to: string): Promise<void> {
    if (to.endsWith("batch-rollback.json") && this.failJournalAt === "rename") {
      this.failJournalAt = undefined;
      throw new Error("fixture_journal_failed");
    }
    if (from.endsWith(".tmp") && to.endsWith(".json") && !to.endsWith("batch-rollback.json")) {
      this.temporaryInstallCount += 1;
      if (
        this.failNextTemporaryInstall
        || this.temporaryInstallCount === this.failTemporaryInstallAt
      ) {
        this.failNextTemporaryInstall = false;
        throw new Error("fixture_rename_failed");
      }
    }
    const value = this.files.get(from);
    if (
      from.endsWith(".previous")
      && value !== undefined
      && new Uint8Array(value)[0] === this.failBackupRestoreValue
    ) {
      this.failBackupRestoreValue = undefined;
      throw new Error("fixture_rollback_rename_failed");
    }
    if (value === undefined || this.files.has(to)) throw new Error(`rename_invalid:${from}:${to}`);
    this.files.delete(from);
    this.files.set(to, value);
    return Promise.resolve();
  }

  mkdir(path: string): Promise<void> {
    this.directories.add(path);
    return Promise.resolve();
  }

  list(path: string): Promise<{ files: string[]; folders: string[] }> {
    return Promise.resolve({
      files: [...this.files.keys()].filter((item) => item.startsWith(`${path}/`)),
      folders: [],
    });
  }

  rmdir(path: string): Promise<void> {
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(`${path}/`)) this.files.delete(key);
    }
    this.directories.delete(path);
    return Promise.resolve();
  }
}

function vault(adapter: BinaryAdapter): Vault {
  return { configDir: ".obsidian", adapter } as unknown as Vault;
}
