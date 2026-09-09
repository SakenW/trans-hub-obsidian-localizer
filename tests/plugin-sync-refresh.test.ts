import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  parsePublicDiscoveryReceipt,
  type PublicDiscoveryReceipt,
  type PublicDiscoveryStatus,
} from "@trans-hub/client-protocol";

import type { ActivationStore } from "../src/activation";
import { refreshConfiguredPluginStatuses, synchronizeConfiguredPluginTranslations } from "../src/plugin-sync";
import {
  EMPTY_PLUGIN_STATE,
  getPluginTranslation,
  parsePluginState,
  type PluginState,
} from "../src/plugin-state";
import {
  submitObsidianLocalizationObservation,
  submitObsidianPluginDiscovery,
} from "../src/submission";

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  loadCatalog: vi.fn(),
  resolveArtifact: vi.fn(),
  resolveIdentity: vi.fn(),
  resolvePublished: vi.fn(),
}));

vi.mock("../src/http-transport", () => ({
  ObsidianHttpTransport: class ObsidianHttpTransport {
    public constructor(public readonly baseUrl: string) {}
  },
}));

vi.mock("../src/plugin-registry", () => ({
  isCommunityPluginNotFoundError: (error: unknown) =>
    error instanceof Error
    && (error as Error & { readonly code?: string }).code === "community_plugin_not_found",
  resolveCommunityPluginIdentity: mocks.resolveIdentity,
}));

vi.mock("../src/plugin-source-resolution", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/plugin-source-resolution")>();
  return {
    ...original,
    loadPublishedEcosystemCatalog: mocks.loadCatalog,
    resolvePublishedPluginArtifactDigestFromCatalog: mocks.resolveArtifact,
    resolvePublishedPluginSourceFromCatalog: mocks.resolvePublished,
  };
});

vi.mock("../src/submission", () => ({
  OBSIDIAN_PUBLIC_PROFILE: {
    adapterBuildDigestHex: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
    registryPolicyRevision: 24,
    sourceDiscoveryEpoch: 19,
  },
  submitObsidianLocalizationObservation: vi.fn(),
  submitObsidianPluginDiscovery: vi.fn(),
}));

vi.mock("../src/translation-sync", () => ({
  downloadPluginTranslations: mocks.download,
}));

const STRING_KEY = "a".repeat(32);
const translationPackStore = {
  getVerified(): Promise<undefined> { return Promise.resolve(undefined); },
  putVerified(): Promise<void> { return Promise.resolve(); },
};

const exportManifest = {
  schema: "trans-hub.translation-export",
  revision: 1,
  manifestId: "manifest",
  generationId: "generation",
  generationNumber: 1,
  sourceStreamId: "stream",
  sourceVersionId: "current-source",
  targetLocale: "zh-CN",
  targetVariant: "default",
  scope: { kind: "public", publicScopeId: "workspace" },
  manifestDigest: `sha256:${"1".repeat(64)}`,
  packs: [],
} as const;

function discoveryReceipt(
  overrides: Partial<PublicDiscoveryReceipt>,
): PublicDiscoveryReceipt {
  const blocked = overrides.classification === "blocked";
  return parsePublicDiscoveryReceipt({
    kind: "public_discovery_receipt",
    protocol: {
      protocol: "trans-hub.client-protocol", revision: 1, schemaRevision: 1,
    },
    receiptId: "019f0000-0000-7000-8000-000000000098",
    discoveryId: "019f0000-0000-7000-8000-000000000099",
    taskId: blocked ? null : "019f0000-0000-7000-8000-000000000097",
    classification: blocked ? "blocked" : "eligible_for_processing",
    taskState: blocked ? "blocked" : "queued_for_parsing",
    outcome: blocked ? "negative_cached" : "created",
    commandDigest: { algorithm: "sha256", domain: "request", hex: "c".repeat(64) },
    credentialEpoch: 1,
    recordedAt: "2026-08-01T00:00:00Z",
    ...overrides,
  });
}

function discoveryStatus(
  overrides: Partial<PublicDiscoveryStatus> = {},
): PublicDiscoveryStatus {
  return {
    kind: "public_discovery_status",
    protocol: { protocol: "trans-hub.client-protocol", revision: 1, schemaRevision: 1 },
    statusRevision: 2,
    discoveryId: "019f0000-0000-7000-8000-000000000090",
    receiptId: "019f0000-0000-7000-8000-000000000092",
    taskId: "019f0000-0000-7000-8000-000000000093",
    classification: "eligible_for_processing",
    taskState: "queued_for_parsing",
    taskGeneration: 1,
    attemptCount: 0,
    outcome: "created",
    commandDigest: {
      algorithm: "sha256", domain: "request", hex: "a".repeat(64) as never,
    },
    credentialEpoch: 1,
    receiptRecordedAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:00.000Z",
    retryAfterSeconds: 0,
    retryAllowed: false,
    blockedReasonCode: null,
    ...overrides,
  };
}

