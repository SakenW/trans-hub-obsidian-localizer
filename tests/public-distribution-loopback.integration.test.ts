import { createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from "node:crypto";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { clearTimeout as clearNodeTimeout, setTimeout as setNodeTimeout } from "node:timers";

import {
  canonicalJson,
  parseTranslationExportManifest,
  type CanonicalJsonTranslationExportManifest,
  type TranslationSyncState,
} from "@trans-hub/translation-export-client";
import { NodeEd25519ManifestVerifier } from "@trans-hub/translation-export-client/node";
import type { App, Vault } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ObsidianHttpTransport } from "../src/http-transport";
import type { ActivationStore } from "../src/activation";
import { PluginAutomationController } from "../src/plugin-automation";
import { EMPTY_PLUGIN_STATE, setPluginTranslation, type PluginState } from "../src/plugin-state";
import {
  loadPublishedEcosystemCatalog,
  resolvePublishedPluginArtifactDigestFromCatalog,
  resolvePublishedPluginSourceFromCatalog,
} from "../src/plugin-source-resolution";
import { validatePluginTranslations } from "../src/plugin-sync";
import { ObsidianTranslationPackStore } from "../src/translation-pack-store";
import { synchronizeConfiguredPluginTranslations } from "../src/plugin-sync";
import {
  CANONICAL_OCCURRENCE_JSON_RENDERER_PROFILE,
  downloadPluginTranslations,
} from "../src/translation-sync";
import { resetRequestUrlHandler, setRequestUrlHandler } from "./obsidian-mock";

vi.mock("../src/plugin-source-resolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/plugin-source-resolution")>();
  return {
    ...actual,
    loadPublishedEcosystemCatalog: vi.fn(),
    resolvePublishedPluginArtifactDigestFromCatalog: vi.fn(),
    resolvePublishedPluginSourceFromCatalog: vi.fn(),
  };
});

beforeEach(() => {
  vi.mocked(loadPublishedEcosystemCatalog).mockResolvedValue({ objects: [] });
  vi.mocked(resolvePublishedPluginArtifactDigestFromCatalog).mockReturnValue("a".repeat(64));
  vi.mocked(resolvePublishedPluginSourceFromCatalog).mockReturnValue({
      sourceVersionId: "source-version-current",
      objectVersionId: "source-object-current",
      authorityPluginVersion: "1.0.0",
      artifactDigest: "a".repeat(64),
      catalogIdentityExact: true,
      sourceUnitCount: 1,
      upstreamNativeCount: 0,
      upstreamScopedNativeCount: 0,
      upstreamScopeCoverage: {},
      publishedUnitCount: 1,
      missingUnitCount: 0,
    });
});

const NOW = Date.parse("2026-08-31T00:00:00Z");
const PLUGIN_ID = "sample-plugin";
const SOURCE_VERSION_ID = "source-version-current";
const STRING_KEY = "a".repeat(32);
const MANIFEST_DIGEST = `sha256:${"11".repeat(32)}`;

type FailureMode =
  | "expired-ticket"
  | "generation-conflict"
  | "generation-rollback"
  | "immutable-ticket"
  | "object-version"
  | "origin"
  | "pack-hash"
  | "redirect"
  | "signature"
  | "size"
  | "stale-source"
  | "ticket-window-299"
  | "ticket-window-301";

