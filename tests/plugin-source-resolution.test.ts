import { describe, expect, it } from "vitest";

import type { TransportClient } from "../src/http-transport";
import { resolvePublishedPluginSource } from "../src/plugin-source-resolution";

const SOURCE_VERSION_ID = "019f0000-0000-7000-8000-000000000001";
const OBJECT_VERSION_ID = "019f0000-0000-7000-8000-000000000002";

describe("resolvePublishedPluginSource", () => {
  it("resolves an exact published Obsidian plugin version and locale", async () => {
    const result = await resolvePublishedPluginSource({
      transport: transport(200, catalog()),
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      targetLocale: "zh-CN",
    });
    expect(result).toEqual({
      sourceVersionId: SOURCE_VERSION_ID,
      objectVersionId: OBJECT_VERSION_ID,
    });
  });

  it("waits when the exact version has no published target coverage", async () => {
    const body = catalog();
    body.objects[0].coverage[0].published_unit_count = 0;
    await expect(resolvePublishedPluginSource({
      transport: transport(200, body),
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      targetLocale: "zh-CN",
    })).resolves.toBeUndefined();
  });

  it("fails closed when one plugin version resolves to multiple source versions", async () => {
    const body = catalog();
    body.objects[0].coverage.push({
      ...body.objects[0].coverage[0],
      source_version_id: "019f0000-0000-7000-8000-000000000003",
    });
    await expect(resolvePublishedPluginSource({
      transport: transport(200, body),
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      targetLocale: "zh-CN",
    })).rejects.toThrow("不唯一");
  });

  it("selects the source version with the most published units", async () => {
    const body = catalog();
    body.objects[0].coverage[0].published_unit_count = 70;
    body.objects[0].coverage.push({
      ...body.objects[0].coverage[0],
      source_version_id: "019f0000-0000-7000-8000-000000000003",
      published_unit_count: 77,
    });
    await expect(resolvePublishedPluginSource({
      transport: transport(200, body),
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      targetLocale: "zh-CN",
    })).resolves.toEqual({
      sourceVersionId: "019f0000-0000-7000-8000-000000000003",
      objectVersionId: OBJECT_VERSION_ID,
    });
  });
});

function transport(status: number, body: unknown): TransportClient {
  return {
    send: <TResponse>() => Promise.resolve({ status, body: body as TResponse, headers: {} }),
  };
}

function catalog() {
  return {
    ecosystem: { slug: "obsidian" },
    objects: [{
      slug: "dataview",
      versions: [{
        object_version_id: OBJECT_VERSION_ID,
        version_key: "0.5.68",
      }],
      coverage: [{
        object_version_id: OBJECT_VERSION_ID,
        source_version_id: SOURCE_VERSION_ID,
        target_locale: "zh-CN",
        target_variant: "default",
        published_unit_count: 77,
      }],
    }],
  };
}