describe("synchronizeConfiguredPluginTranslations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveIdentity.mockResolvedValue({
      repository: "blacksmithgu/obsidian-dataview",
      candidateLocators: [],
    });
    mocks.loadCatalog.mockResolvedValue({ objects: [] });
    mocks.resolveArtifact.mockReturnValue("a".repeat(64));
    mocks.resolvePublished.mockReturnValue({
      sourceVersionId: "current-source",
      catalogIdentityExact: true,
    });
    mocks.download.mockResolvedValue({
      rows: [{ stringKey: STRING_KEY, translatedText: "当前译文" }],
      etag: '"generation"',
      manifest: exportManifest,
    });
    vi.mocked(submitObsidianPluginDiscovery).mockResolvedValue(discoveryReceipt({
      discoveryId: "019f0000-0000-7000-8000-000000000099",
      classification: "eligible_for_processing",
      taskState: "queued_for_parsing",
      recordedAt: "2026-08-01T00:00:00Z",
    }));
  });

  it.each(["downloaded", "native"] as const)("restores the persisted dictionary if saving %s coverage fails", async (coverage) => {
    if (coverage === "native") mocks.resolvePublished.mockReturnValue({
      sourceVersionId: "current-source", catalogIdentityExact: true,
      sourceUnitCount: 1, upstreamNativeCount: 1, publishedUnitCount: 0, missingUnitCount: 0,
    });
    const oldDictionary = {
      pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "current-source",
      targetLocale: "zh-CN", entries: [{ pluginId: "dataview", source: "Current source", target: "已保存译文" }],
      pulledAt: "2026-09-05T00:00:00Z",
    };
    const oldExport = { etag: '"saved"', manifest: exportManifest };
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: { dataview: {
        pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
        sourceLocale: "en", digest: "catalog-digest", artifactDigest: "a".repeat(64),
        scannedAt: "2026-09-05T00:00:00Z",
        strings: [{ key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "" }],
      } },
      pluginTranslations: { dataview: { "zh-CN": oldDictionary } },
      translationExportStates: { "current-source:zh-CN:default": oldExport },
    };
    const pruneUnreferenced = vi.fn().mockResolvedValue(0);
    const packStore = { ...translationPackStore, pruneUnreferenced };
    const save = vi.fn().mockRejectedValue(new Error("fixture_disk_full"));
    const activationStore = {
      client: vi.fn().mockResolvedValue({ client: {},
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace" }),
    } as unknown as ActivationStore;

    await expect(synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN", excludedPluginIds: [],
      activationStore, translationPackStore: packStore,
      getState: () => state, replaceState: (next) => { state = next; }, save,
    })).rejects.toThrow("fixture_disk_full");
    expect(save).toHaveBeenCalled();
    expect(getPluginTranslation(state, "dataview", "zh-CN")).toBe(oldDictionary);
    expect(state.translationExportStates["current-source:zh-CN:default"]).toBe(oldExport);
    expect(pruneUnreferenced).not.toHaveBeenCalled();
  });

  it.each([408, 429, 500, 503])("目录 HTTP %s 失败不伪造等待或提交新发现", async (status) => {
    mocks.loadCatalog.mockRejectedValue(new Error(`读取 Obsidian 公共目录失败：HTTP ${status}`));
    vi.mocked(submitObsidianPluginDiscovery).mockResolvedValue(discoveryReceipt({
      discoveryId: "019f0000-0000-7000-8000-000000000001",
      classification: "pending_registry_verification",
      taskState: "verifying_registry",
      recordedAt: "2026-08-01T00:00:00Z",
    }));
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
          sourceLocale: "en", digest: "catalog-digest", artifactDigest: "a".repeat(64),
          scannedAt: "2026-08-01T00:00:00Z",
          strings: [{ key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "" }],
        },
      },
    };
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: {},
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const summary = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
    expect(submitObsidianLocalizationObservation).not.toHaveBeenCalled();
    expect(summary).toEqual(expect.objectContaining({ submittedCount: 0, waitingCount: 0, failedPluginIds: ["dataview"] }));
    expect(state.publicPluginDiscoveries.dataview).toBeUndefined();
    expect(state.pluginSubmissions.dataview?.lastError?.code).toBe("public_catalog_unavailable");
  });

  it("不让客户端目录策略版本触发公共发现重提", async () => {
    mocks.loadCatalog.mockResolvedValue(undefined);
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
          sourceLocale: "en", digest: "catalog-digest", artifactDigest: "a".repeat(64),
          scannedAt: "2026-08-01T00:00:00Z",
          strings: [{ key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "" }],
        },
      },
      pluginSubmissions: {
        dataview: {
          pluginId: "dataview", pluginVersion: "0.5.68", catalogDigest: "catalog-digest",
          adapterProfileDigest: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
          registryPolicyRevision: 23, sourceDiscoveryEpoch: 19,
          installationId: "installation", contributionId: "old-discovery",
          contributionState: "received", repository: "blacksmithgu/obsidian-dataview",
          submittedAt: "2026-07-31T00:00:00Z",
        },
      },
      publicPluginDiscoveries: {
        dataview: {
          discoveryId: "019f0000-0000-7000-8000-000000000011",
          targetLocales: ["zh-CN"],
          classification: "pending_registry_verification",
          taskState: "verifying_registry",
          installationId: "installation",
          submittedAt: "2026-07-31T00:00:00Z",
          sourceDiscoveryEpoch: 19,
          catalogIdentityDigest: "catalog-digest",
        },
      },
    };
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: {},
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
    expect(state.pluginSubmissions.dataview).toEqual(expect.objectContaining({
      contributionId: "old-discovery",
      registryPolicyRevision: 23,
      sourceDiscoveryEpoch: 19,
    }));
  });

  it("来源目录版本变化时创建新公共发现任务", async () => {
    mocks.loadCatalog.mockResolvedValue(undefined);
    vi.mocked(submitObsidianPluginDiscovery).mockResolvedValue(discoveryReceipt({
      discoveryId: "019f0000-0000-7000-8000-000000000012",
      classification: "pending_registry_verification",
      taskState: "verifying_registry",
      recordedAt: "2026-08-01T00:01:00Z",
    }));
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
          sourceLocale: "en", digest: "catalog-digest", artifactDigest: "a".repeat(64),
          scannedAt: "2026-08-01T00:00:00Z",
          strings: [{ key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "" }],
        },
      },
      publicPluginDiscoveries: {
        dataview: {
          discoveryId: "019f0000-0000-7000-8000-000000000011",
          targetLocales: ["zh-CN"], classification: "pending_registry_verification",
          taskState: "verifying_registry", installationId: "installation",
          submittedAt: "2026-07-31T00:00:00Z", sourceDiscoveryEpoch: 18,
          catalogIdentityDigest: "old-catalog-digest",
        },
      },
    };
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: {},
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const summary = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(submitObsidianPluginDiscovery).toHaveBeenCalledOnce();
    expect(state.publicPluginDiscoveries.dataview).toEqual(expect.objectContaining({
      discoveryId: "019f0000-0000-7000-8000-000000000012",
      sourceDiscoveryEpoch: 19,
    }));
    expect(summary).toEqual(expect.objectContaining({ submittedCount: 1, waitingCount: 1 }));
  });

  it("为同一目录对象合并新增目标语言，并将阻断结果显示为失败", async () => {
    mocks.loadCatalog.mockResolvedValue(undefined);
    vi.mocked(submitObsidianPluginDiscovery).mockResolvedValue(discoveryReceipt({
      discoveryId: "019f0000-0000-7000-8000-000000000021",
      classification: "blocked",
      taskState: "blocked",
      recordedAt: "2026-08-01T00:00:00Z",
    }));
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
          sourceLocale: "en", digest: "catalog-digest", artifactDigest: "a".repeat(64),
          scannedAt: "2026-08-01T00:00:00Z",
          strings: [{ key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "" }],
        },
      },
      publicPluginDiscoveries: {
        dataview: {
          discoveryId: "019f0000-0000-7000-8000-000000000020",
          targetLocales: ["zh-CN"],
          classification: "pending_registry_verification",
          taskState: "verifying_registry",
          installationId: "installation",
          submittedAt: "2026-07-31T00:00:00Z",
          sourceDiscoveryEpoch: 19,
          catalogIdentityDigest: "catalog-digest",
        },
      },
    };
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: {},
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const summary = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "ja",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(submitObsidianPluginDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      targetLocales: ["ja", "zh-CN"],
    }));
    expect(summary.waitingPluginIds).toEqual([]);
    expect(summary.failedPluginIds).toEqual([]);
    expect(summary.blockedPluginIds).toEqual(["dataview"]);
    expect(state.publicPluginDiscoveries.dataview).toEqual(expect.objectContaining({
      targetLocales: ["ja", "zh-CN"], taskState: "blocked",
    }));
  });

  it("旧在途需求在目录缺失时改用公共发现", async () => {
    mocks.loadCatalog.mockResolvedValue(undefined);
    const getLocalizationDemandStatus = vi.fn().mockResolvedValue({ state: "mt_running" });
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
          sourceLocale: "en", digest: "catalog-digest", artifactDigest: "a".repeat(64),
          scannedAt: "2026-08-01T00:00:00Z",
          strings: [{ key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "" }],
        },
      },
      pluginSubmissions: {
        dataview: parseStoredSubmission({
          pluginId: "dataview", pluginVersion: "0.5.68", catalogDigest: "catalog-digest",
          contributionState: "received", submittedAt: "2026-07-31T00:00:00Z",
          localizationTargetLocale: "zh-CN",
          localizationContributionId: "legacy-localization",
          localizationContributionState: "received",
        }),
      },
    };
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: { getLocalizationDemandStatus },
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const summary = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(getLocalizationDemandStatus).not.toHaveBeenCalled();
    expect(submitObsidianLocalizationObservation).not.toHaveBeenCalled();
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledOnce();
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      installationId: "installation",
      targetLocales: ["zh-CN"],
    }));
    expect(summary).toEqual(expect.objectContaining({
      submittedCount: 1, requestedCount: 0, waitingCount: 1,
    }));
  });

  it("refreshes a cached source version before requesting its published export", async () => {
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview",
          pluginName: "Dataview",
          pluginVersion: "0.5.68",
          sourceLocale: "en",
          digest: "catalog-digest",
          artifactDigest: "a".repeat(64),
          scannedAt: "2026-07-18T00:00:00.000Z",
          strings: [{
            key: STRING_KEY,
            source: "Current source",
            origins: ["ui-call"],
            placeholderSignature: "",
          }],
        },
      },
      pluginTranslations: {
        dataview: {
          ko: {
            pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "ko-source",
            targetLocale: "ko", entries: [{ pluginId: "dataview", source: "Current source", target: "현재 번역" }],
            pulledAt: "2026-07-18T00:00:00.000Z",
          },
        },
      },
      pluginSubmissions: {
        dataview: parseStoredSubmission({
          pluginId: "dataview",
          pluginVersion: "0.5.68",
          catalogDigest: "catalog-digest",
          adapterProfileDigest: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
          registryPolicyRevision: 24,
          sourceDiscoveryEpoch: 19,
          installationId: "installation",
          contributionId: "discovery-contribution",
          contributionState: "received",
          repository: "blacksmithgu/obsidian-dataview",
          submittedAt: "2026-07-18T00:00:00.000Z",
          localizationTargetLocale: "zh-CN",
          localizationContributionId: "localization-contribution",
          localizationContributionState: "received",
          localizationDemandStatus: {
            state: "distribution_blocked", sourceVersionId: "stale-source",
            targetLocale: "zh-CN", targetVariant: "default",
            totalUnitCount: 1, workItemCount: 1, nativeUnitCount: 0,
            queuedCount: 0, runningCount: 0, succeededCount: 1, failedCount: 0,
            reviewedUnitCount: 0, publishedUnitCount: 0, retryAfterSeconds: 0,
            failureCode: "PublicDistributionLicenseUnsupported", failureRetryable: false,
            updatedAt: "2026-07-18T00:00:00.000Z",
          },
          sourceVersionId: "stale-source",
          lastError: {
            code: "plugin_sync_failed",
            message: "stale cached manifest",
            updatedAt: "2026-07-18T00:00:00.000Z",
          },
        }),
      },
    };
    const getContributionStatus = vi.fn().mockResolvedValue({ state: "received" });
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: { getContributionStatus },
        bootstrap: {
          installationId: "installation",
          intakeCredential: { value: "installation-token" },
        },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const summary = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "http://127.0.0.1:8000",
      targetLocale: "zh-CN",
      excludedPluginIds: [],
      activationStore,
      translationPackStore,
      getState: () => state,
      replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(mocks.resolvePublished).toHaveBeenCalledOnce();
    expect(mocks.resolveIdentity).not.toHaveBeenCalled();
    expect(getContributionStatus).not.toHaveBeenCalled();
    expect(mocks.download).toHaveBeenCalledWith(expect.objectContaining({
      sourceVersionId: "current-source",
      accessToken: "installation-token",
      workspaceId: "workspace",
    }));
    expect(state.pluginSubmissions.dataview?.sourceVersionId).toBe("current-source");
    expect(state.pluginSubmissions.dataview).not.toHaveProperty("localizationContributionId");
    expect(state.pluginSubmissions.dataview).not.toHaveProperty("localizationDemandStatus");
    expect(state.pluginSubmissions.dataview?.lastError).toBeUndefined();
    expect(getPluginTranslation(state, "dataview", "zh-CN")?.entries).toEqual([
      {
        pluginId: "dataview",
        source: "Current source",
        target: "当前译文",
        scopes: ["runtime-ui"],
      },
    ]);
    expect(getPluginTranslation(state, "dataview", "ko")?.entries[0]?.target).toBe("현재 번역");
    expect(summary).toEqual({
      submittedCount: 0,
      requestedCount: 0,
      pulledCount: 1,
      waitingCount: 0,
      translationCount: 1,
      waitingPluginIds: [],
      failedPluginIds: [],
      demandStateCounts: {},
    });
  });

  it("pulls the server-current pack on the next automatic sync after discovery publishes", async () => {
    mocks.resolvePublished.mockReturnValue({
      sourceVersionId: "current-source", objectVersionId: "current-object",
      authorityPluginVersion: "0.5.70", artifactDigest: "b".repeat(64),
      catalogIdentityExact: false, sourceUnitCount: 1, upstreamNativeCount: 0,
      publishedUnitCount: 1, missingUnitCount: 0,
    });
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: { dataview: catalogForAutomaticProjectionRefresh() },
      publicPluginDiscoveries: { dataview: discoveryWithoutProjection() },
    };
    const getPublicLocalizationStatusBatch = vi.fn().mockResolvedValue({
      items: [{
        discoveryId: "discovery", targetLocale: "zh-CN", found: true,
        projection: currentPublishedProjection(),
      }],
    });
    const save = vi.fn().mockResolvedValue(undefined);
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: { getPublicLocalizationStatusBatch, getPublicDiscoveryStatus: lifecycleFromState(() => state) },
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const result = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; }, save,
    });

    expect(getPublicLocalizationStatusBatch).toHaveBeenCalledOnce();
    expect(mocks.resolvePublished).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      authoritativeSourceVersionId: "current-source",
    }));
    expect(mocks.download).toHaveBeenCalledWith(expect.objectContaining({
      sourceVersionId: "current-source",
    }));
    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
    expect(state.publicPluginDiscoveries.dataview?.localizationProjection?.sourceVersionId)
      .toBe("current-source");
    expect(getPluginTranslation(state, "dataview", "zh-CN")?.authorityPluginVersion)
      .toBe("0.5.70");
    expect(result.pulledCount).toBe(1);
    expect(result.statusRead).toEqual({ kind: "fresh" });
  });

  it("keeps a transient projection refresh stale with zero write and no submission", async () => {
    mocks.resolvePublished.mockReturnValue(undefined);
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: { dataview: catalogForAutomaticProjectionRefresh() },
      publicPluginDiscoveries: { dataview: discoveryWithoutProjection() },
    };
    const originalState = state;
    const save = vi.fn().mockResolvedValue(undefined);
    const replaceState = vi.fn((next: PluginState) => { state = next; });
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: {
          getPublicDiscoveryStatus: lifecycleFromState(() => state),
          getPublicLocalizationStatusBatch: vi.fn().mockRejectedValue(new Error("offline")),
        },
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const result = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState, save,
    });

    expect(mocks.download).not.toHaveBeenCalled();
    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(state).toBe(originalState);
    expect(result.statusRead).toEqual({
      kind: "stale",
      failedPluginIds: ["dataview"],
      failedSources: ["public-localization"],
    });
  });

  it("refreshes 101 existing discoveries in bounded ordinal-preserving batches", async () => {
    mocks.resolvePublished.mockReturnValue(undefined);
    let state = bulkProjectionState(101);
    const batchSizes: number[] = [];
    const save = vi.fn().mockResolvedValue(undefined);
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: {
          getPublicDiscoveryStatus: lifecycleFromState(() => state),
          getPublicLocalizationStatusBatch: vi.fn().mockImplementation((request: {
            readonly queries: readonly { readonly discoveryId: string; readonly targetLocale: string }[];
          }) => {
            batchSizes.push(request.queries.length);
            return Promise.resolve({
              items: request.queries.map((query) => ({
                discoveryId: query.discoveryId, targetLocale: query.targetLocale,
                found: true, projection: bulkProjection(query.discoveryId, null, "parsing"),
              })),
            });
          }),
        },
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const result = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; }, save,
    });

    expect(batchSizes).toEqual([100, 1]);
    expect(state.publicPluginDiscoveries["plugin-0"]?.localizationProjection?.stage)
      .toBe("parsing");
    expect(state.publicPluginDiscoveries["plugin-100"]?.localizationProjection?.stage)
      .toBe("parsing");
    expect(save).toHaveBeenCalledOnce();
    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
    expect(result.waitingCount).toBe(101);
    expect(result.statusRead).toEqual({ kind: "fresh" });
  });

  it("keeps a failed middle projection batch stale while other batches download", async () => {
    let state = bulkProjectionState(201);
    mocks.resolvePublished.mockImplementation((
      _catalog: unknown,
      resolution: { readonly authoritativeSourceVersionId?: string },
    ) => resolution.authoritativeSourceVersionId === undefined
      ? undefined
      : {
          sourceVersionId: resolution.authoritativeSourceVersionId,
          objectVersionId: `object-${resolution.authoritativeSourceVersionId}`,
          authorityPluginVersion: "0.5.70", artifactDigest: "b".repeat(64),
          catalogIdentityExact: false, sourceUnitCount: 1, upstreamNativeCount: 0,
          publishedUnitCount: 1, missingUnitCount: 0,
        });
    let batchIndex = 0;
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: {
          getPublicDiscoveryStatus: lifecycleFromState(() => state),
          getPublicLocalizationStatusBatch: vi.fn().mockImplementation((request: {
            readonly queries: readonly { readonly discoveryId: string; readonly targetLocale: string }[];
          }) => {
            const currentBatch = batchIndex;
            batchIndex += 1;
            if (currentBatch === 1) return Promise.reject(new Error("middle batch offline"));
            return Promise.resolve({
              items: request.queries.map((query) => ({
                discoveryId: query.discoveryId, targetLocale: query.targetLocale,
                found: true,
                projection: bulkProjection(
                  query.discoveryId,
                  `source-${query.discoveryId}`,
                  "published",
                ),
              })),
            });
          }),
        },
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const result = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(batchIndex).toBe(3);
    expect(result.pulledCount).toBe(101);
    expect(mocks.download).toHaveBeenCalledTimes(101);
    expect(getPluginTranslation(state, "plugin-0", "zh-CN")).toBeDefined();
    expect(getPluginTranslation(state, "plugin-100", "zh-CN")).toBeUndefined();
    expect(getPluginTranslation(state, "plugin-200", "zh-CN")).toBeDefined();
    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
    expect(result.statusRead).toEqual({
      kind: "stale",
      failedPluginIds: Array.from({ length: 100 }, (_unused, index) => `plugin-${index + 100}`),
      failedSources: ["public-localization"],
    });
  });

  it.each([
    { shared: false, coverageRefreshing: false },
    { shared: true, coverageRefreshing: false },
    { shared: false, coverageRefreshing: true },
  ])("retires a superseded manifest only after fresh coverage (shared=$shared, rebuilding=$coverageRefreshing)", async ({ shared, coverageRefreshing }) => {
    mocks.resolvePublished.mockReturnValue(coverageRefreshing
      ? { coverageFreshness: "stale" }
      : {
          sourceVersionId: "new-source", objectVersionId: "new-object",
          authorityPluginVersion: "0.5.70", artifactDigest: "b".repeat(64),
          catalogIdentityExact: false, sourceUnitCount: 1, upstreamNativeCount: 0,
          publishedUnitCount: 1, missingUnitCount: 0,
        });
    mocks.download.mockRejectedValue(new Error("offline"));
    const oldExport = { etag: '"old"', manifest: exportManifest } as never;
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
          sourceLocale: "en", digest: "catalog-digest", artifactDigest: "a".repeat(64),
          scannedAt: "2026-09-05T00:00:00.000Z",
          strings: [{ key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "" }],
        },
      },
      publicPluginDiscoveries: {
        dataview: {
          statusRevision: 2, receiptId: "receipt", discoveryId: "discovery", taskId: "task",
          targetLocales: ["zh-CN"], classification: "eligible_for_processing",
          taskState: "result_verified", taskGeneration: 1, attemptCount: 1,
          outcome: "completed", commandDigestHex: "c".repeat(64), credentialEpoch: 1,
          receiptRecordedAt: "2026-09-05T00:00:00.000Z",
          updatedAt: "2026-09-05T00:00:00.000Z", retryAfterSeconds: 0,
          retryAllowed: false, retryGeneration: 0, installationId: "installation",
          submittedAt: "2026-09-05T00:00:00.000Z", catalogIdentityDigest: "catalog-digest",
          localizationProjection: {
            kind: "public_localization_status_projection",
            protocol: { protocol: "trans-hub.client-protocol", revision: 1, schemaRevision: 1 },
            projectionRevision: 1, discoveryId: "discovery", registryKey: "official-directory",
            externalObjectId: "dataview", targetLocale: "zh-CN" as never,
            catalogIdentityDigest: null, sourceVersionId: "new-source", stage: "published",
            updatedAt: "2026-09-05T00:01:00.000Z",
          },
        },
      },
      pluginTranslations: {
        dataview: {
          "zh-CN": {
            pluginId: "dataview", pluginVersion: "0.5.68", authorityPluginVersion: "0.5.68",
            sourceVersionId: "old-source", targetLocale: "zh-CN",
            entries: [{ pluginId: "dataview", source: "Current source", target: "旧译文" }],
            pulledAt: "2026-09-04T00:00:00.000Z",
          },
        },
      },
      translationExportStates: { "old-source:zh-CN:default": oldExport },
    };
    if (shared) state = {
      ...state,
      pluginTranslations: {
        ...state.pluginTranslations,
        other: { "zh-CN": {
          ...state.pluginTranslations.dataview["zh-CN"]!, pluginId: "other",
        } },
      },
    };
    const save = vi.fn().mockResolvedValue(undefined);
    const pruneUnreferenced = vi.fn().mockResolvedValue(0);
    const packStore = { ...translationPackStore, pruneUnreferenced };
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: {
          getPublicDiscoveryStatus: lifecycleFromState(() => state),
          getPublicLocalizationStatusBatch: vi.fn().mockResolvedValue({
            items: [{
              discoveryId: "discovery", targetLocale: "zh-CN", found: true,
              projection: currentPublishedProjection("new-source"),
            }],
          }),
        },
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const result = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore: packStore,
      getState: () => state, replaceState: (next) => { state = next; }, save,
    });

    expect(mocks.resolvePublished).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      authoritativeSourceVersionId: "new-source",
    }));
    expect(getPluginTranslation(state, "dataview", "zh-CN")).toEqual(
      coverageRefreshing ? expect.objectContaining({ sourceVersionId: "old-source" }) : undefined,
    );
    expect(state.translationExportStates["old-source:zh-CN:default"])
      .toBe(coverageRefreshing || shared ? oldExport : undefined);
    expect(pruneUnreferenced).toHaveBeenCalledTimes(coverageRefreshing ? 0 : 1);
    expect(mocks.download).toHaveBeenCalledTimes(coverageRefreshing ? 0 : 1);
    expect(result.failedPluginIds).toEqual(coverageRefreshing ? [] : ["dataview"]);
  });

  it("官方当前快照缺项时提交公共发现需求，不提交仓库地址", async () => {
    mocks.resolvePublished.mockReturnValue({
      sourceVersionId: "current-source",
      objectVersionId: "object-version",
      artifactDigest: "a".repeat(64),
      repository: "owner/generic",
      catalogIdentityExact: true,
      sourceUnitCount: 2,
      upstreamNativeCount: 0,
      publishedUnitCount: 1,
      missingUnitCount: 1,
    });
    vi.mocked(submitObsidianPluginDiscovery).mockResolvedValue(discoveryReceipt({
      discoveryId: "019f0000-0000-7000-8000-000000000031",
      classification: "eligible_for_processing",
      taskState: "queued_for_parsing",
      recordedAt: "2026-08-01T00:00:00Z",
    }));
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
          sourceLocale: "en", digest: "catalog-digest", artifactDigest: "a".repeat(64),
          scannedAt: "2026-07-29T00:00:00.000Z",
          strings: [
            { key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "" },
            { key: "b".repeat(32), source: "Missing source", origins: ["ui-call"], placeholderSignature: "" },
          ],
        },
      },
    };
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: {},
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const input: Parameters<typeof synchronizeConfiguredPluginTranslations>[0] = {
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN", excludedPluginIds: [],
      activationStore, translationPackStore, getState: () => state,
      replaceState: (next) => { state = next; }, save: vi.fn().mockResolvedValue(undefined),
    };
    const summary = await synchronizeConfiguredPluginTranslations(input);

    expect(getPluginTranslation(state, "dataview", "zh-CN")?.entries).toHaveLength(1);
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      targetLocales: ["zh-CN"],
    }));
    expect(submitObsidianLocalizationObservation).not.toHaveBeenCalled();
    expect(state.publicPluginDiscoveries.dataview).toEqual(expect.objectContaining({
      discoveryId: "019f0000-0000-7000-8000-000000000031",
      taskState: "queued_for_parsing",
    }));
    expect(state.pluginSubmissions.dataview).toBeUndefined();
    expect(summary).toEqual(expect.objectContaining({
      pulledCount: 1,
      submittedCount: 1,
      requestedCount: 0,
      failedPluginIds: [],
    }));

    const repeated = await synchronizeConfiguredPluginTranslations(input);
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledOnce();
    expect(repeated.failedPluginIds).toEqual([]);
    expect(repeated.waitingPluginIds).toEqual(["dataview"]);
  });

  it("uses complete authority coverage without retaining a local catalog mismatch demand", async () => {
    mocks.resolvePublished.mockReturnValue({
      sourceVersionId: "stale-source",
      objectVersionId: "object-version",
      artifactDigest: "a".repeat(64),
      catalogIdentityExact: false,
      sourceUnitCount: 943,
      upstreamNativeCount: 856,
      publishedUnitCount: 87,
      missingUnitCount: 856,
    });
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
          sourceLocale: "en", digest: "current-catalog", artifactDigest: "a".repeat(64),
          scannedAt: "2026-07-27T00:00:00.000Z",
          strings: [{
            key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "",
          }],
        },
      },
    };
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: { getContributionStatus: vi.fn() },
        bootstrap: {
          installationId: "installation",
          intakeCredential: { value: "installation-token" },
        },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;
    vi.mocked(submitObsidianLocalizationObservation).mockResolvedValue({
      contributionId: "variant-localization", state: "received",
    } as never);

    const input: Parameters<typeof synchronizeConfiguredPluginTranslations>[0] = {
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    };
    const summary = await synchronizeConfiguredPluginTranslations(input);

    expect(mocks.download).toHaveBeenCalledWith(expect.objectContaining({
      sourceVersionId: "stale-source",
    }));
    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
    expect(submitObsidianLocalizationObservation).not.toHaveBeenCalled();
    expect(state.pluginSubmissions.dataview).toBeUndefined();
    expect(getPluginTranslation(state, "dataview", "zh-CN")?.entries).toHaveLength(1);
    expect(summary).toEqual(expect.objectContaining({
      pulledCount: 1,
      submittedCount: 0,
      requestedCount: 0,
      waitingCount: 0,
      waitingPluginIds: [],
    }));
  });

  it("submits public discovery when the current scan expands a complete older catalog", async () => {
    mocks.resolvePublished.mockReturnValue({
      sourceVersionId: "published-source",
      objectVersionId: "object-version",
      artifactDigest: "a".repeat(64),
      repository: "blacksmithgu/obsidian-dataview",
      catalogIdentityExact: false,
      sourceUnitCount: 1,
      upstreamNativeCount: 0,
      publishedUnitCount: 1,
      missingUnitCount: 0,
    });
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
          sourceLocale: "en", digest: "expanded-catalog", artifactDigest: "a".repeat(64),
          scannedAt: "2026-08-04T00:00:00.000Z",
          catalogIdentity: {
            protocol: "trans-hub.source-catalog-identity", revision: 2,
            resourceKey: "dataview", resourceVersion: "0.5.68", sourceLocale: "en",
            artifactDigest: "a".repeat(64), unitCount: 2, digest: "expanded-identity",
            scopes: [{ scope: "runtime-ui", unitCount: 2, digest: "runtime" }],
          },
          strings: [
            { key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "" },
            { key: "b".repeat(32), source: "Newly discovered source", origins: ["ui-call"], placeholderSignature: "" },
          ],
        },
      },
    };
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: {},
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const summary = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(submitObsidianPluginDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      targetLocales: ["zh-CN"],
    }));
    expect(submitObsidianLocalizationObservation).not.toHaveBeenCalled();
    expect(state.publicPluginDiscoveries.dataview).toEqual(expect.objectContaining({
      targetLocales: ["zh-CN"],
    }));
    expect(summary).toEqual(expect.objectContaining({
      submittedCount: 1, requestedCount: 0, waitingCount: 1,
    }));
  });

  it("routes incomplete authoritative coverage through public discovery", async () => {
    mocks.resolvePublished.mockReturnValue({
      sourceVersionId: "published-source",
      objectVersionId: "object-version",
      artifactDigest: "a".repeat(64),
      repository: "blacksmithgu/obsidian-dataview",
      catalogIdentityExact: true,
      sourceUnitCount: 77,
      upstreamNativeCount: 0,
      publishedUnitCount: 0,
      missingUnitCount: 77,
    });
    mocks.download.mockRejectedValue(new Error("translation_manifest_unavailable:404"));
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
          sourceLocale: "en", digest: "current-catalog", artifactDigest: "a".repeat(64),
          scannedAt: "2026-07-29T00:00:00.000Z",
          strings: [{
            key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "",
          }],
        },
      },
    };
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: {},
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const input: Parameters<typeof synchronizeConfiguredPluginTranslations>[0] = {
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    };
    const summary = await synchronizeConfiguredPluginTranslations(input);

    expect(submitObsidianPluginDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      targetLocales: ["zh-CN"],
    }));
    expect(mocks.resolveIdentity).not.toHaveBeenCalled();
    expect(submitObsidianLocalizationObservation).not.toHaveBeenCalled();
    expect(state.publicPluginDiscoveries.dataview).toEqual(expect.objectContaining({
      targetLocales: ["zh-CN"],
    }));
    expect(state.pluginSubmissions.dataview).toBeUndefined();
    expect(summary).toEqual(expect.objectContaining({
      submittedCount: 1,
      requestedCount: 0,
      waitingCount: 1,
      waitingPluginIds: ["dataview"],
    }));
  });

  it("旧权威需求不再轮询旧接口，改用公共发现", async () => {
    mocks.resolvePublished.mockReturnValue({
      sourceVersionId: "published-source",
      objectVersionId: "object-version",
      artifactDigest: "a".repeat(64),
      catalogIdentityExact: true,
      sourceUnitCount: 1,
      upstreamNativeCount: 0,
      publishedUnitCount: 0,
      missingUnitCount: 1,
    });
    mocks.download.mockRejectedValue(new Error("translation_manifest_unavailable:404"));
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        generic: {
          pluginId: "generic", pluginName: "Generic", pluginVersion: "2.0.0",
          sourceLocale: "en", digest: "catalog-digest", artifactDigest: "a".repeat(64),
          scannedAt: "2026-07-29T00:00:00.000Z",
          strings: [{
            key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "",
          }],
        },
      },
      pluginSubmissions: {
        generic: parseStoredSubmission({
          pluginId: "generic", pluginVersion: "2.0.0", catalogDigest: "catalog-digest",
          adapterProfileDigest: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
          registryPolicyRevision: 24, sourceDiscoveryEpoch: 19,
          installationId: "installation", contributionId: "old-discovery",
          contributionState: "source_attested", repository: "owner/generic",
          localizationTargetLocale: "zh-CN", localizationContributionId: "old-localization",
          localizationContributionState: "received", sourceVersionId: "published-source",
          submittedAt: "2026-07-28T00:00:00.000Z",
        }),
      },
    };
    mocks.resolveIdentity.mockResolvedValue({ repository: "owner/generic", candidateLocators: [] });
    const getContributionStatus = vi.fn();
    const getLocalizationDemandStatus = vi.fn().mockResolvedValue({
      state: "mt_queued", retryAfterSeconds: 3,
      coordinates: [{
        state: "mt_queued", sourceVersionId: "published-source", targetLocale: "zh-CN",
        targetVariant: "default", totalUnitCount: 1, workItemCount: 1,
        nativeUnitCount: 0, queuedCount: 1, runningCount: 0, succeededCount: 0,
        failedCount: 0, reviewedUnitCount: 0, publishedUnitCount: 0,
        manifestId: null, generationNumber: null, retryAfterSeconds: 3,
        failureCode: null, failureRetryable: false, failureAttemptNumber: null,
        updatedAt: "2026-07-29T00:00:00.000Z",
      }],
    });
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: { getContributionStatus, getLocalizationDemandStatus },
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const summary = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(getLocalizationDemandStatus).not.toHaveBeenCalled();
    expect(submitObsidianLocalizationObservation).not.toHaveBeenCalled();
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledOnce();
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      installationId: "installation",
      targetLocales: ["zh-CN"],
    }));
    expect(summary).toEqual(expect.objectContaining({
      submittedCount: 1, requestedCount: 0, waitingCount: 1,
    }));
  });

  it("retries a failed public discovery without falling back to retired writes", async () => {
    mocks.resolvePublished.mockReturnValue({
      sourceVersionId: "published-source",
      objectVersionId: "object-version",
      artifactDigest: "a".repeat(64),
      catalogIdentityExact: true,
      sourceUnitCount: 1,
      upstreamNativeCount: 0,
      publishedUnitCount: 0,
      missingUnitCount: 1,
    });
    mocks.download.mockRejectedValue(new Error("translation_manifest_unavailable:404"));
    vi.mocked(submitObsidianPluginDiscovery)
      .mockRejectedValueOnce(new Error("公共发现暂不可用"))
      .mockResolvedValueOnce(discoveryReceipt({
        discoveryId: "019f0000-0000-7000-8000-000000000041",
        classification: "eligible_for_processing",
        taskState: "queued_for_parsing",
        recordedAt: "2026-08-01T00:00:00Z",
      }));
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        generic: {
          pluginId: "generic", pluginName: "Generic", pluginVersion: "2.0.0",
          sourceLocale: "en", digest: "catalog-digest", artifactDigest: "a".repeat(64),
          scannedAt: "2026-07-29T00:00:00.000Z",
          strings: [{
            key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "",
          }],
        },
      },
    };
    mocks.resolveIdentity.mockResolvedValue({ repository: "owner/generic", candidateLocators: [] });
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: {},
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;
    const input: Parameters<typeof synchronizeConfiguredPluginTranslations>[0] = {
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    };

    const failed = await synchronizeConfiguredPluginTranslations(input);
    expect(failed.failedPluginIds).toEqual(["generic"]);
    expect(state.pluginSubmissions.generic?.lastError?.message).toBe("公共发现暂不可用");

    const recovered = await synchronizeConfiguredPluginTranslations(input);
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledTimes(2);
    expect(submitObsidianLocalizationObservation).not.toHaveBeenCalled();
    expect(state.publicPluginDiscoveries.generic).toEqual(expect.objectContaining({
      discoveryId: "019f0000-0000-7000-8000-000000000041",
    }));
    expect(state.pluginSubmissions.generic?.lastError).toBeUndefined();
    expect(recovered).toEqual(expect.objectContaining({
      submittedCount: 1, requestedCount: 0, failedPluginIds: [],
    }));
  });

  it("keeps translation intersection while discovering incomplete coverage for a new version", async () => {
    const unchangedKey = "b".repeat(32);
    mocks.resolvePublished.mockReturnValue({
      sourceVersionId: "new-source",
      objectVersionId: "new-object-version",
      artifactDigest: "a".repeat(64),
      catalogIdentityExact: true,
      sourceUnitCount: 3,
      upstreamNativeCount: 0,
      publishedUnitCount: 1,
      missingUnitCount: 2,
    });
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        generic: {
          pluginId: "generic", pluginName: "Generic", pluginVersion: "2.0.0",
          sourceLocale: "en", digest: "new-catalog", artifactDigest: "a".repeat(64),
          scannedAt: "2026-07-29T00:00:00.000Z",
          strings: [
            { key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "" },
            { key: unchangedKey, source: "Unchanged source", origins: ["ui-call"], placeholderSignature: "" },
            { key: "c".repeat(32), source: "New source", origins: ["ui-call"], placeholderSignature: "" },
          ],
        },
      },
      pluginTranslations: {
        generic: {
          "zh-CN": {
            pluginId: "generic", pluginVersion: "1.0.0", sourceVersionId: "old-source",
            targetLocale: "zh-CN",
            entries: [{ pluginId: "generic", source: "Unchanged source", target: "沿用译文" }],
            pulledAt: "2026-07-28T00:00:00.000Z",
          },
        },
      },
    };
    mocks.resolveIdentity.mockResolvedValue({ repository: "owner/generic", candidateLocators: [] });
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: {},
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const summary = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(submitObsidianPluginDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      targetLocales: ["zh-CN"],
    }));
    expect(submitObsidianLocalizationObservation).not.toHaveBeenCalled();
    expect(getPluginTranslation(state, "generic", "zh-CN")?.entries).toEqual([
      expect.objectContaining({ source: "Current source", target: "当前译文" }),
    ]);
    expect(state.pluginSubmissions.generic).toBeUndefined();
    expect(summary).toEqual(expect.objectContaining({ submittedCount: 1, requestedCount: 0 }));
  });

  it("does not recreate a stale demand receipt when the current authority needs discovery", async () => {
    mocks.resolvePublished.mockReturnValue({
      sourceVersionId: "new-source",
      objectVersionId: "object-version",
      artifactDigest: "a".repeat(64),
      catalogIdentityExact: true,
      sourceUnitCount: 2,
      upstreamNativeCount: 0,
      publishedUnitCount: 1,
      missingUnitCount: 1,
    });
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        generic: {
          pluginId: "generic", pluginName: "Generic", pluginVersion: "2.0.0",
          sourceLocale: "en", digest: "catalog-digest", artifactDigest: "a".repeat(64),
          scannedAt: "2026-07-29T00:00:00.000Z",
          strings: [
            { key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "" },
            { key: "b".repeat(32), source: "Missing source", origins: ["ui-call"], placeholderSignature: "" },
          ],
        },
      },
    };
    mocks.resolveIdentity.mockResolvedValue({ repository: "owner/generic", candidateLocators: [] });
    const getLocalizationDemandStatus = vi.fn();
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: { getLocalizationDemandStatus },
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const summary = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(submitObsidianPluginDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      targetLocales: ["zh-CN"],
    }));
    expect(getLocalizationDemandStatus).not.toHaveBeenCalled();
    expect(submitObsidianLocalizationObservation).not.toHaveBeenCalled();
    expect(state.pluginSubmissions.generic).toBeUndefined();
    expect(summary).toEqual(expect.objectContaining({ submittedCount: 1, requestedCount: 0 }));
  });

  it("旧精确版本需求不再阻止当前公共发现", async () => {
    mocks.resolvePublished.mockReturnValue({
      sourceVersionId: "published-source",
      objectVersionId: "object-version",
      artifactDigest: "a".repeat(64),
      catalogIdentityExact: true,
      sourceUnitCount: 1,
      upstreamNativeCount: 0,
      publishedUnitCount: 0,
      missingUnitCount: 1,
    });
    mocks.download.mockRejectedValue(new Error("translation_manifest_unavailable:404"));
    vi.mocked(submitObsidianLocalizationObservation).mockResolvedValue({
      contributionId: "localization", state: "received",
    } as never);
    const getLocalizationDemandStatus = vi.fn().mockResolvedValue({
      state: "mt_queued", retryAfterSeconds: 3,
      coordinates: [{
        state: "mt_queued", sourceVersionId: "published-source", targetLocale: "zh-CN",
        targetVariant: "default", totalUnitCount: 1, workItemCount: 1,
        nativeUnitCount: 0, queuedCount: 1, runningCount: 0, succeededCount: 0,
        failedCount: 0, reviewedUnitCount: 0, publishedUnitCount: 0,
        manifestId: null, generationNumber: null, retryAfterSeconds: 3,
        failureCode: null, failureRetryable: false, failureAttemptNumber: null,
        updatedAt: "2026-07-29T00:00:00.000Z",
      }],
    });
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        generic: {
          pluginId: "generic", pluginName: "Generic", pluginVersion: "2.0.0",
          sourceLocale: "en", digest: "catalog-digest", artifactDigest: "a".repeat(64),
          scannedAt: "2026-07-29T00:00:00.000Z",
          strings: [{
            key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "",
          }],
        },
      },
      pluginSubmissions: {
        generic: parseStoredSubmission({
          pluginId: "generic", pluginVersion: "2.0.0", catalogDigest: "catalog-digest",
          adapterProfileDigest: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
          registryPolicyRevision: 24, sourceDiscoveryEpoch: 19,
          installationId: "installation", contributionId: "legacy-discovery",
          contributionState: "source_attested", repository: "owner/generic",
          localizationTargetLocale: "zh-CN", localizationContributionId: "localization",
          localizationContributionState: "received", sourceVersionId: "published-source",
          submittedAt: "2026-07-29T00:00:00.000Z",
        }),
      },
    };
    mocks.resolveIdentity.mockResolvedValue({ repository: "owner/generic", candidateLocators: [] });
    const getContributionStatus = vi.fn();
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: { getContributionStatus, getLocalizationDemandStatus },
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;
    const input: Parameters<typeof synchronizeConfiguredPluginTranslations>[0] = {
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    };

    state = parsePluginState(JSON.parse(JSON.stringify(state)) as unknown);
    const repeated = await synchronizeConfiguredPluginTranslations(input);

    expect(getLocalizationDemandStatus).not.toHaveBeenCalled();
    expect(submitObsidianLocalizationObservation).not.toHaveBeenCalled();
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledOnce();
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      installationId: "installation",
      targetLocales: ["zh-CN"],
    }));
    expect(repeated).toEqual(expect.objectContaining({
      submittedCount: 1, requestedCount: 0, waitingCount: 1,
    }));
    const next = await synchronizeConfiguredPluginTranslations(input);
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledOnce();
    expect(getLocalizationDemandStatus).not.toHaveBeenCalled();
    expect(next).toEqual(expect.objectContaining({
      submittedCount: 0, requestedCount: 0, waitingCount: 1,
    }));
  });

  it("recovers a missing source contribution when coverage is absent but a cached authority source remains", async () => {
    mocks.resolvePublished.mockReturnValue(undefined);
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        generic: {
          pluginId: "generic", pluginName: "Generic", pluginVersion: "2.0.0",
          sourceLocale: "en", digest: "catalog-digest", artifactDigest: "a".repeat(64),
          scannedAt: "2026-07-29T00:00:00.000Z",
          strings: [{
            key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "",
          }],
        },
      },
      pluginSubmissions: {
        generic: {
          pluginId: "generic", pluginVersion: "2.0.0", catalogDigest: "catalog-digest",
          adapterProfileDigest: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
          registryPolicyRevision: 24,
          sourceDiscoveryEpoch: 19, installationId: "installation",
          sourceAuthority: "published", sourceVersionId: "cached-authority-source",
          contributionState: "received", repository: "owner/generic",
          submittedAt: "2026-07-29T00:00:00.000Z",
        },
      },
    };
    mocks.resolveIdentity.mockResolvedValue({ repository: "owner/generic", candidateLocators: [] });
    vi.mocked(submitObsidianPluginDiscovery).mockResolvedValue(discoveryReceipt({
      discoveryId: "019f0000-0000-7000-8000-000000000051",
      classification: "eligible_for_processing", taskState: "queued_for_parsing",
      recordedAt: "2026-07-29T00:00:00.000Z",
    }));
    const getContributionStatus = vi.fn();
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: { getContributionStatus },
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const summary = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(getContributionStatus).not.toHaveBeenCalled();
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledOnce();
    expect(submitObsidianLocalizationObservation).not.toHaveBeenCalled();
    expect(state.publicPluginDiscoveries.generic?.discoveryId)
      .toBe("019f0000-0000-7000-8000-000000000051");
    expect(summary).toEqual(expect.objectContaining({
      submittedCount: 1,
      requestedCount: 0,
      failedPluginIds: [],
    }));
  });

  it("本地变体不再沿旧需求接口刷新", async () => {
    mocks.resolvePublished.mockReturnValue({
      sourceVersionId: "published-source",
      objectVersionId: "object-version",
      artifactDigest: "a".repeat(64),
      catalogIdentityExact: false,
      sourceUnitCount: 2,
      upstreamNativeCount: 0,
      publishedUnitCount: 1,
      missingUnitCount: 1,
    });
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
          sourceLocale: "en", digest: "current-catalog", artifactDigest: "a".repeat(64),
          scannedAt: "2026-07-29T00:00:00.000Z",
          strings: [{
            key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "",
          }],
        },
      },
      pluginSubmissions: {
        dataview: parseStoredSubmission({
          pluginId: "dataview", pluginVersion: "0.5.68", catalogDigest: "current-catalog",
          adapterProfileDigest: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
          registryPolicyRevision: 24,
          sourceDiscoveryEpoch: 19, installationId: "installation",
          contributionId: "discovery-contribution", contributionState: "source_attested",
          localizationTargetLocale: "zh-CN",
          localizationContributionId: "localization-contribution",
          localizationContributionState: "received",
          sourceVersionId: "published-source",
          submittedAt: "2026-07-29T00:00:00.000Z",
        }),
      },
    };
    const getLocalizationDemandStatus = vi.fn().mockResolvedValue({
      state: "distribution_blocked",
      retryAfterSeconds: 0,
      coordinates: [{
        state: "distribution_blocked", sourceVersionId: "blocked-source",
        targetLocale: "zh-CN", targetVariant: "default",
        totalUnitCount: 2, workItemCount: 2, nativeUnitCount: 0,
        queuedCount: 0, runningCount: 0, succeededCount: 2, failedCount: 0,
        reviewedUnitCount: 0, publishedUnitCount: 0,
        manifestId: null, generationNumber: null, retryAfterSeconds: 0,
        failureCode: "PublicDistributionPolicyUnavailable", failureRetryable: false,
        failureAttemptNumber: null, updatedAt: "2026-07-29T00:00:00.000Z",
      }],
    });
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: { getLocalizationDemandStatus },
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;
    vi.mocked(submitObsidianLocalizationObservation).mockResolvedValue({
      contributionId: "replacement-localization", state: "received",
    } as never);

    const summary = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(getLocalizationDemandStatus).not.toHaveBeenCalled();
    expect(submitObsidianLocalizationObservation).not.toHaveBeenCalled();
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledOnce();
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      installationId: "installation",
      targetLocales: ["zh-CN"],
    }));
    expect(summary).toEqual(expect.objectContaining({
      submittedCount: 1, requestedCount: 0, waitingCount: 1,
    }));
  });

  it("lets a complete verified delivery replace stale demand status for the same source", async () => {
    mocks.resolvePublished.mockReturnValue({
      sourceVersionId: "current-source",
      objectVersionId: "object-version",
      artifactDigest: "a".repeat(64),
      catalogIdentityExact: true,
      sourceUnitCount: 1,
      upstreamNativeCount: 0,
      publishedUnitCount: 1,
      missingUnitCount: 0,
    });
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
          sourceLocale: "en", digest: "catalog-digest", artifactDigest: "a".repeat(64),
          scannedAt: "2026-07-31T00:00:00.000Z",
          strings: [{
            key: STRING_KEY, source: "Current source", origins: ["ui-call"],
            placeholderSignature: "",
          }],
        },
      },
      pluginSubmissions: {
        dataview: parseStoredSubmission({
          pluginId: "dataview", pluginVersion: "0.5.68", catalogDigest: "catalog-digest",
          sourceAuthority: "published", repository: "owner/plugin", contributionState: "source_attested",
          sourceVersionId: "current-source", localizationTargetLocale: "zh-CN",
          localizationContributionId: "old-demand", localizationContributionState: "received",
          localizationDemandStatus: {
            state: "distribution_blocked", sourceVersionId: "current-source",
            targetLocale: "zh-CN", targetVariant: "default", totalUnitCount: 1,
            workItemCount: 1, nativeUnitCount: 0, queuedCount: 0, runningCount: 0,
            succeededCount: 1, failedCount: 0, reviewedUnitCount: 0,
            publishedUnitCount: 0, retryAfterSeconds: 0,
            failureCode: "PublicDistributionPolicyUnavailable", failureRetryable: false,
            updatedAt: "2026-07-30T00:00:00.000Z",
          },
          submittedAt: "2026-07-30T00:00:00.000Z",
        }),
      },
    };
    const getLocalizationDemandStatus = vi.fn();
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: { getLocalizationDemandStatus },
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(mocks.download).toHaveBeenCalledOnce();
    expect(getLocalizationDemandStatus).not.toHaveBeenCalled();
    expect(state.pluginSubmissions.dataview).not.toHaveProperty("localizationDemandStatus");
    expect(state.pluginSubmissions.dataview).not.toHaveProperty("localizationContributionId");
    expect(state.pluginTranslations.dataview?.["zh-CN"]?.entries).toHaveLength(1);
  });

  it("clears stale demand state when complete authority coverage is a local artifact variant", async () => {
    mocks.resolvePublished.mockReturnValue({
      sourceVersionId: "current-source",
      objectVersionId: "object-version",
      artifactDigest: "b".repeat(64),
      repository: "blacksmithgu/obsidian-dataview",
      catalogIdentityExact: false,
      sourceUnitCount: 1,
      upstreamNativeCount: 0,
      publishedUnitCount: 1,
      missingUnitCount: 0,
    });
    mocks.resolveArtifact.mockReturnValue("b".repeat(64));
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
          sourceLocale: "en", digest: "local-catalog", artifactDigest: "a".repeat(64),
          scannedAt: "2026-07-31T00:00:00.000Z",
          strings: [
            { key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "" },
            { key: "b".repeat(32), source: "Local-only source", origins: ["ui-call"], placeholderSignature: "" },
          ],
        },
      },
      pluginSubmissions: {
        dataview: parseStoredSubmission({
          pluginId: "dataview", pluginVersion: "0.5.68", catalogDigest: "local-catalog",
          adapterProfileDigest: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
          registryPolicyRevision: 23, sourceDiscoveryEpoch: 19, installationId: "installation",
          sourceAuthority: "published", repository: "owner/plugin", contributionState: "source_attested",
          sourceVersionId: "current-source", localizationTargetLocale: "zh-CN",
          localizationContributionId: "stale-demand", localizationContributionState: "received",
          localizationDemandStatus: {
            state: "export_pending", sourceVersionId: "current-source",
            targetLocale: "zh-CN", targetVariant: "default", totalUnitCount: 1,
            workItemCount: 1, nativeUnitCount: 0, queuedCount: 0, runningCount: 0,
            succeededCount: 1, failedCount: 0, reviewedUnitCount: 0,
            publishedUnitCount: 0, retryAfterSeconds: 30,
            failureRetryable: false, updatedAt: "2026-07-31T00:00:00.000Z",
          },
          submittedAt: "2026-07-31T00:00:00.000Z",
        }),
      },
    };
    vi.mocked(submitObsidianLocalizationObservation).mockResolvedValue({
      contributionId: "variant-demand", state: "received",
    } as never);
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: {},
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const summary = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
    expect(submitObsidianLocalizationObservation).not.toHaveBeenCalled();
    expect(state.pluginSubmissions.dataview).toEqual(expect.objectContaining({
      sourceAuthority: "published",
      sourceVersionId: "current-source",
      registryPolicyRevision: 23,
    }));
    expect(state.pluginSubmissions.dataview).not.toHaveProperty("localizationContributionId");
    expect(state.pluginSubmissions.dataview).not.toHaveProperty("localizationDemandStatus");
    expect(state.pluginTranslations.dataview?.["zh-CN"]?.entries).toHaveLength(1);
    expect(summary).toEqual(expect.objectContaining({
      requestedCount: 0,
      waitingCount: 0,
      waitingPluginIds: [],
    }));
  });

  it("fails closed when complete public coverage has no downloadable export", async () => {
    mocks.resolvePublished.mockReturnValue({
      sourceVersionId: "current-source",
      objectVersionId: "object-version",
      artifactDigest: "a".repeat(64),
      catalogIdentityExact: true,
      sourceUnitCount: 1,
      upstreamNativeCount: 0,
      publishedUnitCount: 1,
      missingUnitCount: 0,
    });
    mocks.download.mockRejectedValue(new Error("translation_manifest_unavailable:404"));
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
          sourceLocale: "en", digest: "catalog-digest", artifactDigest: "a".repeat(64),
          scannedAt: "2026-07-29T00:00:00.000Z",
          strings: [{
            key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "",
          }],
        },
      },
    };
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: {},
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const retryInput: Parameters<typeof synchronizeConfiguredPluginTranslations>[0] = {
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    };
    const summary = await synchronizeConfiguredPluginTranslations(retryInput);

    expect(summary.waitingCount).toBe(0);
    expect(summary.failedPluginIds).toEqual(["dataview"]);
    expect(state.pluginSubmissions.dataview?.pluginVersion).toBe("0.5.68");
    expect(state.pluginSubmissions.dataview?.catalogDigest).toBe("catalog-digest");
    expect(state.pluginSubmissions.dataview?.lastError?.message).toBe(
      "服务器公开目录与译文制品状态不一致，请稍后重试。",
    );
    expect(getPluginTranslation(state, "dataview", "zh-CN")?.entries).toEqual([]);
    const repeated = await synchronizeConfiguredPluginTranslations(retryInput);
    expect(repeated.failedPluginIds).toEqual(["dataview"]);
    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
  });

  it("routes an unpublished local artifact variant through public discovery", async () => {
    mocks.resolveArtifact.mockReturnValue("b".repeat(64));
    mocks.resolvePublished.mockReturnValue(undefined);
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
          sourceLocale: "en", digest: "local-catalog", artifactDigest: "a".repeat(64),
          scannedAt: "2026-07-27T00:00:00.000Z",
          strings: [{
            key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "",
          }],
        },
      },
      pluginSubmissions: {
        dataview: {
          pluginId: "dataview", pluginVersion: "0.5.68", catalogDigest: "local-catalog",
          contributionId: "stale-discovery", contributionState: "source_attested",
          submittedAt: "2026-07-27T00:00:00.000Z",
        },
      },
    };
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: {},
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const summary = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(submitObsidianPluginDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      targetLocales: ["zh-CN"],
    }));
    expect(submitObsidianLocalizationObservation).not.toHaveBeenCalled();
    expect(state.publicPluginDiscoveries.dataview).toEqual(expect.objectContaining({
      targetLocales: ["zh-CN"],
    }));
    expect(summary).toEqual(expect.objectContaining({
      submittedCount: 1,
      requestedCount: 0,
      waitingCount: 1,
      waitingPluginIds: ["dataview"],
    }));
  });

  it("manual resubmit escapes a stale artifact-mismatch pause and submits a recovery observation", async () => {
    mocks.resolveArtifact.mockReturnValue("b".repeat(64));
    mocks.resolvePublished.mockReturnValue(undefined);
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
          sourceLocale: "en", digest: "local-catalog", artifactDigest: "a".repeat(64),
          scannedAt: "2026-07-27T00:00:00.000Z",
          strings: [{
            key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "",
          }],
        },
      },
      pluginSubmissions: {
        dataview: {
          pluginId: "dataview", pluginVersion: "0.5.68", catalogDigest: "local-catalog",
          contributionId: "stale-discovery", contributionState: "rejected",
          submittedAt: "2026-07-27T00:00:00.000Z",
        },
      },
    };
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: {},
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const summary = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], manualResubmitPluginIds: ["dataview"],
      activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    // 手动重试必须提交新的来源发现观察：服务端权威摘要可能是规范化变更
    // 前的陈旧值（R-019 follow-up），新观察触发一次性权威恢复后由服务端
    // 重新获取并核对摘要，而不是让客户端永久暂停。
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledTimes(1);
    expect(summary.submittedCount).toBe(1);
    expect(state.pluginSubmissions.dataview?.lastError?.code).not.toBe(
      "source_artifact_mismatch",
    );
  });

  it("stops applying a withdrawn export and clears its synchronization state", async () => {
    mocks.download.mockRejectedValue(new Error("translation_manifest_unavailable:410"));
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
          sourceLocale: "en", digest: "catalog-digest", artifactDigest: "a".repeat(64),
          scannedAt: "2026-07-18T00:00:00.000Z",
          strings: [{ key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "" }],
        },
      },
      pluginTranslations: {
        dataview: {
          "zh-CN": {
            pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "current-source",
            targetLocale: "zh-CN", entries: [{ pluginId: "dataview", source: "Current source", target: "旧译文" }],
            pulledAt: "2026-07-18T00:00:00.000Z",
          },
          ko: {
            pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "current-source",
            targetLocale: "ko", entries: [{ pluginId: "dataview", source: "Current source", target: "현재 번역" }],
            pulledAt: "2026-07-18T00:00:00.000Z",
          },
        },
      },
      translationExportStates: {
        "current-source:zh-CN:default": { etag: '"old"', manifest: exportManifest },
        "current-source:ko:default": {
          etag: '"ko"',
          manifest: { ...exportManifest, targetLocale: "ko" },
        },
      },
    };
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: {},
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const summary = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "http://127.0.0.1:8000", targetLocale: "zh-CN", excludedPluginIds: [],
      activationStore, translationPackStore, getState: () => state,
      replaceState: (next) => { state = next; }, save: vi.fn().mockResolvedValue(undefined),
    });

    expect(getPluginTranslation(state, "dataview", "zh-CN")?.entries).toEqual([]);
    expect(getPluginTranslation(state, "dataview", "ko")?.entries[0]?.target).toBe("현재 번역");
    expect(Object.keys(state.translationExportStates)).toEqual(["current-source:ko:default"]);
    expect(summary.waitingPluginIds).toEqual([]);
    expect(summary.withdrawnExportPluginIds).toEqual(["dataview"]);
    expect(summary.failedPluginIds).toEqual(["dataview"]);
    expect(state.pluginSubmissions.dataview?.lastError?.message).toBe(
      "服务器公开目录与译文制品状态不一致，请稍后重试。",
    );
  });

  it.each([
    {
      name: "机器翻译运行中",
      state: "mt_running" as const,
      failureCode: null,
      expected: { demandStateCounts: { mt_running: 1 } },
    },
    {
      name: "机器翻译完成后自动发布",
      state: "export_pending" as const,
      failureCode: null,
      expected: {
        demandStateCounts: { export_pending: 1 },
        exportPendingCount: 1,
        exportPendingPluginIds: ["dataview"],
      },
    },
    {
      name: "权威来源刷新中",
      state: "reconciled" as const,
      failureCode: "PublicDistributionAuthorityRefreshing",
      expected: { demandStateCounts: {}, authorityRefreshingCount: 1 },
    },
    {
      name: "同错误码的终态失败",
      state: "rejected" as const,
      failureCode: "PublicDistributionAuthorityRefreshing",
      expected: { demandStateCounts: { rejected: 1 } },
    },
  ])("退役需求状态不再读取旧接口：$name", async ({
    state: demandState,
    failureCode,
  }) => {
    mocks.resolvePublished.mockReturnValue(undefined);
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview",
          pluginName: "Dataview",
          pluginVersion: "0.5.68",
          sourceLocale: "en",
          digest: "catalog-digest",
          artifactDigest: "a".repeat(64),
          scannedAt: "2026-07-18T00:00:00.000Z",
          strings: [{
            key: STRING_KEY,
            source: "Current source",
            origins: ["ui-call"],
            placeholderSignature: "",
          }],
        },
      },
      pluginSubmissions: {
        dataview: parseStoredSubmission({
          pluginId: "dataview",
          pluginVersion: "0.5.68",
          catalogDigest: "catalog-digest",
          adapterProfileDigest: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
          registryPolicyRevision: 24,
          sourceDiscoveryEpoch: 19,
          installationId: "installation",
          contributionId: "discovery-contribution",
          contributionState: "received",
          repository: "blacksmithgu/obsidian-dataview",
          localizationTargetLocale: "zh-CN",
          localizationContributionId: "localization-contribution",
          localizationContributionState: "received",
          submittedAt: "2026-07-18T00:00:00.000Z",
        }),
      },
    };
    const getContributionStatus = vi.fn().mockResolvedValue({ state: "received" });
    const getLocalizationDemandStatus = vi.fn().mockResolvedValue({
      state: demandState,
      retryAfterSeconds: 12,
      coordinates: [{
        state: demandState,
        sourceVersionId: "source-version",
        targetLocale: "zh-CN",
        targetVariant: "default",
        totalUnitCount: 77,
        workItemCount: 7,
        nativeUnitCount: 70,
        queuedCount: 0,
        runningCount: 2,
        succeededCount: 5,
        failedCount: 0,
        reviewedUnitCount: 0,
        publishedUnitCount: 0,
        manifestId: null,
        generationNumber: null,
        retryAfterSeconds: 12,
        failureCode,
        failureRetryable: false,
        failureAttemptNumber: null,
        updatedAt: "2026-07-20T00:00:00.000Z",
      }],
    });
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: { getContributionStatus, getLocalizationDemandStatus },
        bootstrap: {
          installationId: "installation",
          intakeCredential: { value: "installation-token" },
        },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const summary = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "http://127.0.0.1:8000",
      targetLocale: "zh-CN",
      excludedPluginIds: [],
      activationStore,
      translationPackStore,
      getState: () => state,
      replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(getLocalizationDemandStatus).not.toHaveBeenCalled();
    expect(submitObsidianLocalizationObservation).not.toHaveBeenCalled();
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledOnce();
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      installationId: "installation",
      targetLocales: ["zh-CN"],
    }));
    expect(summary).toEqual(expect.objectContaining({
      submittedCount: 1, requestedCount: 0, waitingCount: 1,
    }));
  });

  it.each([
    ["普通终态失败旧回执保持只读", "mt_failed", []],
    [
      "复杂占位符终态保留原文且不提示无效重试",
      "MachineTranslationUnsupportedComplexPlaceholder",
      [],
    ],
  ] as const)("%s", async (_caseName, failureCode, expectedFailedPluginIds) => {
    mocks.resolvePublished.mockReturnValue(undefined);
    const pluginTranslation = (targetLocale: "zh-CN" | "ko", target: string) => ({
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      sourceVersionId: "current-source",
      targetLocale,
      entries: [{ pluginId: "dataview", source: "Current source", target }],
      pulledAt: "2026-07-18T00:00:00.000Z",
    });
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
          sourceLocale: "en", digest: "catalog-digest", artifactDigest: "a".repeat(64),
          scannedAt: "2026-07-18T00:00:00.000Z",
          strings: [{ key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "" }],
        },
      },
      pluginSubmissions: {
        dataview: parseStoredSubmission({
          pluginId: "dataview", pluginVersion: "0.5.68", catalogDigest: "catalog-digest",
          adapterProfileDigest: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
          registryPolicyRevision: 24,
          sourceDiscoveryEpoch: 19,
          installationId: "installation", contributionId: "discovery", contributionState: "received",
          localizationTargetLocale: "zh-CN", localizationContributionId: "localization",
          localizationContributionState: "received", sourceVersionId: "current-source",
          submittedAt: "2026-07-18T00:00:00.000Z",
        }),
      },
      pluginTranslations: {
        dataview: {
          "zh-CN": pluginTranslation("zh-CN", "当前译文"),
          ko: pluginTranslation("ko", "현재 번역"),
        },
      },
      translationExportStates: {
        "current-source:zh-CN:default": { etag: '"zh"', manifest: exportManifest },
        "current-source:ko:default": { etag: '"ko"', manifest: { ...exportManifest, targetLocale: "ko" } },
      },
    };
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: {
          getContributionStatus: vi.fn().mockResolvedValue({ state: "received" }),
          getLocalizationDemandStatus: vi.fn().mockResolvedValue({
            state: "mt_failed",
            retryAfterSeconds: 0,
            coordinates: [{
              state: "mt_failed", sourceVersionId: "current-source", targetLocale: "zh-CN",
              targetVariant: "default", totalUnitCount: 1, workItemCount: 1,
              nativeUnitCount: 0, queuedCount: 0, runningCount: 0, succeededCount: 0,
              failedCount: 1, reviewedUnitCount: 0, publishedUnitCount: 0,
              manifestId: null, generationNumber: 1, retryAfterSeconds: 0,
              failureCode, failureRetryable: false, failureAttemptNumber: 3,
              updatedAt: "2026-07-26T00:00:00.000Z",
            }],
          }),
        },
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const summary = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "http://127.0.0.1:8000", targetLocale: "zh-CN", excludedPluginIds: [],
      activationStore, translationPackStore, getState: () => state,
      replaceState: (next) => { state = next; }, save: vi.fn().mockResolvedValue(undefined),
    });

    expect(getPluginTranslation(state, "dataview", "zh-CN")?.entries[0]?.target).toBe("当前译文");
    expect(getPluginTranslation(state, "dataview", "ko")?.entries[0]?.target).toBe("현재 번역");
    expect(Object.keys(state.translationExportStates).sort()).toEqual([
      "current-source:ko:default", "current-source:zh-CN:default",
    ]);
    expect(summary.failedPluginIds).toEqual(expectedFailedPluginIds);
  });

  it("少量机翻终止失败时保留已公开发布的安全部分译文", async () => {
    const published = {
      sourceVersionId: "current-source",
      objectVersionId: "object-version",
      artifactDigest: "a".repeat(64),
      catalogIdentityExact: true,
      sourceUnitCount: 2,
      upstreamNativeCount: 0,
      publishedUnitCount: 1,
      missingUnitCount: 1,
    };
    mocks.resolvePublished.mockReturnValue(published);
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
          sourceLocale: "en", digest: "catalog-digest", artifactDigest: "a".repeat(64),
          scannedAt: "2026-07-18T00:00:00.000Z",
          strings: [
            { key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "" },
            { key: "b".repeat(32), source: "Rejected source", origins: ["ui-call"], placeholderSignature: "" },
          ],
        },
      },
      pluginSubmissions: {
        dataview: parseStoredSubmission({
          pluginId: "dataview", pluginVersion: "0.5.68", catalogDigest: "catalog-digest",
          adapterProfileDigest: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
          registryPolicyRevision: 24,
          sourceDiscoveryEpoch: 19,
          installationId: "installation", contributionId: "discovery", contributionState: "received",
          localizationTargetLocale: "zh-CN", localizationContributionId: "localization",
          localizationContributionState: "received", sourceVersionId: "current-source",
          submittedAt: "2026-07-18T00:00:00.000Z",
        }),
      },
    };
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: {
          getContributionStatus: vi.fn().mockResolvedValue({ state: "received" }),
          getLocalizationDemandStatus: vi.fn().mockResolvedValue({
            state: "mt_failed",
            retryAfterSeconds: 0,
            coordinates: [{
              state: "mt_failed", sourceVersionId: "current-source", targetLocale: "zh-CN",
              targetVariant: "default", totalUnitCount: 2, workItemCount: 2,
              nativeUnitCount: 0, queuedCount: 0, runningCount: 0, succeededCount: 1,
              failedCount: 1, reviewedUnitCount: 0, publishedUnitCount: 1,
              manifestId: "manifest", generationNumber: 1, retryAfterSeconds: 0,
              failureCode: "MachineTranslationRejected", failureRetryable: false,
              failureAttemptNumber: 1, updatedAt: "2026-07-29T00:00:00.000Z",
            }],
          }),
        },
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const summary = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN", excludedPluginIds: [],
      activationStore, translationPackStore, getState: () => state,
      replaceState: (next) => { state = next; }, save: vi.fn().mockResolvedValue(undefined),
    });

    expect(getPluginTranslation(state, "dataview", "zh-CN")?.entries).toEqual([
      expect.objectContaining({ source: "Current source", target: "当前译文" }),
    ]);
    expect(summary.failedPluginIds).toEqual([]);
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledOnce();
    expect(summary.waitingCount).toBe(1);
    expect(summary.translationCount).toBe(1);
  });

  it("旧阻断需求改用公共发现且不调用退役接口", async () => {
    mocks.resolvePublished.mockReturnValue(undefined);
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
          sourceLocale: "en", digest: "catalog-digest", artifactDigest: "a".repeat(64),
          scannedAt: "2026-07-29T00:00:00.000Z",
          strings: [{
            key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "",
          }],
        },
      },
      pluginTranslations: {
        dataview: {
          "zh-CN": {
            pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "old-source",
            targetLocale: "zh-CN",
            entries: [{ pluginId: "dataview", source: "Current source", target: "当前译文" }],
            pulledAt: "2026-07-29T00:00:00.000Z",
          },
        },
      },
      pluginSubmissions: {
        dataview: parseStoredSubmission({
          pluginId: "dataview", pluginVersion: "0.5.68", catalogDigest: "catalog-digest",
          adapterProfileDigest: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
          registryPolicyRevision: 24,
          sourceDiscoveryEpoch: 19, installationId: "installation",
          contributionId: "discovery-contribution", contributionState: "source_attested",
          localizationTargetLocale: "zh-CN",
          localizationContributionId: "localization-contribution",
          localizationContributionState: "received",
          submittedAt: "2026-07-29T00:00:00.000Z",
        }),
      },
    };
    const getLocalizationDemandStatus = vi.fn().mockResolvedValue({
      state: "distribution_blocked", retryAfterSeconds: 0,
      coordinates: [{
        state: "distribution_blocked", sourceVersionId: "blocked-source",
        targetLocale: "zh-CN", targetVariant: "default",
        totalUnitCount: 1, workItemCount: 1, nativeUnitCount: 0,
        queuedCount: 0, runningCount: 0, succeededCount: 1, failedCount: 0,
        reviewedUnitCount: 0, publishedUnitCount: 0,
        manifestId: null, generationNumber: null, retryAfterSeconds: 0,
        failureCode: "PublicDistributionPolicyUnavailable", failureRetryable: false,
        failureAttemptNumber: null, updatedAt: "2026-07-29T00:00:00.000Z",
      }],
    });
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: {
          getContributionStatus: vi.fn().mockResolvedValue({ state: "source_attested" }),
          getLocalizationDemandStatus,
        },
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const summary = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(getLocalizationDemandStatus).not.toHaveBeenCalled();
    expect(submitObsidianLocalizationObservation).not.toHaveBeenCalled();
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledOnce();
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      installationId: "installation",
      targetLocales: ["zh-CN"],
    }));
    expect(summary).toEqual(expect.objectContaining({
      submittedCount: 1, requestedCount: 0, waitingCount: 1,
    }));
  });

  it("旧需求接口不可用不再阻止公共发现", async () => {
    mocks.resolvePublished.mockReturnValue(undefined);
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
          sourceLocale: "en", digest: "catalog-digest", artifactDigest: "a".repeat(64),
          scannedAt: "2026-08-02T00:00:00.000Z",
          strings: [{ key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "" }],
        },
      },
      pluginSubmissions: {
        dataview: parseStoredSubmission({
          pluginId: "dataview", pluginVersion: "0.5.68", catalogDigest: "catalog-digest",
          adapterProfileDigest: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
          registryPolicyRevision: 24, sourceDiscoveryEpoch: 19, installationId: "installation",
          contributionId: "discovery-contribution", contributionState: "source_attested",
          observationGeneration: 1, sourceVersionId: "current-source",
          localizationTargetLocale: "zh-CN", localizationContributionId: "localization-contribution",
          localizationContributionState: "distribution_blocked",
          localizationDemandStatus: {
            state: "distribution_blocked", sourceVersionId: "current-source",
            targetLocale: "zh-CN", targetVariant: "default", totalUnitCount: 1,
            workItemCount: 1, nativeUnitCount: 0, queuedCount: 0, runningCount: 0,
            succeededCount: 1, failedCount: 0, reviewedUnitCount: 0, publishedUnitCount: 0,
            retryAfterSeconds: 0, failureCode: "PublicDistributionAuthorityRetryExhausted",
            failureRetryable: false, updatedAt: "2026-08-02T00:00:00.000Z",
          },
          submittedAt: "2026-08-02T00:00:00.000Z",
        }),
      },
    };
    const getLocalizationDemandStatus = vi.fn().mockRejectedValue(new Error("retired endpoint unavailable"));
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: { getContributionStatus: vi.fn().mockResolvedValue({ state: "rejected" }), getLocalizationDemandStatus },
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const input: Parameters<typeof synchronizeConfiguredPluginTranslations>[0] = {
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN", excludedPluginIds: [],
      activationStore, translationPackStore, getState: () => state,
      replaceState: (next) => { state = next; }, save: vi.fn().mockResolvedValue(undefined),
    };
    const summary = await synchronizeConfiguredPluginTranslations(input);

    expect(getLocalizationDemandStatus).not.toHaveBeenCalled();
    expect(submitObsidianLocalizationObservation).not.toHaveBeenCalled();
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledOnce();
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      installationId: "installation",
      targetLocales: ["zh-CN"],
    }));
    expect(summary).toEqual(expect.objectContaining({
      submittedCount: 1, requestedCount: 0, waitingCount: 1,
    }));
  });

  it("旧阻断需求没有当前回执时建立公共发现", async () => {
    mocks.resolvePublished.mockReturnValue({
      sourceVersionId: "current-source", objectVersionId: "object-version",
      artifactDigest: "a".repeat(64), catalogIdentityExact: true,
      sourceUnitCount: 1, upstreamNativeCount: 0, publishedUnitCount: 0,
      missingUnitCount: 1,
    });
    mocks.download.mockRejectedValue(new Error("translation_manifest_unavailable:404"));
    vi.mocked(submitObsidianPluginDiscovery).mockResolvedValue(discoveryReceipt({
      discoveryId: "019f0000-0000-7000-8000-000000000060",
      classification: "eligible_for_processing",
      taskState: "queued_for_parsing",
      recordedAt: "2026-08-03T00:00:00Z",
    }));
    let state: PluginState = {
      ...retryablePluginState({
        contributionState: "source_attested",
        sourceVersionId: "current-source",
        localizationTargetLocale: "zh-CN",
        localizationContributionId: "old-localization",
        localizationContributionState: "distribution_blocked",
        localizationDemandStatus: {
          state: "distribution_blocked",
          sourceVersionId: "current-source",
          targetLocale: "zh-CN",
          targetVariant: "default",
          totalUnitCount: 1,
          workItemCount: 1,
          nativeUnitCount: 0,
          queuedCount: 0,
          runningCount: 0,
          succeededCount: 1,
          failedCount: 0,
          reviewedUnitCount: 0,
          publishedUnitCount: 0,
          retryAfterSeconds: 0,
          failureCode: "PublicDistributionAuthorityRetryExhausted",
          failureRetryable: false,
          updatedAt: "2026-08-03T00:00:00.000Z",
        },
      }),
    };
    const getLocalizationDemandStatus = vi.fn().mockResolvedValue({
      state: "distribution_blocked",
      retryAfterSeconds: 0,
      coordinates: [{
        state: "distribution_blocked",
        sourceVersionId: "current-source",
        targetLocale: "zh-CN",
        targetVariant: "default",
        totalUnitCount: 1,
        workItemCount: 1,
        nativeUnitCount: 0,
        queuedCount: 0,
        runningCount: 0,
        succeededCount: 1,
        failedCount: 0,
        reviewedUnitCount: 0,
        publishedUnitCount: 0,
        manifestId: null,
        generationNumber: null,
        retryAfterSeconds: 0,
        failureCode: "PublicDistributionAuthorityRetryExhausted",
        failureRetryable: false,
        failureAttemptNumber: null,
        updatedAt: "2026-08-03T00:00:00.000Z",
      }],
    });
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: {
          getContributionStatus: vi.fn().mockResolvedValue({ state: "source_attested" }),
          getLocalizationDemandStatus,
        },
        bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const summary = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net",
      targetLocale: "zh-CN",
      excludedPluginIds: [],
      manualResubmitPluginIds: ["dataview"],
      activationStore,
      translationPackStore,
      getState: () => state,
      replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(getLocalizationDemandStatus).not.toHaveBeenCalled();
    expect(submitObsidianLocalizationObservation).not.toHaveBeenCalled();
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledOnce();
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      installationId: "installation",
      targetLocales: ["zh-CN"],
    }));
    expect(summary).toEqual(expect.objectContaining({
      submittedCount: 1, requestedCount: 0, waitingCount: 1,
    }));
  });

  it("isolates an exhausted plugin retry budget and continues processing the remaining plugins", async () => {
    mocks.resolvePublished.mockReturnValue(undefined);
    vi.mocked(submitObsidianPluginDiscovery).mockImplementation(({ catalog }) => {
      if (catalog.pluginId === "broken") {
        return Promise.reject(new Error("The bounded retry budget was exhausted"));
      }
      return Promise.resolve(discoveryReceipt({
        discoveryId: "019f0000-0000-7000-8000-000000000061",
        classification: "eligible_for_processing", taskState: "queued_for_parsing",
        recordedAt: "2026-07-20T00:00:00.000Z",
      }));
    });
    const catalog = (pluginId: string) => ({
      pluginId,
      pluginName: pluginId,
      pluginVersion: "1.0.0",
      sourceLocale: "en",
      digest: `${pluginId}-digest`,
      artifactDigest: "a".repeat(64),
      scannedAt: "2026-07-18T00:00:00.000Z",
      strings: [{
        key: STRING_KEY,
        source: "Settings",
        origins: ["ui-call" as const],
        placeholderSignature: "",
      }],
    });
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: { broken: catalog("broken"), working: catalog("working") },
    };
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: {
          getContributionStatus: vi.fn(),
          getLocalizationDemandStatus: vi.fn(),
        },
        bootstrap: {
          installationId: "installation",
          intakeCredential: { value: "installation-token" },
        },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const summary = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "http://127.0.0.1:8000",
      targetLocale: "zh-CN",
      excludedPluginIds: [],
      activationStore,
      translationPackStore,
      getState: () => state,
      replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(summary.failedPluginIds).toEqual(["broken"]);
    expect(summary.submittedCount).toBe(1);
    expect(summary.requestedCount).toBe(0);
    expect(summary.waitingPluginIds).toEqual(["working"]);
    expect(state.publicPluginDiscoveries.working?.discoveryId)
      .toBe("019f0000-0000-7000-8000-000000000061");
    expect(submitObsidianLocalizationObservation).not.toHaveBeenCalled();
  });

  it("submits public discovery again after the installation identity changes", async () => {
    mocks.resolvePublished.mockReturnValue(undefined);
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview",
          pluginName: "Dataview",
          pluginVersion: "0.5.68",
          sourceLocale: "en",
          digest: "catalog-digest",
          artifactDigest: "a".repeat(64),
          scannedAt: "2026-07-18T00:00:00.000Z",
          strings: [{
            key: STRING_KEY,
            source: "Current source",
            origins: ["ui-call"],
            placeholderSignature: "",
          }],
        },
      },
      publicPluginDiscoveries: {
        dataview: {
          discoveryId: "019f0000-0000-7000-8000-000000000070",
          targetLocales: ["zh-CN"], classification: "eligible_for_processing",
          taskState: "queued_for_parsing",
          installationId: "old-installation",
          submittedAt: "2026-07-18T00:00:00.000Z",
        },
      },
    };
    vi.mocked(submitObsidianPluginDiscovery).mockResolvedValue(discoveryReceipt({
      discoveryId: "019f0000-0000-7000-8000-000000000071",
      classification: "eligible_for_processing", taskState: "queued_for_parsing",
      recordedAt: "2026-07-19T00:00:00.000Z",
    }));
    const getContributionStatus = vi.fn();
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: { getContributionStatus },
        bootstrap: {
          installationId: "new-installation",
          intakeCredential: { value: "installation-token" },
        },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const summary = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "http://127.0.0.1:8000",
      targetLocale: "zh-CN",
      excludedPluginIds: [],
      activationStore,
      translationPackStore,
      getState: () => state,
      replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(getContributionStatus).not.toHaveBeenCalled();
    expect(mocks.resolvePublished).toHaveBeenCalledOnce();
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledOnce();
    expect(submitObsidianLocalizationObservation).not.toHaveBeenCalled();
    expect(state.publicPluginDiscoveries.dataview).toEqual(expect.objectContaining({
      installationId: "new-installation",
      discoveryId: "019f0000-0000-7000-8000-000000000071",
    }));
    expect(summary).toEqual(expect.objectContaining({
      submittedCount: 1,
      requestedCount: 0,
      waitingCount: 1,
    }));
  });

  it("submits a changed runtime catalog identity exactly once", async () => {
    mocks.resolvePublished.mockReturnValue(undefined);
    let state: PluginState = {
      ...retryablePluginState(),
      publicPluginDiscoveries: {
        dataview: {
          statusRevision: 2,
          receiptId: "019f0000-0000-7000-8000-000000000072",
          discoveryId: "019f0000-0000-7000-8000-000000000070",
          taskId: "019f0000-0000-7000-8000-000000000073",
          targetLocales: ["zh-CN"],
          classification: "eligible_for_processing",
          taskState: "queued_for_parsing",
          taskGeneration: 1,
          attemptCount: 0,
          outcome: "created",
          commandDigestHex: "a".repeat(64),
          credentialEpoch: 1,
          receiptRecordedAt: "2026-07-18T00:00:00.000Z",
          updatedAt: "2026-07-18T00:00:00.000Z",
          retryAfterSeconds: 0,
          retryAllowed: false,
          retryGeneration: 0,
          installationId: "installation",
          submittedAt: "2026-07-18T00:00:00.000Z",
          sourceDiscoveryEpoch: 19,
          catalogIdentityDigest: "old-catalog-digest",
        },
      },
    };
    vi.mocked(submitObsidianPluginDiscovery).mockResolvedValue(discoveryReceipt({
      discoveryId: "019f0000-0000-7000-8000-000000000071",
      classification: "eligible_for_processing",
      taskState: "queued_for_parsing",
      recordedAt: "2026-07-19T00:00:00.000Z",
    }));
    const input: Parameters<typeof synchronizeConfiguredPluginTranslations>[0] = {
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore: activationWithContributionState("received"),
      translationPackStore, getState: () => state,
      replaceState: (next) => { state = next; }, save: vi.fn().mockResolvedValue(undefined),
    };

    await synchronizeConfiguredPluginTranslations(input);
    await synchronizeConfiguredPluginTranslations(input);

    expect(submitObsidianPluginDiscovery).toHaveBeenCalledOnce();
    expect(state.publicPluginDiscoveries.dataview).toMatchObject({
      discoveryId: "019f0000-0000-7000-8000-000000000071",
      catalogIdentityDigest: "catalog-digest",
    });
  });

  it("旧发现代次只进入当前公共发现，不重建旧写入", async () => {
    mocks.resolvePublished.mockReturnValue(undefined);
    let state: PluginState = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview",
          pluginName: "Dataview",
          pluginVersion: "0.5.68",
          sourceLocale: "en",
          digest: "catalog-digest",
          artifactDigest: "a".repeat(64),
          scannedAt: "2026-07-18T00:00:00.000Z",
          strings: [{
            key: STRING_KEY,
            source: "Current source",
            origins: ["ui-call"],
            placeholderSignature: "",
          }],
        },
      },
      pluginSubmissions: {
        dataview: parseStoredSubmission({
          pluginId: "dataview",
          pluginVersion: "0.5.68",
          catalogDigest: "catalog-digest",
          adapterProfileDigest: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518", registryPolicyRevision: 24,
          installationId: "installation",
          contributionId: "old-discovery",
          contributionState: "received",
          localizationTargetLocale: "zh-CN",
          localizationContributionId: "old-localization",
          localizationContributionState: "received",
          submittedAt: "2026-07-18T00:00:00.000Z",
        }),
      },
    };
    const getContributionStatus = vi.fn();
    const getLocalizationDemandStatus = vi.fn().mockResolvedValue({ state: "mt_running" });
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: { getContributionStatus, getLocalizationDemandStatus },
        bootstrap: {
          installationId: "installation",
          intakeCredential: { value: "installation-token" },
        },
        authorityWorkspaceId: "workspace",
      }),
    } as unknown as ActivationStore;

    const summary = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "http://127.0.0.1:8000",
      targetLocale: "zh-CN",
      excludedPluginIds: [],
      activationStore,
      translationPackStore,
      getState: () => state,
      replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(getLocalizationDemandStatus).not.toHaveBeenCalled();
    expect(submitObsidianLocalizationObservation).not.toHaveBeenCalled();
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledOnce();
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      installationId: "installation",
      targetLocales: ["zh-CN"],
    }));
    expect(summary).toEqual(expect.objectContaining({
      submittedCount: 1, requestedCount: 0, waitingCount: 1,
    }));
  });

  it("replaces a rejected legacy source observation with public discovery", async () => {
    mocks.resolvePublished.mockReturnValue(undefined);
    let state = retryablePluginState();
    vi.mocked(submitObsidianPluginDiscovery).mockResolvedValue(discoveryReceipt({
      discoveryId: "019f0000-0000-7000-8000-000000000081",
      classification: "eligible_for_processing", taskState: "queued_for_parsing",
      recordedAt: "2026-07-23T00:00:00.000Z",
    }));
    const activationStore = activationWithContributionState("rejected");

    const summary = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(submitObsidianPluginDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      targetLocales: ["zh-CN"],
    }));
    expect(submitObsidianLocalizationObservation).not.toHaveBeenCalled();
    expect(state.publicPluginDiscoveries.dataview).toEqual(expect.objectContaining({
      discoveryId: "019f0000-0000-7000-8000-000000000081",
    }));
    expect(summary).toEqual(expect.objectContaining({ submittedCount: 1, requestedCount: 0 }));
  });

  it("manual resubmit retries a blocked public discovery without legacy generations", async () => {
    mocks.resolvePublished.mockReturnValue(undefined);
    let state: PluginState = {
      ...retryablePluginState({ observationGeneration: 1 }),
      publicPluginDiscoveries: {
        dataview: {
          statusRevision: 2,
          receiptId: "019f0000-0000-7000-8000-000000000092",
          discoveryId: "019f0000-0000-7000-8000-000000000090",
          taskId: null,
          targetLocales: ["zh-CN"], classification: "blocked", taskState: "blocked",
          taskGeneration: null,
          attemptCount: 0,
          outcome: "negative_cached",
          commandDigestHex: "a".repeat(64),
          credentialEpoch: 1,
          receiptRecordedAt: "2026-07-23T00:00:00.000Z",
          updatedAt: "2026-07-23T00:00:00.000Z",
          retryAfterSeconds: 0,
          retryAllowed: true,
          blockedReasonCode: "registry_projection_stale",
          retryGeneration: 0,
          installationId: "installation", submittedAt: "2026-07-23T00:00:00.000Z",
          sourceDiscoveryEpoch: 19,
          catalogIdentityDigest: "catalog-digest",
          localizationProjection: {
            kind: "public_localization_status_projection",
            protocol: { protocol: "trans-hub.client-protocol", revision: 1, schemaRevision: 1 },
            projectionRevision: 1,
            discoveryId: "019f0000-0000-7000-8000-000000000090",
            registryKey: "official-directory",
            externalObjectId: "dataview",
            targetLocale: "zh-CN" as never,
            catalogIdentityDigest: null,
            sourceVersionId: null,
            stage: "blocked",
            updatedAt: "2026-07-23T00:01:00.000Z",
          },
        },
      },
    };
    vi.mocked(submitObsidianPluginDiscovery).mockResolvedValue(discoveryReceipt({
      discoveryId: "019f0000-0000-7000-8000-000000000091",
      classification: "eligible_for_processing", taskState: "queued_for_parsing",
      recordedAt: "2026-07-24T00:00:00.000Z",
    }));
    const activationStore = activationWithContributionState("rejected", discoveryStatus({
      taskId: null,
      classification: "blocked",
      taskState: "blocked",
      taskGeneration: null,
      outcome: "negative_cached",
      retryAllowed: true,
      blockedReasonCode: "registry_projection_stale",
    }));

    await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], manualResubmitPluginIds: ["dataview"],
      activationStore, translationPackStore, getState: () => state,
      replaceState: (next) => { state = next; }, save: vi.fn().mockResolvedValue(undefined),
    });

    expect(submitObsidianPluginDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      targetLocales: ["zh-CN"],
      observationGeneration: 1,
    }));
    expect(submitObsidianLocalizationObservation).not.toHaveBeenCalled();
    expect(state.publicPluginDiscoveries.dataview?.discoveryId)
      .toBe("019f0000-0000-7000-8000-000000000091");
  });

  it("manual resubmit does not retry result_verified without a current translation", async () => {
    mocks.resolvePublished.mockReturnValue(undefined);
    let state: PluginState = {
      ...retryablePluginState(),
      publicPluginDiscoveries: {
        dataview: {
          statusRevision: 2,
          receiptId: "019f0000-0000-7000-8000-000000000092",
          discoveryId: "019f0000-0000-7000-8000-000000000090",
          taskId: "019f0000-0000-7000-8000-000000000093",
          targetLocales: ["zh-CN"],
          classification: "eligible_for_processing",
          taskState: "result_verified",
          taskGeneration: null,
          attemptCount: 1,
          outcome: "idempotent_replay",
          commandDigestHex: "a".repeat(64),
          credentialEpoch: 1,
          receiptRecordedAt: "2026-07-23T00:00:00.000Z",
          updatedAt: "2026-07-23T00:00:00.000Z",
          retryAfterSeconds: 0,
          retryAllowed: false,
          retryGeneration: 0,
          installationId: "installation",
          submittedAt: "2026-07-23T00:00:00.000Z",
          sourceDiscoveryEpoch: 19,
          catalogIdentityDigest: "catalog-digest",
        },
      },
    };
    vi.mocked(submitObsidianPluginDiscovery).mockResolvedValue(discoveryReceipt({
      discoveryId: "019f0000-0000-7000-8000-000000000091",
      classification: "pending_registry_verification",
      taskState: "discovered",
      recordedAt: "2026-07-24T00:00:00.000Z",
    }));

    await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], manualResubmitPluginIds: ["dataview"],
      activationStore: activationWithContributionState("received", discoveryStatus({
        taskState: "result_verified",
        outcome: "created",
      })), translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
    expect(state.publicPluginDiscoveries.dataview?.discoveryId)
      .toBe("019f0000-0000-7000-8000-000000000090");
  });

  it("manual resubmit does not replace a rejected source observation while discovery is healthy", async () => {
    mocks.resolvePublished.mockReturnValue(undefined);
    let state: PluginState = {
      ...retryablePluginState({ contributionState: "rejected" }),
      publicPluginDiscoveries: {
        dataview: {
          statusRevision: 2,
          receiptId: "019f0000-0000-7000-8000-000000000092",
          discoveryId: "019f0000-0000-7000-8000-000000000090",
          taskId: "019f0000-0000-7000-8000-000000000093",
          targetLocales: ["zh-CN"], classification: "pending_registry_verification", taskState: "discovered",
          taskGeneration: 1,
          attemptCount: 0,
          outcome: "created",
          commandDigestHex: "a".repeat(64),
          credentialEpoch: 1,
          receiptRecordedAt: "2026-07-23T00:00:00.000Z",
          updatedAt: "2026-07-23T00:00:00.000Z",
          retryAfterSeconds: 0,
          retryAllowed: false,
          retryGeneration: 0,
          installationId: "installation", submittedAt: "2026-07-23T00:00:00.000Z",
          sourceDiscoveryEpoch: 19,
          catalogIdentityDigest: "catalog-digest",
        },
      },
    };
    vi.mocked(submitObsidianPluginDiscovery).mockResolvedValue(discoveryReceipt({
      discoveryId: "019f0000-0000-7000-8000-000000000091",
      classification: "eligible_for_processing", taskState: "queued_for_parsing",
      recordedAt: "2026-07-24T00:00:00.000Z",
    }));
    const activationStore = activationWithContributionState("rejected", discoveryStatus({
      classification: "pending_registry_verification",
      taskState: "discovered",
    }));

    await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], manualResubmitPluginIds: ["dataview"],
      activationStore, translationPackStore, getState: () => state,
      replaceState: (next) => { state = next; }, save: vi.fn().mockResolvedValue(undefined),
    });

    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
    expect(state.publicPluginDiscoveries.dataview?.discoveryId)
      .toBe("019f0000-0000-7000-8000-000000000090");
  });
});

