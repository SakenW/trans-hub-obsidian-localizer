import type { ContributionSigningPayload, ContributionStateReceipt, PublicDiscoveryIntent, PublicDiscoveryReceipt } from "@trans-hub/client-protocol";
import type { PublicClient } from "@trans-hub/public-client";
import { describe, expect, it } from "vitest";

import {
  submitObsidianLocalizationObservation,
  submitObsidianPluginDiscovery,
} from "../src/submission";

describe("submitObsidianPluginDiscovery", () => {
  it("submits a source discovery intent without authority mutation", async () => {
    let payload: Omit<PublicDiscoveryIntent, "installationProof"> | null = null;
    const client = {
      submitPublicDiscovery(value: Omit<PublicDiscoveryIntent, "installationProof">) {
        payload = value;
        return Promise.resolve({
          contributionId: "019f0000-0000-7000-8000-000000000001",
          state: "received",
        } as unknown as PublicDiscoveryReceipt);
      },
    } as PublicClient;
    await submitObsidianPluginDiscovery({
      client,
      installationId: "019f0000-0000-7000-8000-000000000002",
      targetLocales: ["zh-CN"],
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
    const captured = payload as Omit<PublicDiscoveryIntent, "installationProof"> | null;
    expect(captured?.idempotencyKey).toMatch(/^obsidian-public-discovery-v3-[a-f0-9]{64}$/u);
    expect(captured).toMatchObject({
      submittedAt: "2026-07-17T00:00:00.000Z",
      kind: "public_discovery_intent",
      target: { registryKey: "official-directory", externalObjectId: "dataview" },
      targetLocales: ["zh-CN"],
    });
    expect(JSON.stringify(captured)).not.toMatch(/repository|candidateLocators|locator|objectKey|executor|adapter/iu);
  });

  it("uses a distinct idempotency namespace for a bounded recovery", async () => {
    let payload: Omit<PublicDiscoveryIntent, "installationProof"> | null = null;
    const client = {
      submitPublicDiscovery(value: Omit<PublicDiscoveryIntent, "installationProof">) {
        payload = value;
        return Promise.resolve({ discoveryId: "retry", taskState: "discovered" } as PublicDiscoveryReceipt);
      },
    } as PublicClient;
    const catalog = {
      pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
      sourceLocale: "en", digest: "a".repeat(64), artifactDigest: "b".repeat(64),
      scannedAt: "2026-07-23T00:00:00.000Z", strings: [],
    };

    await submitObsidianPluginDiscovery({
      client, installationId: "installation", targetLocales: ["zh-CN"], catalog, observationGeneration: 1,
    });
    const recoveryPayload = payload as Omit<PublicDiscoveryIntent, "installationProof"> | null;
    const fallbackIdempotencyKey = recoveryPayload?.idempotencyKey;
    expect(fallbackIdempotencyKey)
      .toMatch(/^obsidian-public-discovery-v3-r1-[a-f0-9]{64}$/u);
    expect(recoveryPayload?.targetLocales).toEqual(["zh-CN"]);

    await submitObsidianPluginDiscovery({
      client, installationId: "installation", targetLocales: ["zh-CN", "ja"],
      catalog, observationGeneration: 1,
    });
    expect((payload as Omit<PublicDiscoveryIntent, "installationProof"> | null)?.idempotencyKey)
      .not.toBe(fallbackIdempotencyKey);

  });

  it("keeps source discovery idempotent for one persisted scan and separates rescans", async () => {
    const idempotencyKeys: string[] = [];
    const client = {
      submitPublicDiscovery(value: Omit<PublicDiscoveryIntent, "installationProof">) {
        idempotencyKeys.push(value.idempotencyKey);
        return Promise.resolve({ discoveryId: "source", taskState: "discovered" } as PublicDiscoveryReceipt);
      },
    } as PublicClient;
    const catalog = {
      pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
      sourceLocale: "en", digest: "a".repeat(64), artifactDigest: "b".repeat(64),
      scannedAt: "2026-07-23T00:00:00.000Z", strings: [],
    };
    const submit = (scannedAt: string) => submitObsidianPluginDiscovery({
      client,
      installationId: "installation",
      targetLocales: ["zh-CN"],
      catalog: { ...catalog, scannedAt },
    });

    await submit(catalog.scannedAt);
    await submit(catalog.scannedAt);
    await submit("2026-07-23T00:00:01.000Z");

    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
    expect(idempotencyKeys[2]).not.toBe(idempotencyKeys[0]);
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
    expect(captured?.idempotencyKey).toMatch(/^obsidian-localize-v12-[a-f0-9]{64}$/u);
    expect(captured).toMatchObject({
      contributionType: "localization_observation",
      targetHint: {
        externalRegistry: "official-directory",
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

  it("keeps localization observation idempotent for one persisted scan and separates rescans", async () => {
    const idempotencyKeys: string[] = [];
    const client = {
      submitContribution(value: ContributionSigningPayload) {
        idempotencyKeys.push(value.idempotencyKey);
        return Promise.resolve({ contributionId: "localization", state: "received" } as ContributionStateReceipt);
      },
    } as PublicClient;
    const catalog = {
      pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
      sourceLocale: "en", digest: "a".repeat(64), artifactDigest: "b".repeat(64),
      scannedAt: "2026-07-23T00:00:00.000Z", strings: [],
    };
    const submit = (scannedAt: string) => submitObsidianLocalizationObservation({
      client,
      installationId: "installation",
      repository: "blacksmithgu/obsidian-dataview",
      targetLocale: "zh-CN",
      catalog: { ...catalog, scannedAt },
    });

    await submit(catalog.scannedAt);
    await submit(catalog.scannedAt);
    await submit("2026-07-23T00:00:01.000Z");

    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
    expect(idempotencyKeys[2]).not.toBe(idempotencyKeys[0]);
  });
});
