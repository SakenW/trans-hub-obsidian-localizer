import { describe, expect, it } from "vitest";

import type {
  LocalizationDemandCoordinateStatus,
  LocalizationDemandStatusBatchItem,
} from "@trans-hub/client-protocol";

import { ActivationStore } from "../src/activation";
import { refreshConfiguredPluginStatuses } from "../src/plugin-sync";
import { type PluginState } from "../src/plugin-state";
import { refreshPluginStatusFromBatch } from "../src/plugin-status-refresh";

function coordinate(
  state: LocalizationDemandCoordinateStatus["state"],
  failureRetryable = false,
): LocalizationDemandCoordinateStatus {
  return {
    state,
    sourceVersionId: "source-version",
    targetLocale: "zh-CN",
    targetVariant: "default",
    totalUnitCount: 10,
    workItemCount: 2,
    nativeUnitCount: 0,
    queuedCount: 0,
    runningCount: 0,
    succeededCount: 2,
    failedCount: 0,
    reviewedUnitCount: 0,
    publishedUnitCount: 2,
    manifestId: null,
    generationNumber: null,
    retryAfterSeconds: 10,
    failureCode: null,
    failureRetryable,
    failureAttemptNumber: failureRetryable ? 2 : null,
    updatedAt: "2026-07-23T00:00:00.000Z",
  };
}

function item(
  contributionId: string,
  found: boolean,
  coordinates: readonly LocalizationDemandCoordinateStatus[],
): LocalizationDemandStatusBatchItem {
  return { contributionId, found, coordinates };
}

describe("refreshPluginStatusFromBatch", () => {
  it("collapses waiting / export-pending / failed plugins", () => {
    const result = refreshPluginStatusFromBatch({
      batch: [
        item("c1", true, [coordinate("mt_running")]),
        item("c2", true, [coordinate("export_pending")]),
        item("c3", true, [coordinate("mt_failed", true)]),
      ],
      contributionIdToPluginId: new Map(
        Object.entries({ c1: "plugin-a", c2: "plugin-b", c3: "plugin-c" }),
      ),
      targetLocale: "zh-CN",
    });

    expect(result.waitingCount).toBe(1);
    expect(result.waitingPluginIds).toEqual(["plugin-a"]);
    expect(result.exportPendingCount).toBe(1);
    expect(result.exportPendingPluginIds).toEqual(["plugin-b"]);
    expect(result.failedPluginIds).toEqual(["plugin-c"]);
    expect(result.submittedCount).toBe(0);
    expect(result.requestedCount).toBe(0);
    expect(result.pulledCount).toBe(0);
  });

  it("treats missing / out-of-scope coordinates as absent, not in flight", () => {
    const result = refreshPluginStatusFromBatch({
      batch: [
        item("c-missing", false, []),
        item("c-unknown", false, [coordinate("mt_running")]),
      ],
      contributionIdToPluginId: new Map(
        Object.entries({ "c-missing": "plugin-missing", "c-unknown": "plugin-unknown" }),
      ),
      targetLocale: "zh-CN",
    });

    expect(result.waitingCount).toBe(0);
    expect(result.exportPendingCount).toBeUndefined();
    expect(result.failedPluginIds).toBeUndefined();
  });

  it("uses only one coordinate matching the current target locale", () => {
    const jaCoordinate = { ...coordinate("mt_running"), targetLocale: "ja-JP" };
    const duplicateZh = {
      ...coordinate("export_pending"),
      sourceVersionId: "source-version-2",
    };
    const result = refreshPluginStatusFromBatch({
      batch: [
        item("c-wrong-locale", true, [jaCoordinate]),
        item("c-ambiguous", true, [coordinate("mt_running"), duplicateZh]),
        item("c-current", true, [jaCoordinate, coordinate("export_pending")]),
      ],
      contributionIdToPluginId: new Map(Object.entries({
        "c-wrong-locale": "plugin-wrong-locale",
        "c-ambiguous": "plugin-ambiguous",
        "c-current": "plugin-current",
      })),
      targetLocale: "zh-CN",
    });

    expect(result.waitingCount).toBe(0);
    expect(result.waitingPluginIds).toBeUndefined();
    expect(result.exportPendingPluginIds).toEqual(["plugin-current"]);
  });
});

describe("refreshConfiguredPluginStatuses", () => {
  it("refreshes 28 configured plugins 20 times through only one batch read per refresh", async () => {
    const contributionIds = Array.from({ length: 28 }, (_, index) => `contribution-${index}`);
    const batchCalls: string[][] = [];
    const activationStore = {
      client: () => Promise.resolve({
        client: {
          getLocalizationDemandStatusBatch: (input: { readonly contributionIds: readonly string[] }) => {
            batchCalls.push([...input.contributionIds]);
            return Promise.resolve({
              items: input.contributionIds.map((contributionId) => item(
                contributionId,
                true,
                [{ ...coordinate("export_ready"), sourceVersionId: `source-${contributionId}` }],
              )),
            });
          },
        },
      }),
    } as unknown as ActivationStore;
    const state = {
      pluginCatalogs: Object.fromEntries(contributionIds.map((_, index) => [
        `plugin-${index}`,
        { pluginId: `plugin-${index}` },
      ])),
      pluginSubmissions: Object.fromEntries(contributionIds.map((contributionId, index) => [
        `plugin-${index}`,
        { localizationContributionId: contributionId },
      ])),
    } as unknown as PluginState;

    for (let refresh = 0; refresh < 20; refresh += 1) {
      const result = await refreshConfiguredPluginStatuses({
        apiBaseUrl: "http://127.0.0.1:8000",
        targetLocale: "zh-CN",
        excludedPluginIds: [],
        activationStore,
        getState: () => state,
      });
      expect(result).toMatchObject({
        submittedCount: 0,
        requestedCount: 0,
        pulledCount: 0,
        translationCount: 0,
        waitingCount: 0,
      });
    }

    expect(batchCalls).toHaveLength(20);
    for (const contributionIdsInCall of batchCalls) {
      expect(contributionIdsInCall).toEqual(contributionIds);
    }
  });
});