function catalogForAutomaticProjectionRefresh() {
  return {
    pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
    sourceLocale: "en", digest: "catalog-digest", artifactDigest: "a".repeat(64),
    scannedAt: "2026-09-05T00:00:00.000Z",
    strings: [{ key: STRING_KEY, source: "Current source", origins: ["ui-call" as const], placeholderSignature: "" }],
  };
}

function discoveryWithoutProjection() {
  return {
    statusRevision: 2 as const, receiptId: "receipt", discoveryId: "discovery", taskId: "task",
    targetLocales: ["zh-CN" as const], classification: "eligible_for_processing",
    taskState: "result_verified", taskGeneration: 1, attemptCount: 1,
    outcome: "completed", commandDigestHex: "c".repeat(64), credentialEpoch: 1,
    receiptRecordedAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z", retryAfterSeconds: 0,
    retryAllowed: false, retryGeneration: 0, installationId: "installation",
    submittedAt: "2026-09-05T00:00:00.000Z", catalogIdentityDigest: "catalog-digest",
    sourceDiscoveryEpoch: 19,
  };
}

function currentPublishedProjection(sourceVersionId = "current-source") {
  return {
    kind: "public_localization_status_projection" as const,
    protocol: { protocol: "trans-hub.client-protocol" as const, revision: 1 as const, schemaRevision: 1 as const },
    projectionRevision: 1 as const, discoveryId: "discovery", registryKey: "official-directory",
    externalObjectId: "dataview", targetLocale: "zh-CN" as never,
    catalogIdentityDigest: null, sourceVersionId, stage: "published" as const,
    updatedAt: "2026-09-05T00:01:00.000Z",
  };
}