afterEach(() => {
  resetRequestUrlHandler();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Obsidian public distribution loopback component integration", () => {
  for (const mode of [undefined, "redirect"] as const) {
    it(`runs the production synchronization entry ${mode === undefined ? "through apply" : "without applying redirected bytes"}`, async () => {
      await withFixture({ ...(mode === undefined ? {} : { mode }) }, async (fixture) => {
        let state: PluginState = {
          ...EMPTY_PLUGIN_STATE,
          enabledPluginIds: [PLUGIN_ID],
          pluginCatalogs: { [PLUGIN_ID]: catalogFixture() },
        };
        const save = vi.fn().mockResolvedValue(undefined);
        const errorLog = mode === "redirect"
          ? vi.spyOn(console, "error").mockImplementation(() => {})
          : undefined;
        const summary = await synchronizeConfiguredPluginTranslations({
          apiBaseUrl: fixture.origin,
          targetLocale: "zh-CN",
          excludedPluginIds: [],
          sourceSelectablePluginIds: [PLUGIN_ID],
          activationStore: activationStoreFixture(),
          translationPackStore: new ObsidianTranslationPackStore(
            vaultFixture(fixture.adapter),
            "trans-hub-plugin-localizer",
          ),
          getState: () => state,
          replaceState: (value) => { state = value; },
          save,
        });
        const host = runtimeHostFixture("Settings");
        const controller = new PluginAutomationController({
          app: host.app,
          ownPluginId: "trans-hub-plugin-localizer",
          settings: () => ({
            targetLocale: "zh-CN", pluginTranslationEnabled: true,
            pluginMetadataTranslationEnabled: false,
            thirdPartyFilePatchingEnabled: false, excludedPluginIds: [],
          }),
          state: () => state,
          replaceState: (value) => { state = value; },
          save: async () => {},
          synchronize: () => Promise.resolve(summary),
        });
        controller.start();
        controller.applyCachedTranslations();
        if (mode === undefined) {
          expect(summary.failedPluginIds ?? []).toEqual([]);
          expect(host.text.data).toBe("设置");
          expect([...fixture.adapter.files.keys()].filter(
            (path) => /translation-cache\/[0-9a-f]{64}\.json$/u.test(path),
          )).toHaveLength(1);
        } else {
          expect(summary.failedPluginIds).toEqual([PLUGIN_ID]);
          expect(errorLog).toHaveBeenCalledWith(
            expect.stringContaining(`${PLUGIN_ID} sync failed`),
            expect.objectContaining({ message: "translation_pack_redirect_or_network_rejected" }),
          );
          expect(host.text.data).toBe("Settings");
          expect(fixture.adapter.writtenPaths).toEqual([]);
        }
        controller.stop();
      });
    });
  }

  it("verifies signed revision 3 bytes over loopback and applies then restores exact runtime text", async () => {
    await withFixture({}, async (fixture) => {
      const output = await fixture.download();
      expect(output.manifest.revision).toBe(3);
      expect(output.rows).toEqual([{
        pluginId: PLUGIN_ID,
        stringKey: STRING_KEY,
        translatedText: "设置",
      }]);
      expect(fixture.ticketLifetimeMs).toBe(300_000);
      expect(fixture.packRequests).toBe(1);
      const cachedPaths = [...fixture.adapter.files.keys()].filter(
        (path) => /translation-cache\/[0-9a-f]{64}\.json$/u.test(path),
      );
      expect(cachedPaths).toHaveLength(1);
      expect(fixture.adapter.writtenPaths.some((path) => path.endsWith("/manifest.json"))).toBe(false);
      expect(CANONICAL_OCCURRENCE_JSON_RENDERER_PROFILE).toEqual({
        key: "canonical-occurrence-json",
        revision: 1,
      });

      const dictionary = validatePluginTranslations(
        catalogFixture(),
        output.rows,
        SOURCE_VERSION_ID,
        "zh-CN",
      );
      let state: PluginState = setPluginTranslation({
        ...EMPTY_PLUGIN_STATE,
        enabledPluginIds: [PLUGIN_ID],
        pluginCatalogs: { [PLUGIN_ID]: catalogFixture() },
      }, PLUGIN_ID, "zh-CN", dictionary);
      let enabled = true;
      const host = runtimeHostFixture("Settings");
      const controller = new PluginAutomationController({
        app: host.app,
        ownPluginId: "trans-hub-plugin-localizer",
        settings: () => ({
          targetLocale: "zh-CN",
          pluginTranslationEnabled: enabled,
          pluginMetadataTranslationEnabled: false,
          thirdPartyFilePatchingEnabled: false,
          excludedPluginIds: [],
        }),
        state: () => state,
        replaceState: (value) => { state = value; },
        save: async () => {},
        synchronize: () => Promise.resolve({
          processedPluginIds: [], failures: [], submittedCount: 0,
          requestedCount: 0, pulledCount: 0, waitingCount: 0,
          translationCount: 0,
        }),
      });

      controller.start();
      controller.applyCachedTranslations();
      expect(host.text.data).toBe("设置");

      enabled = false;
      controller.applyCachedTranslations();
      expect(host.text.data).toBe("Settings");
      controller.stop();
    });
  });

  for (const [mode, code] of [
    ["stale-source", "translation_manifest_request_mismatch"],
    ["signature", "translation_manifest_signature_invalid"],
    ["pack-hash", "translation_pack_content_digest_mismatch"],
    ["origin", "translation_ticket_url_invalid"],
    ["object-version", "translation_ticket_version_mismatch"],
    ["size", "translation_pack_download_size_mismatch"],
    ["expired-ticket", "translation_ticket_expired"],
    ["immutable-ticket", "translation_public_ticket_invalid"],
    ["ticket-window-299", "translation_public_ticket_window_invalid"],
    ["ticket-window-301", "translation_public_ticket_window_invalid"],
    ["redirect", "translation_pack_redirect_or_network_rejected"],
    ["generation-rollback", "translation_manifest_generation_rollback"],
    ["generation-conflict", "translation_manifest_generation_conflict"],
  ] as const) {
    it(`fails closed without cache or apply for ${mode}`, async () => {
      await withFixture({ mode }, async (fixture) => {
        const host = runtimeHostFixture("Settings");
        let state = EMPTY_PLUGIN_STATE;
        const controller = new PluginAutomationController({
          app: host.app,
          ownPluginId: "trans-hub-plugin-localizer",
          settings: () => ({
            targetLocale: "zh-CN", pluginTranslationEnabled: true,
            pluginMetadataTranslationEnabled: false,
            thirdPartyFilePatchingEnabled: false, excludedPluginIds: [],
          }),
          state: () => state,
          replaceState: (value) => { state = value; },
          save: async () => {},
          synchronize: () => Promise.reject(new Error("not_used")),
        });
        await expect((async () => {
          const output = await fixture.download();
          state = setPluginTranslation(
            state,
            PLUGIN_ID,
            "zh-CN",
            validatePluginTranslations(catalogFixture(), output.rows, SOURCE_VERSION_ID, "zh-CN"),
          );
          controller.applyCachedTranslations();
        })()).rejects.toThrow(code);
        expect(host.text.data).toBe("Settings");
        expect(fixture.adapter.writtenPaths).toEqual([]);
        expect(fixture.adapter.files.size).toBe(0);
        controller.stop();
      });
    });
  }
});

