import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivationStore } from "../src/activation";
import { synchronizeConfiguredPluginTranslations } from "../src/plugin-sync";
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
  });

  it("公共目录暂时不可用时继续提交来源，由服务端验证精确制品", async () => {
    mocks.loadCatalog.mockRejectedValue(new Error("读取 Obsidian 公共目录失败：HTTP 500"));
    vi.mocked(submitObsidianPluginDiscovery).mockResolvedValue({
      contributionId: "discovery", state: "received", recordedAt: "2026-08-01T00:00:00Z",
    } as never);
    vi.mocked(submitObsidianLocalizationObservation).mockResolvedValue({
      contributionId: "demand", state: "received",
    } as never);
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

    expect(submitObsidianPluginDiscovery).toHaveBeenCalledOnce();
    expect(submitObsidianLocalizationObservation).toHaveBeenCalledOnce();
    expect(summary).toEqual(expect.objectContaining({ submittedCount: 1, requestedCount: 1 }));
    expect(state.pluginSubmissions.dataview?.registryPolicyRevision).toBe(24);
  });

  it("resubmits discovery when only the registry policy revision changed", async () => {
    mocks.loadCatalog.mockRejectedValue(new Error("读取 Obsidian 公共目录失败：HTTP 500"));
    vi.mocked(submitObsidianPluginDiscovery).mockResolvedValue({
      contributionId: "policy-refresh", state: "received", recordedAt: "2026-08-01T00:00:00Z",
    } as never);
    vi.mocked(submitObsidianLocalizationObservation).mockResolvedValue({
      contributionId: "demand", state: "received",
    } as never);
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

    expect(submitObsidianPluginDiscovery).toHaveBeenCalledOnce();
    expect(state.pluginSubmissions.dataview).toEqual(expect.objectContaining({
      contributionId: "policy-refresh",
      registryPolicyRevision: 24,
      sourceDiscoveryEpoch: 19,
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
        dataview: {
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
        },
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
    expect(state.pluginSubmissions.dataview?.localizationContributionId).toBeUndefined();
    expect(state.pluginSubmissions.dataview?.localizationDemandStatus).toBeUndefined();
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

  it("官方当前快照缺项时从权威目录建立本地化需求且不创建新来源", async () => {
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
    mocks.resolveIdentity.mockRejectedValue(Object.assign(
      new Error("official entry missing"),
      { code: "community_plugin_not_found" },
    ));
    vi.mocked(submitObsidianLocalizationObservation).mockResolvedValue({
      contributionId: "localization", state: "received",
    } as never);
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
    const getLocalizationDemandStatus = vi.fn().mockResolvedValue({
      state: "mt_queued", retryAfterSeconds: 3,
      coordinates: [{
        state: "mt_queued", sourceVersionId: "current-source", targetLocale: "zh-CN",
        targetVariant: "default", totalUnitCount: 2, workItemCount: 1,
        nativeUnitCount: 0, queuedCount: 1, runningCount: 0, succeededCount: 0,
        failedCount: 0, reviewedUnitCount: 0, publishedUnitCount: 1,
        manifestId: null, generationNumber: null, retryAfterSeconds: 3,
        failureCode: null, failureRetryable: false, failureAttemptNumber: null,
        updatedAt: "2026-07-29T00:00:00.000Z",
      }],
    });
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: { getLocalizationDemandStatus },
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
    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
    expect(submitObsidianLocalizationObservation).toHaveBeenCalledWith(expect.objectContaining({
      repository: "owner/generic",
      targetLocale: "zh-CN",
    }));
    expect(state.pluginSubmissions.dataview).toEqual(expect.objectContaining({
      sourceAuthority: "published",
      localizationContributionId: "localization",
    }));
    expect(state.pluginSubmissions.dataview?.contributionId).toBeUndefined();
    expect(summary).toEqual(expect.objectContaining({
      pulledCount: 1,
      submittedCount: 0,
      requestedCount: 1,
      failedPluginIds: [],
    }));

    mocks.resolvePublished.mockReturnValue({
      sourceVersionId: "current-source",
      objectVersionId: "object-version",
      artifactDigest: "a".repeat(64),
      catalogIdentityExact: true,
      sourceUnitCount: 2,
      upstreamNativeCount: 0,
      publishedUnitCount: 1,
      missingUnitCount: 1,
    });
    const repeated = await synchronizeConfiguredPluginTranslations(input);
    expect(submitObsidianLocalizationObservation).toHaveBeenCalledOnce();
    expect(state.pluginSubmissions.dataview?.lastError?.message).toBeUndefined();
    expect(repeated.failedPluginIds).toEqual([]);
    expect(getLocalizationDemandStatus).toHaveBeenCalledWith("localization");
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

  it("requests a new localization observation when the current scan expands a complete older catalog", async () => {
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
    vi.mocked(submitObsidianLocalizationObservation).mockResolvedValue({
      contributionId: "expanded-localization", state: "received",
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
    expect(submitObsidianLocalizationObservation).toHaveBeenCalledOnce();
    expect(summary).toEqual(expect.objectContaining({ requestedCount: 1, waitingCount: 1 }));
  });

  it("requests missing localization when an authoritative source has incomplete coverage", async () => {
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
    vi.mocked(submitObsidianLocalizationObservation).mockResolvedValue({
      contributionId: "localization-contribution",
      state: "received",
    } as never);
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

    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
    expect(mocks.resolveIdentity).not.toHaveBeenCalled();
    expect(submitObsidianLocalizationObservation).toHaveBeenCalledOnce();
    expect(state.pluginSubmissions.dataview).toEqual(expect.objectContaining({
      sourceAuthority: "published",
      contributionState: "source_attested",
      sourceVersionId: "published-source",
      localizationTargetLocale: "zh-CN",
      localizationContributionId: "localization-contribution",
    }));
    expect(summary).toEqual(expect.objectContaining({
      submittedCount: 0,
      requestedCount: 1,
      waitingCount: 1,
      waitingPluginIds: ["dataview"],
    }));
  });

  it("refreshes a stale registry policy while keeping an authoritative source", async () => {
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
      contributionId: "current-localization", state: "received",
    } as never);
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
          adapterProfileDigest: "old-profile", registryPolicyRevision: 23,
          sourceDiscoveryEpoch: 18,
          installationId: "installation", contributionId: "old-discovery",
          contributionState: "source_attested", repository: "owner/generic",
          localizationTargetLocale: "zh-CN", localizationContributionId: "old-localization",
          localizationContributionState: "received", sourceVersionId: "published-source",
          submittedAt: "2026-07-28T00:00:00.000Z",
        },
      },
    };
    mocks.resolveIdentity.mockResolvedValue({ repository: "owner/generic", candidateLocators: [] });
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
    expect(submitObsidianLocalizationObservation).toHaveBeenCalledOnce();
    expect(state.pluginSubmissions.generic).toEqual(expect.objectContaining({
      contributionState: "source_attested",
      sourceVersionId: "published-source",
      localizationContributionId: "current-localization",
    }));
    expect(summary).toEqual(expect.objectContaining({ submittedCount: 1, requestedCount: 1 }));
  });

  it("retries a failed localization demand without rediscovering an authoritative source", async () => {
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
    const protocolFailure = Object.assign(
      new Error("The server response violated the public protocol contract"),
      {
        code: "PC_PROTOCOL_REJECTED",
        diagnostic: {
          operation: "localization-demand-status",
          protocolCode: "CP_INVALID_VALUE",
          detail: "$.coordinates[0].targetLocale",
        },
      },
    );
    vi.mocked(submitObsidianLocalizationObservation)
      .mockRejectedValueOnce(protocolFailure)
      .mockResolvedValueOnce({ contributionId: "localization", state: "received" } as never);
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
    expect(state.pluginSubmissions.generic).toEqual(expect.objectContaining({
      contributionState: "source_attested",
      sourceVersionId: "published-source",
    }));
    expect(state.pluginSubmissions.generic?.lastError?.message).toBe(
      "The server response violated the public protocol contract [operation=localization-demand-status; protocol=CP_INVALID_VALUE; path=$.coordinates[0].targetLocale]",
    );

    const recovered = await synchronizeConfiguredPluginTranslations(input);
    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
    expect(submitObsidianLocalizationObservation).toHaveBeenCalledTimes(2);
    expect(state.pluginSubmissions.generic).toEqual(expect.objectContaining({
      localizationContributionId: "localization",
      sourceVersionId: "published-source",
    }));
    expect(state.pluginSubmissions.generic?.lastError).toBeUndefined();
    expect(recovered).toEqual(expect.objectContaining({ requestedCount: 1, failedPluginIds: [] }));
  });

  it("refreshes localization for a new exact version and reuses unchanged translations", async () => {
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
    vi.mocked(submitObsidianLocalizationObservation).mockResolvedValue({
      contributionId: "new-localization", state: "received",
    } as never);
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
      pluginSubmissions: {
        generic: {
          pluginId: "generic", pluginVersion: "1.0.0", catalogDigest: "old-catalog",
          adapterProfileDigest: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
          registryPolicyRevision: 24,
          sourceDiscoveryEpoch: 19, installationId: "installation",
          contributionId: "old-discovery", contributionState: "source_attested",
          repository: "owner/generic", localizationTargetLocale: "zh-CN",
          localizationContributionId: "old-localization", localizationContributionState: "received",
          sourceVersionId: "old-source", submittedAt: "2026-07-28T00:00:00.000Z",
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

    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
    expect(submitObsidianLocalizationObservation).toHaveBeenCalledOnce();
    expect(getPluginTranslation(state, "generic", "zh-CN")?.entries).toEqual([
      expect.objectContaining({ source: "Current source", target: "当前译文" }),
      expect.objectContaining({ source: "Unchanged source", target: "沿用译文" }),
    ]);
    expect(state.pluginSubmissions.generic).toEqual(expect.objectContaining({
      pluginVersion: "2.0.0",
      sourceVersionId: "new-source",
      localizationContributionId: "new-localization",
    }));
    expect(summary).toEqual(expect.objectContaining({ submittedCount: 0, requestedCount: 1 }));
  });

  it("discards a stale demand receipt whose coordinate predates the current authority source", async () => {
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
    vi.mocked(submitObsidianLocalizationObservation).mockResolvedValue({
      contributionId: "refreshed-localization", state: "received",
    } as never);
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
      pluginSubmissions: {
        generic: {
          pluginId: "generic", pluginVersion: "2.0.0", catalogDigest: "catalog-digest",
          adapterProfileDigest: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
          registryPolicyRevision: 24,
          sourceDiscoveryEpoch: 19, installationId: "installation",
          contributionId: "old-discovery", contributionState: "source_attested",
          repository: "owner/generic", localizationTargetLocale: "zh-CN",
          localizationContributionId: "stale-localization", localizationContributionState: "distribution_blocked",
          localizationDemandStatus: {
            state: "distribution_blocked", sourceVersionId: "old-source", targetLocale: "zh-CN",
            targetVariant: "default", totalUnitCount: 2, workItemCount: 1,
            nativeUnitCount: 0, queuedCount: 0, runningCount: 0, succeededCount: 1,
            failedCount: 0, reviewedUnitCount: 0, publishedUnitCount: 0,
            retryAfterSeconds: 0, failureCode: "PublicDistributionPolicyAmbiguous",
            failureRetryable: false, updatedAt: "2026-07-28T00:00:00.000Z",
          },
          sourceVersionId: "new-source", submittedAt: "2026-07-28T00:00:00.000Z",
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

    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
    expect(getLocalizationDemandStatus).not.toHaveBeenCalled();
    expect(submitObsidianLocalizationObservation).toHaveBeenCalledWith(expect.objectContaining({
      targetLocale: "zh-CN",
    }));
    expect(state.pluginSubmissions.generic).toEqual(expect.objectContaining({
      sourceVersionId: "new-source",
      localizationContributionId: "refreshed-localization",
    }));
    expect(summary).toEqual(expect.objectContaining({ submittedCount: 0, requestedCount: 1 }));
  });

  it("polls an existing exact-version demand without submitting it again", async () => {
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

    await synchronizeConfiguredPluginTranslations(input);
    state = parsePluginState(JSON.parse(JSON.stringify(state)) as unknown);
    const repeated = await synchronizeConfiguredPluginTranslations(input);

    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
    expect(submitObsidianLocalizationObservation).toHaveBeenCalledOnce();
    expect(getContributionStatus).not.toHaveBeenCalled();
    expect(getLocalizationDemandStatus).toHaveBeenCalledOnce();
    expect(getLocalizationDemandStatus).toHaveBeenCalledWith("localization");
    expect(repeated).toEqual(expect.objectContaining({
      requestedCount: 0,
      waitingCount: 1,
      nextRetryAfterMs: 3_000,
      demandStateCounts: { mt_queued: 1 },
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
    vi.mocked(submitObsidianPluginDiscovery).mockResolvedValue({
      contributionId: "recovered-source", state: "received",
      recordedAt: "2026-07-29T00:00:00.000Z",
    } as never);
    vi.mocked(submitObsidianLocalizationObservation).mockResolvedValue({
      contributionId: "localization", state: "received",
    } as never);
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
    expect(submitObsidianLocalizationObservation).toHaveBeenCalledOnce();
    expect(state.pluginSubmissions.generic?.contributionId).toBe("recovered-source");
    expect(summary).toEqual(expect.objectContaining({
      submittedCount: 1,
      requestedCount: 1,
      failedPluginIds: [],
    }));
  });

  it("keeps a remote authority coordinate for a partial local variant without rediscovery", async () => {
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
        dataview: {
          pluginId: "dataview", pluginVersion: "0.5.68", catalogDigest: "current-catalog",
          adapterProfileDigest: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
          registryPolicyRevision: 24,
          sourceDiscoveryEpoch: 19, installationId: "installation",
          contributionId: "discovery-contribution", contributionState: "source_attested",
          localizationTargetLocale: "zh-CN",
          localizationContributionId: "localization-contribution",
          localizationContributionState: "received",
          submittedAt: "2026-07-29T00:00:00.000Z",
        },
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

    expect(mocks.download).toHaveBeenCalledOnce();
    expect(getLocalizationDemandStatus).not.toHaveBeenCalled();
    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
    expect(submitObsidianLocalizationObservation).toHaveBeenCalledOnce();
    expect(state.pluginSubmissions.dataview).toEqual(expect.objectContaining({
      sourceAuthority: "published",
      sourceVersionId: "published-source",
      localizationContributionId: "replacement-localization",
    }));
    expect(summary).toEqual(expect.objectContaining({
      waitingCount: 1,
      waitingPluginIds: ["dataview"],
      failedPluginIds: [],
      demandStateCounts: {},
      requestedCount: 1,
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
        dataview: {
          pluginId: "dataview", pluginVersion: "0.5.68", catalogDigest: "catalog-digest",
          sourceAuthority: "published", contributionState: "source_attested",
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
        },
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
        dataview: {
          pluginId: "dataview", pluginVersion: "0.5.68", catalogDigest: "local-catalog",
          adapterProfileDigest: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
          registryPolicyRevision: 23, sourceDiscoveryEpoch: 19, installationId: "installation",
          sourceAuthority: "published", contributionState: "source_attested",
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
        },
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
    const repeated = await synchronizeConfiguredPluginTranslations(retryInput);
    expect(repeated.failedPluginIds).toEqual(["dataview"]);
    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
  });

  it("treats a local artifact variant as terminal and never resubmits it as official source", async () => {
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

    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
    expect(submitObsidianLocalizationObservation).not.toHaveBeenCalled();
    const submission = state.pluginSubmissions.dataview;
    expect(submission?.pluginVersion).toBe("0.5.68");
    expect(submission?.catalogDigest).toBe("local-catalog");
    expect(submission?.contributionState).toBe("source_attested");
    expect(submission?.lastError).toMatchObject({
      code: "source_artifact_mismatch",
      message: "本地安装与权威目录的精确制品不一致，已暂停同步。",
    });
    expect(summary).toEqual(expect.objectContaining({
      submittedCount: 0,
      requestedCount: 0,
      waitingCount: 0,
      waitingPluginIds: [],
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
  ])("reads aggregate demand status for $name and follows the server retry interval", async ({
    state: demandState,
    failureCode,
    expected,
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
        dataview: {
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
        },
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

    expect(getContributionStatus).toHaveBeenCalledWith("discovery-contribution");
    expect(getLocalizationDemandStatus).toHaveBeenCalledWith("localization-contribution");
    expect(state.pluginSubmissions.dataview?.sourceVersionId).toBe("source-version");
    expect(state.pluginSubmissions.dataview?.localizationDemandStatus?.state).toBe(demandState);
    expect(summary).toEqual(expect.objectContaining({
      waitingCount: demandState === "rejected" ? 0 : 1,
      failedPluginIds: demandState === "rejected" ? ["dataview"] : [],
      ...(demandState === "rejected" ? {} : { nextRetryAfterMs: 12_000 }),
      ...expected,
    }));
  });

  it.each([
    ["普通终态失败仍需要人工重试", "mt_failed", ["dataview"]],
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
        dataview: {
          pluginId: "dataview", pluginVersion: "0.5.68", catalogDigest: "catalog-digest",
          adapterProfileDigest: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
          registryPolicyRevision: 24,
          sourceDiscoveryEpoch: 19,
          installationId: "installation", contributionId: "discovery", contributionState: "received",
          localizationTargetLocale: "zh-CN", localizationContributionId: "localization",
          localizationContributionState: "received", sourceVersionId: "current-source",
          submittedAt: "2026-07-18T00:00:00.000Z",
        },
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

    expect(getPluginTranslation(state, "dataview", "zh-CN")).toBeUndefined();
    expect(getPluginTranslation(state, "dataview", "ko")?.entries[0]?.target).toBe("현재 번역");
    expect(Object.keys(state.translationExportStates)).toEqual(["current-source:ko:default"]);
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
        dataview: {
          pluginId: "dataview", pluginVersion: "0.5.68", catalogDigest: "catalog-digest",
          adapterProfileDigest: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
          registryPolicyRevision: 24,
          sourceDiscoveryEpoch: 19,
          installationId: "installation", contributionId: "discovery", contributionState: "received",
          localizationTargetLocale: "zh-CN", localizationContributionId: "localization",
          localizationContributionState: "received", sourceVersionId: "current-source",
          submittedAt: "2026-07-18T00:00:00.000Z",
        },
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
    expect(summary.failedPluginIds).toEqual(["dataview"]);
    expect(summary.translationCount).toBe(1);
  });

  it("does not retry or clear cached delivery for a distribution-blocked demand", async () => {
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
        dataview: {
          pluginId: "dataview", pluginVersion: "0.5.68", catalogDigest: "catalog-digest",
          adapterProfileDigest: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
          registryPolicyRevision: 24,
          sourceDiscoveryEpoch: 19, installationId: "installation",
          contributionId: "discovery-contribution", contributionState: "source_attested",
          localizationTargetLocale: "zh-CN",
          localizationContributionId: "localization-contribution",
          localizationContributionState: "received",
          submittedAt: "2026-07-29T00:00:00.000Z",
        },
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

    expect(getLocalizationDemandStatus).toHaveBeenCalledOnce();
    expect(getPluginTranslation(state, "dataview", "zh-CN")?.entries).toHaveLength(1);
    expect(summary).toEqual(expect.objectContaining({
      waitingCount: 0,
      failedPluginIds: [],
      demandStateCounts: { distribution_blocked: 1 },
    }));
  });

  it("does not summarize a distribution-blocked source rejection as a retry", async () => {
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
        dataview: {
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
        },
      },
    };
    const activationStore = {
      client: vi.fn().mockResolvedValue({
        client: { getContributionStatus: vi.fn().mockResolvedValue({ state: "rejected" }) },
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

    expect(summary.failedPluginIds).toEqual([]);
    expect(state.pluginSubmissions.dataview?.contributionState).toBe("rejected");

    mocks.resolveIdentity.mockRejectedValue(Object.assign(
      new Error("来源目录暂时不可用"),
      { code: "PC_RETRY_EXHAUSTED" },
    ));
    const recoverable = await synchronizeConfiguredPluginTranslations(input);
    expect(recoverable.failedPluginIds).toEqual(["dataview"]);
    expect(state.pluginSubmissions.dataview?.localizationDemandStatus?.state)
      .toBe("distribution_blocked");
    expect(state.pluginSubmissions.dataview?.lastError).toEqual(expect.objectContaining({
      message: "来源目录暂时不可用",
      targetLocale: "zh-CN",
    }));
  });

  it("manual refresh submits one new observation for an exact exhausted authority", async () => {
    mocks.resolvePublished.mockReturnValue(undefined);
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
    vi.mocked(submitObsidianLocalizationObservation).mockResolvedValue({
      contributionId: "authority-recovery-observation",
      state: "received",
    } as never);
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

    expect(submitObsidianPluginDiscovery).not.toHaveBeenCalled();
    expect(submitObsidianLocalizationObservation).toHaveBeenCalledWith(expect.objectContaining({
      targetLocale: "zh-CN",
      observationGeneration: 1,
    }));
    expect(state.pluginSubmissions.dataview).toEqual(expect.objectContaining({
      localizationContributionId: "authority-recovery-observation",
      localizationContributionState: "received",
    }));
    expect(summary).toEqual(expect.objectContaining({ requestedCount: 1, waitingCount: 1 }));
  });

  it("isolates an exhausted plugin retry budget and continues processing the remaining plugins", async () => {
    mocks.resolvePublished.mockReturnValue(undefined);
    mocks.resolveIdentity.mockImplementation((pluginId: string) => {
      if (pluginId === "broken") {
        const error = new Error("The bounded retry budget was exhausted");
        Object.assign(error, {
          code: "PC_RETRY_EXHAUSTED",
          diagnostic: { operation: "registry-lookup", status: 503 },
        });
        throw error;
      }
      return Promise.resolve({ repository: "owner/working", candidateLocators: [] });
    });
    vi.mocked(submitObsidianPluginDiscovery).mockResolvedValue({
      contributionId: "working-discovery",
      state: "received",
      recordedAt: "2026-07-20T00:00:00.000Z",
    } as never);
    vi.mocked(submitObsidianLocalizationObservation).mockResolvedValue({
      contributionId: "working-localization",
      state: "received",
    } as never);
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
    expect(summary.requestedCount).toBe(1);
    expect(summary.waitingPluginIds).toEqual(["working"]);
    expect(state.pluginSubmissions.working?.localizationContributionId).toBe(
      "working-localization",
    );
  });

  it("re-submits legacy contribution references after the installation identity changes", async () => {
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
        dataview: {
          pluginId: "dataview",
          pluginVersion: "0.5.68",
          catalogDigest: "catalog-digest",
          installationId: "old-installation",
          contributionId: "old-discovery",
          contributionState: "received",
          localizationTargetLocale: "zh-CN",
          localizationContributionId: "old-localization",
          localizationContributionState: "received",
          submittedAt: "2026-07-18T00:00:00.000Z",
        },
      },
    };
    vi.mocked(submitObsidianPluginDiscovery).mockResolvedValue({
      contributionId: "new-discovery",
      state: "received",
      recordedAt: "2026-07-19T00:00:00.000Z",
    } as never);
    vi.mocked(submitObsidianLocalizationObservation).mockResolvedValue({
      contributionId: "new-localization",
      state: "received",
    } as never);
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
    expect(submitObsidianLocalizationObservation).toHaveBeenCalledOnce();
    expect(state.pluginSubmissions.dataview).toEqual(expect.objectContaining({
      installationId: "new-installation",
      contributionId: "new-discovery",
      localizationContributionId: "new-localization",
    }));
    expect(summary).toEqual(expect.objectContaining({
      submittedCount: 1,
      requestedCount: 1,
      waitingCount: 1,
    }));
  });

  it("re-submits automatically when the stored source discovery epoch is stale", async () => {
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
        dataview: {
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
        },
      },
    };
    vi.mocked(submitObsidianPluginDiscovery).mockResolvedValue({
      contributionId: "new-discovery",
      state: "received",
      recordedAt: "2026-07-19T00:00:00.000Z",
    } as never);
    vi.mocked(submitObsidianLocalizationObservation).mockResolvedValue({
      contributionId: "new-localization",
      state: "received",
    } as never);
    const getContributionStatus = vi.fn();
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

    expect(getContributionStatus).not.toHaveBeenCalled();
    expect(mocks.resolvePublished).toHaveBeenCalledOnce();
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledOnce();
    expect(submitObsidianLocalizationObservation).toHaveBeenCalledOnce();
    expect(state.pluginSubmissions.dataview).toEqual(expect.objectContaining({
      adapterProfileDigest: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
      registryPolicyRevision: 24,
      sourceDiscoveryEpoch: 19,
      contributionId: "new-discovery",
      localizationContributionId: "new-localization",
    }));
    expect(summary).toEqual(expect.objectContaining({
      submittedCount: 1,
      requestedCount: 1,
      waitingCount: 1,
    }));
  });

  it("re-submits a rejected source observation once with a new generation", async () => {
    mocks.resolvePublished.mockReturnValue(undefined);
    let state = retryablePluginState();
    vi.mocked(submitObsidianPluginDiscovery).mockResolvedValue({
      contributionId: "retry-discovery", state: "received",
      recordedAt: "2026-07-23T00:00:00.000Z",
    } as never);
    vi.mocked(submitObsidianLocalizationObservation).mockResolvedValue({
      contributionId: "retry-localization", state: "received",
    } as never);
    const activationStore = activationWithContributionState("rejected");

    const summary = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], activationStore, translationPackStore,
      getState: () => state, replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(submitObsidianPluginDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      observationGeneration: 1,
    }));
    expect(submitObsidianLocalizationObservation).toHaveBeenCalledWith(expect.objectContaining({
      observationGeneration: 1,
    }));
    expect(state.pluginSubmissions.dataview).toEqual(expect.objectContaining({
      contributionId: "retry-discovery",
      localizationContributionId: "retry-localization",
      observationGeneration: 1,
    }));
    expect(summary).toEqual(expect.objectContaining({ submittedCount: 1, requestedCount: 1 }));
  });

  it("manual resubmit creates a later generation after automatic recovery is exhausted", async () => {
    mocks.resolvePublished.mockReturnValue(undefined);
    let state = retryablePluginState({ observationGeneration: 1 });
    vi.mocked(submitObsidianPluginDiscovery).mockResolvedValue({
      contributionId: "manual-discovery", state: "received",
      recordedAt: "2026-07-24T00:00:00.000Z",
    } as never);
    vi.mocked(submitObsidianLocalizationObservation).mockResolvedValue({
      contributionId: "manual-localization", state: "received",
    } as never);
    const activationStore = activationWithContributionState("rejected");

    await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: "https://api.trans-hub.net", targetLocale: "zh-CN",
      excludedPluginIds: [], manualResubmitPluginIds: ["dataview"],
      activationStore, translationPackStore, getState: () => state,
      replaceState: (next) => { state = next; }, save: vi.fn().mockResolvedValue(undefined),
    });

    expect(submitObsidianPluginDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      observationGeneration: 2,
    }));
    expect(submitObsidianLocalizationObservation).toHaveBeenCalledWith(expect.objectContaining({
      observationGeneration: 2,
    }));
    expect(state.pluginSubmissions.dataview?.observationGeneration).toBe(2);
  });
});

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
      dataview: {
        pluginId: "dataview", pluginVersion: "0.5.68", catalogDigest: "catalog-digest",
        adapterProfileDigest: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
        registryPolicyRevision: 24,
        sourceDiscoveryEpoch: 19,
        installationId: "installation", contributionId: "rejected-discovery",
        contributionState: "received", repository: "blacksmithgu/obsidian-dataview",
        submittedAt: "2026-07-18T00:00:00.000Z",
        ...extra,
      },
    },
  };
}

function activationWithContributionState(state: string): ActivationStore {
  return {
    client: vi.fn().mockResolvedValue({
      client: { getContributionStatus: vi.fn().mockResolvedValue({ state }) },
      bootstrap: { installationId: "installation", intakeCredential: { value: "token" } },
      authorityWorkspaceId: "workspace",
    }),
  } as unknown as ActivationStore;
}