function bulkProjectionState(count: number): PluginState {
  return {
    ...EMPTY_PLUGIN_STATE,
    pluginCatalogs: Object.fromEntries(Array.from({ length: count }, (_unused, index) => {
      const pluginId = `plugin-${index}`;
      return [pluginId, {
        pluginId, pluginName: pluginId, pluginVersion: "0.5.68",
        sourceLocale: "en", digest: `catalog-${index}`, artifactDigest: "a".repeat(64),
        scannedAt: "2026-09-05T00:00:00.000Z",
        strings: [{ key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "" }],
      }];
    })),
    publicPluginDiscoveries: Object.fromEntries(Array.from({ length: count }, (_unused, index) => {
      const pluginId = `plugin-${index}`;
      return [pluginId, {
        statusRevision: 2, receiptId: `receipt-${index}`, discoveryId: `discovery-${index}`,
        taskId: `task-${index}`, targetLocales: ["zh-CN"],
        classification: "eligible_for_processing", taskState: "result_verified",
        taskGeneration: 1, attemptCount: 1, outcome: "completed",
        commandDigestHex: "c".repeat(64), credentialEpoch: 1,
        receiptRecordedAt: "2026-09-05T00:00:00.000Z",
        updatedAt: "2026-09-05T00:00:00.000Z", retryAfterSeconds: 0,
        retryAllowed: false, retryGeneration: 0, installationId: "installation",
        submittedAt: "2026-09-05T00:00:00.000Z",
        catalogIdentityDigest: `catalog-${index}`, sourceDiscoveryEpoch: 19,
      }];
    })),
  };
}

