/** Public obligations only; internal governance records never cross this boundary. */
export type PublicLicenseDelivery = Readonly<{
  copyright_notices: readonly string[];
  modification_notice: string;
  same_license_identifier: string;
  source_form: Readonly<{
    kind: "in_document";
    format: "trans-hub.translation-pack";
    location: "/items";
    fields: readonly ["occurrence_key", "target_text", "structured_content"];
  }>;
  upstream_source_url: string;
  upstream_source_revision: string;
  public_use: Readonly<{
    operations: readonly ["translation", "public_hosting", "cdn_redistribution"];
    commercial_context: "commercial" | "noncommercial" | "mixed";
  }>;
}>;

export type PublicLicenseCompliance = Readonly<{
  schema: "trans-hub.public-license-compliance";
  version: 1 | 2 | 3;
  spdx_expression: string;
  license_digest: string;
  license_url: string;
  immutable_revision: string;
  notice_urls: readonly string[];
  delivery?: PublicLicenseDelivery;
}>;

const baseKeys = ["schema", "version", "spdx_expression", "license_digest",
  "license_url", "immutable_revision", "notice_urls"];

export function readTranslationPackLicense(document: unknown): PublicLicenseCompliance | undefined {
  if (typeof document !== "object" || document === null || Array.isArray(document)) return undefined;
  const pack = record(document);
  if (pack.license_compliance === undefined) return undefined;
  const value = record(pack.license_compliance);
  const version = value.version;
  if (value.schema !== "trans-hub.public-license-compliance" || (version !== 1 && version !== 2 && version !== 3)) fail();
  const identifier = nonblank(value.spdx_expression);
  const digest = nonblank(value.license_digest);
  if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) fail();
  const notices = strings(value.notice_urls);
  notices.forEach(https);
  const result: PublicLicenseCompliance = {
    schema: "trans-hub.public-license-compliance", version,
    spdx_expression: identifier, license_digest: digest, license_url: https(value.license_url),
    immutable_revision: nonblank(value.immutable_revision), notice_urls: notices,
  };
  if (version !== 3) return result;
  exact(value, [...baseKeys, "delivery"]);
  const delivery = record(value.delivery);
  exact(delivery, ["copyright_notices", "modification_notice", "same_license_identifier", "source_form",
    "upstream_source_url", "upstream_source_revision", "public_use"]);
  const source = record(delivery.source_form);
  exact(source, ["kind", "format", "location", "fields"]);
  if (source.kind !== "in_document" || source.format !== "trans-hub.translation-pack"
      || source.location !== "/items"
      || JSON.stringify(source.fields) !== '["occurrence_key","target_text","structured_content"]') fail();
  const use = record(delivery.public_use);
  exact(use, ["operations", "commercial_context"]);
  if (JSON.stringify(use.operations) !== '["translation","public_hosting","cdn_redistribution"]'
      || !["commercial", "noncommercial", "mixed"].includes(String(use.commercial_context))) fail();
  const copyrights = strings(delivery.copyright_notices);
  if (copyrights.length === 0 || notices.length === 0 || delivery.same_license_identifier !== identifier
      || delivery.upstream_source_revision !== result.immutable_revision
      || !/^[0-9a-f]{40,64}$/u.test(result.immutable_revision)) fail();
  if (pack.schema !== "trans-hub.translation-pack" || pack.version !== 1 || !Array.isArray(pack.items)) fail();
  for (const candidate of pack.items as unknown[]) {
    const item = record(candidate);
    nonblank(item.occurrence_key);
    if (typeof item.target_text !== "string") fail();
    record(item.structured_content);
  }
  return { ...result, delivery: {
    copyright_notices: copyrights, modification_notice: nonblank(delivery.modification_notice),
    same_license_identifier: identifier,
    source_form: { kind: "in_document", format: "trans-hub.translation-pack", location: "/items",
      fields: ["occurrence_key", "target_text", "structured_content"] },
    upstream_source_url: https(delivery.upstream_source_url), upstream_source_revision: result.immutable_revision,
    public_use: { operations: ["translation", "public_hosting", "cdn_redistribution"],
      commercial_context: use.commercial_context as "commercial" | "noncommercial" | "mixed" },
  } };
}

function fail(): never { throw new Error("translation_pack_license_compliance_invalid"); }
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function nonblank(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return fail();
  return value;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return fail();
  return value.map(nonblank);
}
function https(value: unknown): string {
  const text = nonblank(value);
  const url = new URL(text);
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.hash || /\s/u.test(text)) fail();
  return text;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail();
}
