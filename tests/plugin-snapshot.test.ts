import { describe, expect, it } from "vitest";

import { buildPluginCanonicalSnapshot, OBSIDIAN_PLUGIN_UI_NAMESPACE } from "../src/plugin-snapshot";

describe("buildPluginCanonicalSnapshot", () => {
  it("builds stable plugin UI identities and deduplicates atoms", async () => {
    const snapshot = await buildPluginCanonicalSnapshot({
      catalog: {
        pluginId: "sample-plugin",
        pluginName: "Sample Plugin",
        pluginVersion: "1.2.3",
        sourceLocale: "en",
        digest: "catalog-digest",
        artifactDigest: "a".repeat(64),
        scannedAt: "2026-07-15T00:00:00.000Z",
        strings: [
          { key: "a".repeat(32), source: "Settings", origins: ["ui-call"], placeholderSignature: "" },
          { key: "b".repeat(32), source: "Settings", origins: ["ui-property"], placeholderSignature: "" },
        ],
      },
      namespaceContracts: [{
        namespaceKey: OBSIDIAN_PLUGIN_UI_NAMESPACE,
        namespaceContractId: "018f0000-0000-7000-8000-000000000010",
        namespaceId: "018f0000-0000-7000-8000-000000000011",
        namespaceSchemaRevisionId: "018f0000-0000-7000-8000-000000000012",
        namespaceSchemaRevision: 1,
        contractDigest: "a".repeat(64),
      }],
    });

    expect(snapshot.atoms).toHaveLength(1);
    expect(snapshot.units).toHaveLength(2);
    expect(snapshot.occurrences.map((item) => item.occurrenceKey)).toEqual([
      `obsidian:plugin-ui:sample-plugin:${"a".repeat(32)}`,
      `obsidian:plugin-ui:sample-plugin:${"b".repeat(32)}`,
    ]);
    expect(snapshot.contentSources[0]?.sourceKey).toBe("obsidian-plugin:sample-plugin:1.2.3");
  });
});