function bulkProjection(
  discoveryId: string,
  sourceVersionId: string | null,
  stage: "parsing" | "published",
) {
  const pluginId = discoveryId.replace(/^discovery-/u, "plugin-");
  return {
    kind: "public_localization_status_projection" as const,
    protocol: { protocol: "trans-hub.client-protocol" as const, revision: 1 as const, schemaRevision: 1 as const },
    projectionRevision: 1 as const, discoveryId, registryKey: "official-directory",
    externalObjectId: pluginId, targetLocale: "zh-CN" as never,
    catalogIdentityDigest: null, sourceVersionId, stage,
    updatedAt: "2026-09-05T00:01:00.000Z",
  };
}

function retryablePluginState(
  extra: Readonly<Record<string, unknown>> = {},
): PluginState {
  return {
    ...EMPTY_PLUGIN_STATE,
    pluginCatalogs: {
      dataview: {
        pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
        sourceLocale: "en", digest: "catalog-digest", artifactDigest: "a".repeat(64),
        scannedAt: "2026-07-18T00:00:00.000Z",
        strings: [{ key: STRING_KEY, source: "Current source", origins: ["ui-call"], placeholderSignature: "" }],
      },
    },
    pluginSubmissions: {
      dataview: parseStoredSubmission({
        pluginId: "dataview", pluginVersion: "0.5.68", catalogDigest: "catalog-digest",
        adapterProfileDigest: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
        registryPolicyRevision: 24,
        sourceDiscoveryEpoch: 19,
        installationId: "installation", contributionId: "rejected-discovery",
        contributionState: "received", repository: "blacksmithgu/obsidian-dataview",
        submittedAt: "2026-07-18T00:00:00.000Z",
        ...extra,
      }),
    },
  };
}