async function withFixture(
  options: Readonly<{ mode?: FailureMode }>,
  run: (fixture: Awaited<ReturnType<typeof startFixture>>) => Promise<void>,
): Promise<void> {
  const fixture = await startFixture(options);
  try {
    await run(fixture);
  } finally {
    await closeServer(fixture.server);
  }
}

async function startFixture(options: Readonly<{ mode?: FailureMode }>) {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  const keys = fixtureKeyPair();
  const adapter = new RecordingVaultAdapter();
  const pack = translationPackBytes();
  let packRequests = 0;
  let origin = "";
  const responseState: {
    currentWire?: ReturnType<typeof signedManifestWire>;
  } = {};
  let ticketLifetimeMs = 0;

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", origin);
    if (request.method === "GET" && url.pathname.endsWith("/current")) {
      const currentWire = responseState.currentWire;
      if (currentWire === undefined) {
        response.statusCode = 503;
        response.end();
        return;
      }
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.setHeader("etag", `"${currentWire.manifest_digest}"`);
      response.end(JSON.stringify(currentWire));
      return;
    }
    if (request.method === "POST" && url.pathname.endsWith("/download-tickets")) {
      const issuedAt = options.mode === "expired-ticket" ? NOW - 300_001 : NOW;
      const lifetime = options.mode === "ticket-window-299"
        ? 299_000
        : options.mode === "ticket-window-301" ? 301_000 : 300_000;
      const expiresAt = issuedAt + lifetime;
      ticketLifetimeMs = expiresAt - NOW;
      const ticketOrigin = options.mode === "origin"
        ? origin.replace("127.0.0.1", "localhost")
        : origin;
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        tickets: [{
          pack_id: "pack-1",
          object_version: options.mode === "object-version" ? "object-tampered" : "object-1",
          url: `${ticketOrigin}/packs/pack-1?ticket=fixture`,
          issued_at_epoch_ms: options.mode === "immutable-ticket" ? null : issuedAt,
          expires_at_epoch_ms: options.mode === "immutable-ticket" ? null : expiresAt,
          access_mode: options.mode === "immutable-ticket"
            ? "public_immutable"
            : "authenticated_public",
        }],
      }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/packs/pack-1") {
      packRequests += 1;
      if (options.mode === "redirect") {
        response.statusCode = 302;
        response.setHeader("location", `${origin.replace("127.0.0.1", "localhost")}/redirected-pack`);
        response.end();
        return;
      }
      const bytes = options.mode === "pack-hash" ? tamperSameSize(pack) : pack;
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(bytes);
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await listen(server);
  const address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${address.port}`;
  vi.stubGlobal("window", {
    activeWindow: {
      setTimeout: (
        callback: (...args: never[]) => void,
        delay?: number,
      ) => setNodeTimeout(callback, delay),
      clearTimeout: (timer: ReturnType<typeof setNodeTimeout>) => clearNodeTimeout(timer),
    },
    fetch: async (url: string, init: RequestInit): Promise<Response> => {
      const received = await requestLoopback({
        url,
        method: init.method ?? "GET",
      });
      if (init.redirect === "error" && received.status >= 300 && received.status < 400) {
        throw new TypeError("redirect mode is error");
      }
      return {
        status: received.status,
        redirected: false,
        url,
        arrayBuffer: () => Promise.resolve(received.bytes.buffer.slice(
          received.bytes.byteOffset,
          received.bytes.byteOffset + received.bytes.byteLength,
        )),
      } as Response;
    },
  });

  const generationNumber = options.mode === "generation-rollback" ? 1 : 2;
  const generationId = options.mode === "generation-conflict" ? "generation-conflict" : `generation-${generationNumber}`;
  responseState.currentWire = signedManifestWire({
    privateKey: keys.privateKey,
    origin,
    pack,
    sourceVersionId: options.mode === "stale-source" ? "source-version-stale" : SOURCE_VERSION_ID,
    generationId,
    generationNumber,
    manifestDigest: options.mode === "generation-conflict"
      ? `sha256:${"22".repeat(32)}`
      : MANIFEST_DIGEST,
    declaredSize: pack.byteLength + (options.mode === "size" ? 1 : 0),
  });
  if (options.mode === "signature") {
    const signature = responseState.currentWire.server_proof.signature;
    responseState.currentWire.server_proof.signature = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
  }

  setRequestUrlHandler(async (raw) => {
    const input = raw as {
      readonly url: string;
      readonly method: string;
      readonly headers?: Readonly<Record<string, string>>;
      readonly body?: string;
    };
    const response = await requestLoopback(input);
    return {
      status: response.status,
      headers: response.headers,
      text: new TextDecoder().decode(response.bytes),
      json: null,
      arrayBuffer: response.bytes.buffer.slice(
        response.bytes.byteOffset,
        response.bytes.byteOffset + response.bytes.byteLength,
      ),
    };
  });

  const verifier = new NodeEd25519ManifestVerifier({
    roots: [{
      keyId: "client-transfer-root-1",
      keyVersion: 1,
      publicKeyBase64Url: rawPublicKey(keys.publicKey),
    }],
    now: () => NOW,
    maximumClockSkewMs: 0,
  });
  const previous = options.mode === "generation-rollback" || options.mode === "generation-conflict"
    ? previousState(keys.privateKey, origin, pack)
    : undefined;
  const download = () => downloadPluginTranslations({
    transport: new ObsidianHttpTransport(origin),
    accessToken: "fixture-access-token",
    workspaceId: "scope-1",
    sourceVersionId: SOURCE_VERSION_ID,
    targetLocale: "zh-CN",
    packStore: new ObsidianTranslationPackStore(vaultFixture(adapter), "trans-hub-plugin-localizer"),
    developmentDownloadOrigin: origin,
    manifestVerifier: verifier,
    expectedPluginId: PLUGIN_ID,
    ...(previous === undefined ? {} : { previous }),
  });
  return {
    server,
    origin,
    adapter,
    download,
    get packRequests() { return packRequests; },
    get ticketLifetimeMs() { return ticketLifetimeMs; },
  };
}

function activationStoreFixture(): ActivationStore {
  return {
    client: () => Promise.resolve({
      client: {},
      bootstrap: {
        installationId: "installation-1",
        intakeCredential: { value: "fixture-access-token" },
      },
      authorityWorkspaceId: "scope-1",
    }),
  } as unknown as ActivationStore;
}

function signedManifestWire(input: Readonly<{
  privateKey: KeyObject;
  origin: string;
  pack: Uint8Array;
  sourceVersionId: string;
  generationId: string;
  generationNumber: number;
  manifestDigest: string;
  declaredSize: number;
}>) {
  const unsigned = {
    schema: "trans-hub.translation-export",
    revision: 3,
    manifest_id: "manifest-1",
    generation_id: input.generationId,
    generation_number: input.generationNumber,
    source_stream_id: "stream-1",
    source_version_id: input.sourceVersionId,
    target_locale: "zh-CN",
    target_variant: "default",
    scope: { kind: "public", public_scope_id: "scope-1" },
    manifest_digest: input.manifestDigest,
    cdn_origin: input.origin,
    packs: [{
      pack_id: "pack-1",
      pack_index: 0,
      item_count: 1,
      content_size_bytes: input.declaredSize,
      object_version: "object-1",
      content_sha256: sha256(input.pack),
      logical_object_digest: `sha256:${"33".repeat(32)}`,
    }],
  } as const;
  const payloadDigest = createHash("sha256")
    .update("trans-hub.client-protocol/v1/signed_payload\0")
    .update(canonicalJson(unsigned))
    .digest("hex");
  const proof = {
    domain: "translation_export_manifest",
    algorithm: "ed25519",
    keyId: "client-transfer-root-1",
    keyVersion: 1,
    payloadDigest: { algorithm: "sha256", domain: "signed_payload", hex: payloadDigest },
    signedAt: "2026-08-31T00:00:00Z",
    expiresAt: "2026-08-31T00:10:00Z",
  } as const;
  const frame = Buffer.concat([
    Buffer.from("trans-hub.client-protocol/v1/signature/translation_export_manifest\0"),
    Buffer.from(canonicalJson(proof)),
  ]);
  return {
    ...unsigned,
    server_proof: {
      ...proof,
      signature: sign(null, frame, input.privateKey).toString("base64url"),
    },
  };
}

function previousState(
  privateKey: KeyObject,
  origin: string,
  pack: Uint8Array,
): TranslationSyncState<CanonicalJsonTranslationExportManifest> {
  const wire = signedManifestWire({
    privateKey,
    origin,
    pack,
    sourceVersionId: SOURCE_VERSION_ID,
    generationId: "generation-2",
    generationNumber: 2,
    manifestDigest: MANIFEST_DIGEST,
    declaredSize: pack.byteLength,
  });
  return {
    etag: `"${wire.manifest_digest}"`,
    manifest: parseTranslationExportManifest(wire, 3),
  };
}

function translationPackBytes(): Uint8Array {
  return new TextEncoder().encode(canonicalJson({
    items: [{
      occurrence_key: `obsidian:plugin-ui:${PLUGIN_ID}:${STRING_KEY}`,
      structured_content: {},
      target_text: "设置",
    }],
    pack_index: 0,
    schema: "trans-hub.translation-pack",
    source_version_id: SOURCE_VERSION_ID,
    target_locale: "zh-CN",
    target_variant: "default",
    version: 1,
  }));
}

function catalogFixture() {
  return {
    pluginId: PLUGIN_ID,
    pluginName: "Sample Plugin",
    pluginVersion: "1.0.0",
    sourceLocale: "en",
    digest: "catalog-digest",
    artifactDigest: "a".repeat(64),
    scannedAt: "2026-08-31T00:00:00Z",
    strings: [{
      key: STRING_KEY,
      source: "Settings",
      origins: ["ui-call" as const],
      placeholderSignature: "",
    }],
  };
}

function runtimeHostFixture(source: string): {
  readonly app: App;
  readonly text: Text;
} {
  class MockMutationObserver {
    constructor(_callback: MutationCallback) {}
    observe(_target: Node, _options: MutationObserverInit): void {}
    disconnect(): void {}
    takeRecords(): MutationRecord[] { return []; }
  }
  const activePluginTab = {
    getAttribute: (attribute: string) => attribute === "data-plugin-id" ? PLUGIN_ID : null,
    textContent: "Sample Plugin",
  } as unknown as HTMLElement;
  const settingsModal = {
    querySelector: () => activePluginTab,
  } as unknown as Element;
  const parent = {
    closest: (selector: string) => selector === ".modal.mod-settings" ? settingsModal : null,
  } as unknown as HTMLElement;
  const text = { nodeType: 3, data: source, parentElement: parent } as unknown as Text;
  const root = {
    nodeType: 1,
    childNodes: [text],
    closest: () => null,
    contains: () => true,
    getAttribute: () => null,
    setAttribute: () => {},
    matches: () => false,
    ownerDocument: {
      defaultView: { MutationObserver: MockMutationObserver },
      createTreeWalker: () => {
        let delivered = false;
        return { nextNode: () => delivered ? null : (delivered = true, text) };
      },
    },
  } as unknown as HTMLElement;
  vi.stubGlobal("document", { body: root });
  vi.stubGlobal("NodeFilter", { SHOW_TEXT: 4, SHOW_ELEMENT: 1 });
  return {
    text,
    app: {
      workspace: {
        on: (name: string) => ({ name }),
        offref: () => {},
      },
    } as unknown as App,
  };
}

class RecordingVaultAdapter {
  readonly files = new Map<string, ArrayBuffer>();
  readonly directories = new Set<string>();
  readonly writtenPaths: string[] = [];

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path) || this.directories.has(path));
  }

  readBinary(path: string): Promise<ArrayBuffer> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`missing_fixture_file:${path}`);
    return Promise.resolve(value.slice(0));
  }

  writeBinary(path: string, value: ArrayBuffer): Promise<void> {
    this.writtenPaths.push(path);
    this.files.set(path, value.slice(0));
    return Promise.resolve();
  }

  remove(path: string): Promise<void> {
    this.files.delete(path);
    return Promise.resolve();
  }
  rename(from: string, to: string): Promise<void> {
    const value = this.files.get(from);
    if (value === undefined) throw new Error(`missing_fixture_file:${from}`);
    this.files.delete(from);
    this.files.set(to, value);
    const index = this.writtenPaths.indexOf(from);
    if (index >= 0) this.writtenPaths[index] = to;
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

function vaultFixture(adapter: RecordingVaultAdapter): Vault {
  return {
    configDir: ".obsidian",
    adapter,
  } as unknown as Vault;
}

function requestLoopback(input: {
  readonly url: string;
  readonly method: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}): Promise<{ readonly status: number; readonly headers: Record<string, string>; readonly bytes: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(input.url, {
      method: input.method,
      headers: input.headers,
    }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
      incoming.once("error", reject);
      incoming.once("end", () => {
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (value !== undefined) headers[key] = Array.isArray(value) ? value.join(", ") : value;
        }
        resolve({
          status: incoming.statusCode ?? 0,
          headers,
          bytes: new Uint8Array(Buffer.concat(chunks)),
        });
      });
    });
    outgoing.once("error", reject);
    if (input.body !== undefined) outgoing.write(input.body);
    outgoing.end();
  });
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function tamperSameSize(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(bytes);
  result[result.byteLength - 2] = result[result.byteLength - 2] === 125 ? 124 : 125;
  return result;
}

function rawPublicKey(publicKey: KeyObject): string {
  return publicKey.export({ format: "der", type: "spki" })
    .subarray(-32)
    .toString("base64url");
}

function fixtureKeyPair(): { readonly privateKey: KeyObject; readonly publicKey: KeyObject } {
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.alloc(32, 7),
    ]),
    format: "der",
    type: "pkcs8",
  });
  return { privateKey, publicKey: createPublicKey(privateKey) };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}
