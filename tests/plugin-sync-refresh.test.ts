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
  resolvePublishedPluginSource: mocks.resolvePublished,
}));

vi.mock("../src/submission", () => ({
  OBSIDIAN_PUBLIC_PROFILE: {
    adapterBuildDigestHex: "2111e10336edf23c59661e66b6155a1ef127642161ea4ccd766fb1cc16b15580",
  },
  submitObsidianLocalizationObservation: vi.fn(),
  submitObsidianPluginDiscovery: vi.fn(),
}));

vi.mock("../src/translation-sync", () => ({
  downloadPluginTranslations: mocks.download,
}));

const STRING_KEY = "a".repeat(32);

describe("synchronizeConfiguredPluginTranslations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveIdentity.mockResolvedValue({
      repository: "blacksmithgu/obsidian-dataview",
      candidateLocators: [],
    });
    mocks.resolvePublished.mockResolvedValue({ sourceVersionId: "current-source" });
    mocks.download.mockResolvedValue({
      rows: [{ stringKey: STRING_KEY, translatedText: "当前译文" }],
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
          adapterProfileDigest: "2111e10336edf23c59661e66b6155a1ef127642161ea4ccd766fb1cc16b15580",
          installationId: "installation",
          contributionId: "discovery-contribution",
          contributionState: "received",
          repository: "blacksmithgu/obsidian-dataview",
          submittedAt: "2026-07-18T00:00:00.000Z",
          localizationTargetLocale: "zh-CN",
          localizationContributionId: "localization-contribution",
          localizationContributionState: "received",
          sourceVersionId: "stale-source",
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
    expect(state.pluginTranslations.dataview?.entries).toEqual([
      { pluginId: "dataview", source: "Current source", target: "当前译文" },
    ]);
    expect(summary).toEqual({
      submittedCount: 0,
      requestedCount: 0,
      pulledCount: 1,
      waitingCount: 0,
      translationCount: 1,
      waitingPluginIds: [],
    });
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
      getState: () => state,
      replaceState: (next) => { state = next; },
      save: vi.fn().mockResolvedValue(undefined),
    });

    expect(getContributionStatus).not.toHaveBeenCalled();
    expect(mocks.resolvePublished).not.toHaveBeenCalled();
    expect(submitObsidianPluginDiscovery).toHaveBeenCalledOnce();
    expect(submitObsidianLocalizationObservation).toHaveBeenCalledOnce();
    expect(state.pluginSubmissions.dataview).toEqual(expect.objectContaining({
      adapterProfileDigest: "2111e10336edf23c59661e66b6155a1ef127642161ea4ccd766fb1cc16b15580",
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