function activationWithContributionState(
  state: string,
  publicDiscoveryStatus?: PublicDiscoveryStatus,
): ActivationStore {
  return {
    client: vi.fn().mockResolvedValue({
      client: {
        getContributionStatus: vi.fn().mockResolvedValue({ state }),
        getPublicLocalizationStatusBatch: vi.fn().mockImplementation(emptyProjections),
        ...(publicDiscoveryStatus === undefined
          ? {}
          : { getPublicDiscoveryStatus: vi.fn().mockResolvedValue(publicDiscoveryStatus) }),
      },
      bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
      authorityWorkspaceId: "workspace",
    }),
  } as unknown as ActivationStore;
}

function parseStoredSubmission(value: unknown) {
  const parsed = parsePluginState({ pluginSubmissions: { fixture: value } }).pluginSubmissions.fixture;
  if (parsed === undefined) throw new Error("invalid_stored_submission_fixture");
  return parsed;
}

function emptyProjections(request: { queries: readonly { discoveryId: string; targetLocale: string }[] }) {
  return Promise.resolve({ items: request.queries.map((query) => ({ ...query, found: false, projection: null })) });
}

function lifecycleFromState(getState: () => PluginState) {
  return vi.fn((discoveryId: string) => {
    const stored = Object.values(getState().publicPluginDiscoveries).find((item) => item.discoveryId === discoveryId)!;
    return Promise.resolve(discoveryStatus({
      ...stored, receiptId: stored.receiptId!, statusRevision: 2,
      classification: stored.classification as PublicDiscoveryStatus["classification"],
      taskState: stored.taskState as PublicDiscoveryStatus["taskState"],
      outcome: stored.outcome as PublicDiscoveryStatus["outcome"],
      taskGeneration: stored.taskGeneration ?? null, attemptCount: stored.attemptCount ?? 0,
      receiptRecordedAt: stored.receiptRecordedAt!, updatedAt: stored.updatedAt!,
      retryAfterSeconds: stored.retryAfterSeconds ?? 0, retryAllowed: stored.retryAllowed ?? false,
      blockedReasonCode: stored.blockedReasonCode as PublicDiscoveryStatus["blockedReasonCode"] ?? null,
      commandDigest: { algorithm: "sha256", domain: "request", hex: stored.commandDigestHex! as never },
    }));
  });
}

