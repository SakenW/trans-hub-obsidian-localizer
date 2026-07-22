import type { LocalPackKey, ScopeAwarePackStore } from "@trans-hub/translation-export-client";
import { normalizePath, type Vault } from "obsidian";

import { sha256Hex } from "./identity";

export class ObsidianTranslationPackStore implements ScopeAwarePackStore {
  readonly #cacheDirectory: string;

  constructor(
    private readonly vault: Vault,
    pluginId: string,
  ) {
    this.#cacheDirectory = normalizePath(
      `${vault.configDir}/plugins/${pluginId}/translation-cache`,
    );
  }

  async getVerified(key: LocalPackKey): Promise<Uint8Array | undefined> {
    const path = await this.#path(key);
    if (!(await this.vault.adapter.exists(path))) return undefined;
    return new Uint8Array(await this.vault.adapter.readBinary(path));
  }

  async putVerified(key: LocalPackKey, bytes: Uint8Array): Promise<void> {
    await this.#ensureDirectory();
    const path = await this.#path(key);
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    await this.vault.adapter.writeBinary(temporary, buffer);
    try {
      if (await this.vault.adapter.exists(path)) await this.vault.adapter.remove(path);
      await this.vault.adapter.rename(temporary, path);
    } catch (error) {
      if (await this.vault.adapter.exists(temporary)) await this.vault.adapter.remove(temporary);
      throw error;
    }
  }

  async removeVerified(key: LocalPackKey): Promise<void> {
    const path = await this.#path(key);
    if (await this.vault.adapter.exists(path)) await this.vault.adapter.remove(path);
  }

  async #path(key: LocalPackKey): Promise<string> {
    const digest = await sha256Hex([
      key.scopeKey,
      key.logicalObjectDigest,
      key.objectVersion,
    ].join("\u0000"));
    return normalizePath(`${this.#cacheDirectory}/${digest}.zst`);
  }

  async #ensureDirectory(): Promise<void> {
    if (!(await this.vault.adapter.exists(this.#cacheDirectory))) {
      await this.vault.adapter.mkdir(this.#cacheDirectory);
    }
  }
}
