/**
 * R-028 / Obsidian 0.2.7: merge a zero-write batch status read into the same
 * PluginSyncSummary shape the status line already knows how to describe.
 *
 * This module is deliberately read-only: it never submits an observation, a
 * demand, a retry, or a resync.  It only maps each plugin's contribution id to
 * its batch status item and collapses them into a PluginSyncSummary that
 * describePluginStatusRefresh can render.  A missing/out-of-scope coordinate
 * is surfaced as an unknown plugin (not "processing") so the UI never misreads
 * an absent item as work in flight.
 */

import type { LocalizationDemandStatusBatchItem } from "@trans-hub/client-protocol";

import type { PluginSyncSummary } from "./plugin-sync";

export function refreshPluginStatusFromBatch(input: {
  readonly batch: readonly LocalizationDemandStatusBatchItem[];
  readonly contributionIdToPluginId: ReadonlyMap<string, string>;
  readonly targetLocale: string;
}): PluginSyncSummary {
  const waitingPluginIds: string[] = [];
  const exportPendingPluginIds: string[] = [];
  const failedPluginIds: string[] = [];

  for (const item of input.batch) {
    const pluginId = input.contributionIdToPluginId.get(item.contributionId);
    if (pluginId === undefined) {
      continue;
    }
    if (!item.found) {
      continue;
    }
    const matchingCoordinates = item.coordinates.filter(
      (coordinate) => coordinate.targetLocale === input.targetLocale,
    );
    if (matchingCoordinates.length !== 1) {
      continue;
    }
    const coordinate = matchingCoordinates[0];
    // mt_failed with remaining retry budget is a retryable failure (same as the
    // sync path's failedPluginIds); export_pending is in distribution; other
    // non-terminal states count as waiting.
    if (coordinate.state === "mt_failed" && coordinate.failureRetryable) {
      failedPluginIds.push(pluginId);
    } else if (coordinate.state === "export_pending") {
      exportPendingPluginIds.push(pluginId);
    } else if (
      coordinate.state !== "export_ready"
      && coordinate.state !== "native_complete"
      && coordinate.state !== "rejected"
      && coordinate.state !== "distribution_blocked"
      && coordinate.state !== "mt_failed"
    ) {
      waitingPluginIds.push(pluginId);
    }
  }

  return {
    submittedCount: 0,
    requestedCount: 0,
    pulledCount: 0,
    translationCount: 0,
    waitingCount: waitingPluginIds.length,
    ...(exportPendingPluginIds.length === 0 ? {} : { exportPendingCount: exportPendingPluginIds.length }),
    ...(waitingPluginIds.length === 0 ? {} : { waitingPluginIds }),
    ...(exportPendingPluginIds.length === 0 ? {} : { exportPendingPluginIds }),
    ...(failedPluginIds.length === 0 ? {} : { failedPluginIds }),
  };
}