describe("shared status refresh boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadCatalog.mockResolvedValue({ objects: [] });
    mocks.resolvePublished.mockReturnValue(undefined);
    mocks.resolveArtifact.mockReturnValue(undefined);
    vi.mocked(submitObsidianPluginDiscovery).mockResolvedValue(discoveryReceipt({}));
  });

  it("does not count a historical blocked receipt when the current source is published", async () => {
    const f = statusRefreshFixture();
    f.client.getPublicDiscoveryStatus.mockResolvedValue(discoveryStatus({
      discoveryId: "discovery-0", receiptId: "receipt-0", taskState: "blocked",
      classification: "blocked", blockedReasonCode: "registry_binding_changed",
      updatedAt: "2026-09-07T00:00:00Z",
    }));
    f.client.getPublicLocalizationStatusBatch.mockResolvedValue({ items: [{
      discoveryId: "discovery-0", targetLocale: "zh-CN", found: true,
      projection: bulkProjection("discovery-0", "current-source", "published"),
    }] });
    const result = await f.run("manual");
    expect(result.blockedPluginIds ?? []).toEqual([]);
    expect(result.waitingCount).toBe(0);
  });

  it("keeps a directory failure actionable instead of submitting another discovery", async () => {
    const f = statusRefreshFixture();
    mocks.loadCatalog.mockResolvedValue({ objects: [], failedPluginIds: ["plugin-0"] });
    const result = await f.run("automatic");
    expect(result.failedPluginIds).toContain("plugin-0");
    expect(f.state().pluginSubmissions["plugin-0"]?.lastError?.code).toBe("public_catalog_unavailable");
    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
  });

  it.each([false, true])("自动刷新不重提过期目录，但标记为可手动恢复 (retry=%s)", async (retryAllowed) => {
    const f = statusRefreshFixture();
    f.client.getPublicDiscoveryStatus.mockResolvedValue(discoveryStatus({
      discoveryId: "discovery-0", receiptId: "receipt-0", taskState: "blocked",
      classification: "blocked", retryAllowed, retryAfterSeconds: retryAllowed ? 0 : 90,
      blockedReasonCode: "registry_projection_stale", updatedAt: "2026-09-07T00:00:00Z",
    }));
    const first = await f.run("automatic");
    const second = await f.run("automatic");
    expect(f.state().publicPluginDiscoveries["plugin-0"]).toMatchObject({
      taskState: "blocked", classification: "blocked", retryAllowed,
      retryAfterSeconds: retryAllowed ? 0 : 90, blockedReasonCode: "registry_projection_stale",
    });
    expect(first.waitingCount).toBe(0);
    expect(second.waitingCount).toBe(0);
    expect(first.failedPluginIds).toEqual(["plugin-0"]);
    expect(f.save).toHaveBeenCalledOnce();
    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
  });

  it.each([100, 101, 201])("manually refreshes %s entries with bounded lifecycle concurrency", async (count) => {
    const f = statusRefreshFixture(count);
    let active = 0;
    let peak = 0;
    const read = lifecycleFromState(f.state);
    f.client.getPublicDiscoveryStatus.mockImplementation(async (id: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return read(id);
    });
    f.client.getPublicLocalizationStatusBatch.mockImplementation((request) => Promise.resolve({
      items: request.queries.map((query) => ({ ...query, found: true,
        projection: bulkProjection(query.discoveryId, null, "parsing") })),
    }));
    const result = await f.run("manual");
    expect(f.client.getPublicLocalizationStatusBatch.mock.calls.map(([request]) => request.queries.length))
      .toEqual(count === 100 ? [100] : count === 101 ? [100, 1] : [100, 100, 1]);
    expect(peak).toBe(4);
    expect(f.client.getPublicDiscoveryStatus).toHaveBeenCalledTimes(count);
    expect(result.statusRead).toEqual({ kind: "fresh" });
    expect(Object.values(f.state().publicPluginDiscoveries).every((item) => item.localizationProjection?.stage === "parsing")).toBe(true);
  });

  it("manual middle batch failure preserves its facts while other batches update", async () => {
    const f = statusRefreshFixture(201);
    const before = f.state();
    f.client.getPublicLocalizationStatusBatch.mockImplementation((request) => {
      if (request.queries[0]?.discoveryId === "discovery-100") return Promise.reject(new Error("offline"));
      return Promise.resolve({ items: request.queries.map((query) => ({ ...query, found: true,
        projection: bulkProjection(query.discoveryId, null, "parsing") })) });
    });
    const result = await f.run("manual");
    expect(f.state().publicPluginDiscoveries["plugin-0"]?.localizationProjection?.stage).toBe("parsing");
    expect(f.state().publicPluginDiscoveries["plugin-200"]?.localizationProjection?.stage).toBe("parsing");
    for (let i = 100; i < 200; i += 1) {
      expect(f.state().publicPluginDiscoveries[`plugin-${i}`]).toBe(before.publicPluginDiscoveries[`plugin-${i}`]);
    }
    expect(result.statusRead).toEqual({ kind: "stale", failedSources: ["public-localization"],
      failedPluginIds: Array.from({ length: 100 }, (_, i) => `plugin-${i + 100}`) });
    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
  });

  for (const mode of ["automatic", "manual"] as const) {
    for (const source of ["public-discovery", "public-localization"] as const) {
      it.each([401, 403, 429, 503, "offline"])(`${mode} ${source} %s preserves facts with zero writes`, async (status) => {
        const f = statusRefreshFixture();
        const before = f.state();
        const error = status === "offline" ? new Error("offline") : statusError(status as number, source);
        if (source === "public-discovery") {
          f.client.getPublicDiscoveryStatus.mockRejectedValue(error);
          f.client.getPublicLocalizationStatusBatch.mockResolvedValue({ items: [{
            discoveryId: "discovery-0", targetLocale: "zh-CN", found: true,
            projection: bulkProjection("discovery-0", "new-source", "published"),
          }] });
        } else {
          f.client.getPublicLocalizationStatusBatch.mockRejectedValue(error);
          f.client.getPublicDiscoveryStatus.mockResolvedValue(discoveryStatus({
            discoveryId: "discovery-0", receiptId: "receipt-0", taskState: "blocked",
            updatedAt: "2026-09-07T00:00:00Z",
          }));
        }
        const result = await f.run(mode);
        expect(f.state()).toBe(before);
        expect(f.save).not.toHaveBeenCalled();
        expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
        expect(mocks.download).not.toHaveBeenCalled();
        expect(result.statusRead).toEqual({ kind: "stale", failedPluginIds: ["plugin-0"], failedSources: [source] });
      });
    }
  }

  it.each(["receipt", "discovery"])("rejects mismatched lifecycle %s identity", async (identity) => {
    const f = statusRefreshFixture();
    const before = f.state();
    f.client.getPublicDiscoveryStatus.mockResolvedValue(discoveryStatus({
      discoveryId: identity === "discovery" ? "wrong" : "discovery-0",
      receiptId: identity === "receipt" ? "wrong" : "receipt-0", taskState: "blocked",
      updatedAt: "2026-09-07T00:00:00Z",
    }));
    expect((await f.run("automatic")).statusRead?.kind).toBe("stale");
    expect(f.state()).toBe(before);
    expect(f.save).not.toHaveBeenCalled();
    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
  });

  it("does not recover a missing receipt during automatic polling", async () => {
    const f = statusRefreshFixture();
    f.client.getPublicDiscoveryStatus.mockRejectedValue(statusError(404, "public-discovery"));
    await f.run("automatic");
    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  });

  it("manually recovers an exact authenticated missing receipt once", async () => {
    const f = statusRefreshFixture();
    const read = lifecycleFromState(f.state);
    f.client.getPublicDiscoveryStatus.mockImplementation((id) => id === "discovery-0"
      ? Promise.reject(statusError(404, "public-discovery")) : read(id));
    expect((await f.run("manual")).submittedCount).toBe(1);
    expect((await f.run("manual")).submittedCount).toBe(0);
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledOnce();
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledWith(expect.objectContaining({ observationGeneration: 1 }));
  });

  it("does not mistake unrelated 404 for authenticated receipt absence", async () => {
    const f = statusRefreshFixture();
    f.client.getPublicDiscoveryStatus.mockRejectedValue(statusError(404, "public-localization"));
    await f.run("manual");
    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  });

  it("preserves a replacement receipt installed while reads were in flight", async () => {
    const f = statusRefreshFixture();
    const read = lifecycleFromState(f.state);
    f.client.getPublicDiscoveryStatus.mockImplementation(async (id) => {
      const response = await read(id);
      const current = f.state();
      f.replace({ ...current, publicPluginDiscoveries: { ...current.publicPluginDiscoveries,
        "plugin-0": { ...current.publicPluginDiscoveries["plugin-0"], receiptId: "replacement" } } });
      return response;
    });
    await f.run("automatic");
    expect(f.state().publicPluginDiscoveries["plugin-0"]?.receiptId).toBe("replacement");
    expect(f.save).not.toHaveBeenCalled();
    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
  });

  it("coalesces concurrent recovery and preserves an unrelated scan during the write", async () => {
    const f = statusRefreshFixture();
    f.client.getPublicDiscoveryStatus.mockRejectedValue(statusError(404, "public-discovery"));
    let release!: (receipt: PublicDiscoveryReceipt) => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    vi.mocked(submitObsidianPluginDiscovery).mockImplementation(() => {
      started();
      return new Promise<PublicDiscoveryReceipt>((resolve) => { release = resolve; });
    });
    const first = f.run("manual");
    const second = f.run("manual");
    await startedPromise;
    const scanned = { ...catalogForAutomaticProjectionRefresh(), pluginId: "new-scan" };
    f.replace({ ...f.state(), pluginCatalogs: { ...f.state().pluginCatalogs, "new-scan": scanned } });
    release(discoveryReceipt({}));
    await Promise.all([first, second]);
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledOnce();
    expect(f.state().publicPluginDiscoveries["plugin-0"]?.receiptId).toBe(discoveryReceipt({}).receiptId);
    expect(f.state().pluginCatalogs["new-scan"]).toBe(scanned);
    expect(f.save).toHaveBeenCalledOnce();
  });

  it("does not roll back a concurrent state replacement after a save fails", async () => {
    const f = statusRefreshFixture();
    f.client.getPublicDiscoveryStatus.mockResolvedValue(discoveryStatus({
      discoveryId: "discovery-0", receiptId: "receipt-0", taskState: "blocked",
      updatedAt: "2026-09-07T00:00:00Z",
    }));
    let concurrent!: PluginState;
    f.save.mockImplementation(() => {
      concurrent = { ...f.state(), pluginCatalogs: {} };
      f.replace(concurrent);
      return Promise.reject(new Error("disk full"));
    });
    await expect(f.run("automatic")).rejects.toThrow("disk full");
    expect(f.state()).toBe(concurrent);
  });

  it("rolls back a failed status save", async () => {
    const f = statusRefreshFixture();
    const before = f.state();
    f.client.getPublicDiscoveryStatus.mockResolvedValue(discoveryStatus({
      discoveryId: "discovery-0", receiptId: "receipt-0", taskState: "blocked",
      updatedAt: "2026-09-07T00:00:00Z",
    }));
    f.save.mockRejectedValue(new Error("disk full"));
    await expect(f.run("automatic")).rejects.toThrow("disk full");
    expect(f.state()).toBe(before);
  });
});

