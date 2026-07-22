import type { ContributionSigningPayload, ContributionStateReceipt } from "@trans-hub/client-protocol";
import type { PublicClient } from "@trans-hub/public-client";
import { describe, expect, it } from "vitest";

import {
  normalizeMissingUiSourceText,
  normalizeReportedTargetText,
  submitObsidianLocalizationIssue,
  submitObsidianLocalizationObservation,
  submitObsidianMissingTranslationIssue,
  submitObsidianPluginDiscovery,
} from "../src/submission";

describe("submitObsidianPluginDiscovery", () => {
  it("submits a source discovery intent without authority mutation", async () => {
    let payload: ContributionSigningPayload | null = null;
    const client = {
      submitContribution(value: ContributionSigningPayload) {
        payload = value;
        return Promise.resolve({
          contributionId: "019f0000-0000-7000-8000-000000000001",
          state: "received",
        } as ContributionStateReceipt);
      },
    } as PublicClient;
    await submitObsidianPluginDiscovery({
      client,
      installationId: "019f0000-0000-7000-8000-000000000002",
      repository: "blacksmithgu/obsidian-dataview",
      candidateLocators: ["https://github.com/blacksmithgu/obsidian-dataview"],
      catalog: {
        pluginId: "dataview",
        pluginName: "Dataview",
        pluginVersion: "0.5.68",
        sourceLocale: "en",
        digest: "a".repeat(64),
        artifactDigest: "b".repeat(64),
        scannedAt: "2026-07-17T00:00:00.000Z",
        strings: [],
      },
    });
    const captured = payload as ContributionSigningPayload | null;
    expect(captured?.idempotencyKey).toMatch(/^obsidian-public-v12-[a-f0-9]{64}$/u);
    expect(captured).toMatchObject({
      submittedAt: "2026-07-17T00:00:00.000Z",
      contributionType: "source_discovery",
      targetHint: {
        externalRegistry: "obsidian_community_plugins",
        externalObjectId: "blacksmithgu/obsidian-dataview",
        upstreamVersion: "0.5.68",
      },
      provenance: { clientType: "public_plugin" },
      discovery: {
        localArtifactDigest: { algorithm: "sha256", domain: "transport", hex: "b".repeat(64) },
      },
    });
  });
});

describe("submitObsidianMissingTranslationIssue", () => {
  it("submits an explicit generic localization-quality issue", async () => {
    let payload: ContributionSigningPayload | null = null;
    const client = {
      submitContribution(value: ContributionSigningPayload) {
        payload = value;
        return Promise.resolve({
          contributionId: "019f0000-0000-7000-8000-000000000004",
          state: "received",
        } as ContributionStateReceipt);
      },
    } as PublicClient;

    await submitObsidianMissingTranslationIssue({
      client,
      installationId: "019f0000-0000-7000-8000-000000000002",
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      repository: "blacksmithgu/obsidian-dataview",
      targetLocale: "zh-CN",
      sourceText: "  Currently:   2026-07-18  ",
      submittedAt: "2026-07-18T00:00:00.000Z",
    });

    const captured = payload as ContributionSigningPayload | null;
    expect(captured?.idempotencyKey).toMatch(/^obsidian-localization-quality-v2-[a-f0-9]{64}$/u);
    expect(captured).toMatchObject({
      contributionType: "issue",
      targetHint: {
        externalRegistry: "obsidian_community_plugins",
        externalObjectId: "blacksmithgu/obsidian-dataview",
        upstreamVersion: "0.5.68",
      },
      provenance: { userAction: "explicit_submit" },
      issue: {
        category: "localization_quality",
        severity: "info",
        summary: "Missing UI localization: dataview@0.5.68 -> zh-CN: Currently: 2026-07-18",
      },
    });
  });

  it("submits an explicit inaccurate-upstream report without automatic locale ingestion", async () => {
    let payload: ContributionSigningPayload | null = null;
    const client = {
      submitContribution(value: ContributionSigningPayload) {
        payload = value;
        return Promise.resolve({
          contributionId: "019f0000-0000-7000-8000-000000000005",
          state: "received",
        } as ContributionStateReceipt);
      },
    } as PublicClient;

    await submitObsidianLocalizationIssue({
      client,
      installationId: "019f0000-0000-7000-8000-000000000002",
      issueKind: "inaccurate",
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      repository: "blacksmithgu/obsidian-dataview",
      targetLocale: "zh-CN",
      sourceText: "Settings",
      currentTargetText: "设置项",
      suggestedTargetText: "设置",
      submittedAt: "2026-07-18T00:00:00.000Z",
    });

    const captured = payload as ContributionSigningPayload | null;
    expect(captured?.idempotencyKey).toMatch(/^obsidian-localization-quality-v2-[a-f0-9]{64}$/u);
    expect(captured).toMatchObject({
      provenance: { userAction: "explicit_submit" },
      issue: {
        category: "localization_quality",
        summary: "Inaccurate upstream localization: dataview@0.5.68 -> zh-CN: Settings => 设置项; suggested: 设置",
      },
    });
  });

  it("normalizes safe UI text and rejects empty or oversized input", () => {
    expect(normalizeMissingUiSourceText("  One\n two ")).toBe("One two");
    expect(() => normalizeMissingUiSourceText(" ")).toThrow("请填写");
    expect(() => normalizeMissingUiSourceText("x".repeat(501))).toThrow("500");
    expect(normalizeReportedTargetText("  设置\n项 ", "required")).toBe("设置 项");
    expect(() => normalizeReportedTargetText(undefined, "required")).toThrow("required");
  });
});

describe("submitObsidianLocalizationObservation", () => {
  it("submits target locale independently from source discovery", async () => {
    let payload: ContributionSigningPayload | null = null;
    const client = {
      submitContribution(value: ContributionSigningPayload) {
        payload = value;
        return Promise.resolve({
          contributionId: "019f0000-0000-7000-8000-000000000003",
          state: "received",
        } as ContributionStateReceipt);
      },
    } as PublicClient;
    await submitObsidianLocalizationObservation({
      client,
      installationId: "019f0000-0000-7000-8000-000000000002",
      repository: "blacksmithgu/obsidian-dataview",
      targetLocale: "zh-CN",
      catalog: {
        pluginId: "dataview",
        pluginName: "Dataview",
        pluginVersion: "0.5.68",
        sourceLocale: "en",
        digest: "a".repeat(64),
        artifactDigest: "b".repeat(64),
        scannedAt: "2026-07-17T00:00:00.000Z",
        strings: [],
      },
    });
    const captured = payload as ContributionSigningPayload | null;
    expect(captured?.idempotencyKey).toMatch(/^obsidian-localize-v9-[a-f0-9]{64}$/u);
    expect(captured).toMatchObject({
      contributionType: "localization_observation",
      targetHint: {
        externalRegistry: "obsidian_community_plugins",
        externalObjectId: "dataview",
        upstreamVersion: "0.5.68",
        officialArtifactLocator: "https://github.com/blacksmithgu/obsidian-dataview",
      },
      observation: {
        sourceLocaleRaw: "en",
        targetLocaleRaw: "zh-CN",
        variantRaw: "default",
      },
    });
  });
});
