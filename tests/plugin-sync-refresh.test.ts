import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivationStore } from "../src/activation";
import { synchronizeConfiguredPluginTranslations } from "../src/plugin-sync";
import { EMPTY_PLUGIN_STATE, type PluginState } from "../src/plugin-state";
import {
  submitObsidianLocalizationObservation,
  submitObsidianPluginDiscovery,
} from "../src/submission";

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  loadCatalog: vi.fn(),
  resolveIdentity: vi.fn(),
  resolvePublished: vi.fn(),
}));

vi.mock("../src/http-transport", () => ({
  ObsidianHttpTransport: class ObsidianHttpTransport {
    public constructor(public readonly baseUrl: string) {}
  },
}));

vi.mock("../src/plugin-registry", () => ({
  resolveCommunityPluginIdentity: mocks.resolveIdentity,
}));

vi.mock("../src/plugin-source-resolution", () => ({
  loadPublishedEcosystemCatalog: mocks.loadCatalog,
  resolvePublishedPluginSourceFromCatalog: mocks.resolvePublished,
}));

vi.mock("../src/submission", () => ({
  OBSIDIAN_PUBLIC_PROFILE: {
    adapterBuildDigestHex: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
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
    mocks.resolvePublished.mockReturnValue({ sourceVersionId: "current-source" });
    mocks.download.mockResolvedValue({
      rows: [{ stringKey: STRING_KEY, translatedText: "当前译文" }],
      etag: '"generation"',
      manifest: exportManifest,
    });
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
      pluginSubmissions: {
        dataview: {
          pluginId: "dataview",
          pluginVersion: "0.5.68",
          catalogDigest: "catalog-digest",
          adapterProfileDigest: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
          installationId: "installation",
          contributionId: "discovery-contribution",
          contributionState: "received",
          repository: "blacksmithgu/obsidian-dataview",
          submittedAt: "2026-07-18T00:00:00.000Z",
          localizationTargetLocale: "zh-CN",
          localizationContributionId: "localization-contribution",
          localizationContributionState: "received",
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
    expect(state.pluginSubmissions.dataview?.lastError).toBeUndefined();
    expect(state.pluginTranslations.dataview?.entries).toEqual([
      {
        pluginId: "dataview",
        source: "Current source",
        target: "当前译文",
        scopes: ["runtime-ui"],
      },
    ]);
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
          pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "current-source",
          targetLocale: "zh-CN", entries: [{ pluginId: "dataview", source: "Current source", target: "旧译文" }],
          pulledAt: "2026-07-18T00:00:00.000Z",
        },
      },
      translationExportStates: {
        "current-source:zh-CN:default": { etag: '"old"', manifest: exportManifest },
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

    expect(state.pluginTranslations.dataview?.entries).toEqual([]);
    expect(state.translationExportStates).toEqual({});
    expect(summary.waitingPluginIds).toEqual(["dataview"]);
  });

  it("reads the aggregate demand status and follows the server retry interval", async () => {
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
      state: "mt_running",
      retryAfterSeconds: 12,
      coordinates: [{
        state: "mt_running",
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
        failureCode: null,
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
    expect(state.pluginSubmissions.dataview?.localizationDemandStatus?.state).toBe(
      "mt_running",
    );
    expect(summary).toEqual(expect.objectContaining({
      waitingCount: 1,
      nextRetryAfterMs: 12_000,
      demandStateCounts: { mt_running: 1 },
    }));
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
    expect(mocks.resolvePublished).not.toHaveBeenCalled();
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

  it("re-submits automatically after the public observation profile changes", async () => {
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
          adapterProfileDigest: "old-profile",
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
    expect(mocks.resolvePublished).not.toHaveBeenCalled();
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledOnce();
    expect(submitObsidianLocalizationObservation).toHaveBeenCalledOnce();
    expect(state.pluginSubmissions.dataview).toEqual(expect.objectContaining({
      adapterProfileDigest: "117aade03541d1e4740eb0892fb9866be6ddc1973059453049a5a7e01fe8d518",
      contributionId: "new-discovery",
      localizationContributionId: "new-localization",
    }));
    expect(summary).toEqual(expect.objectContaining({
      submittedCount: 1,
      requestedCount: 1,
      waitingCount: 1,
    }));
  });
});