function statusError(status: number, source: "public-discovery" | "public-localization") {
  return Object.assign(new Error(`HTTP ${status}`), { code: "PC_HTTP_STATUS",
    diagnostic: { status, operation: `${source}-status` } });
}

function statusRefreshFixture(count = 1) {
  let state = bulkProjectionState(count);
  state = { ...state, publicPluginDiscoveries: Object.fromEntries(Object.entries(state.publicPluginDiscoveries)
    .map(([id, discovery]) => [id, { ...discovery, taskState: "queued_for_parsing" as const }])) };
  const client = {
    getPublicDiscoveryStatus: lifecycleFromState(() => state),
    getPublicLocalizationStatusBatch: vi.fn<(request: { queries: readonly { discoveryId: string; targetLocale: string }[] }) => Promise<{
      items: readonly { discoveryId: string; targetLocale: string; found: boolean; projection: ReturnType<typeof bulkProjection> | null }[];
    }>>(emptyProjections),
  };
  const activationStore = { client: vi.fn().mockResolvedValue({ client,
    bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
    authorityWorkspaceId: "workspace" }) } as unknown as ActivationStore;
  const save = vi.fn().mockResolvedValue(undefined);
  const input = { apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN" as const,
    excludedPluginIds: [], activationStore, translationPackStore,
    getState: () => state, replaceState: (next: PluginState) => { state = next; }, save };
  return { client, save, state: () => state, replace: input.replaceState,
    run: (mode: "automatic" | "manual") => mode === "automatic"
      ? synchronizeConfiguredPluginTranslations(input) : refreshConfiguredPluginStatuses(input) };
}
