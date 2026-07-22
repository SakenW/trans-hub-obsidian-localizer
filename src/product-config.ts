import { assertSafeApiBaseUrl } from "./api-base-url";

declare const __TRANS_HUB_OBSIDIAN_API_BASE_URL__: string;
declare const __TRANS_HUB_OBSIDIAN_BUILD_CHANNEL__: "development" | "production";
declare const __TRANS_HUB_OBSIDIAN_CLIENT_VERSION__: string;
declare const __TRANS_HUB_OBSIDIAN_REGISTRATION_URL__: string;
declare const __TRANS_HUB_OBSIDIAN_TRANSFER_TRUST_ROOTS__: readonly Readonly<{
  keyId: string;
  keyVersion: number;
  publicKeyBase64Url: string;
}>[];
declare const __TRANS_HUB_OBSIDIAN_WEB_BASE_URL__: string;

export const OBSIDIAN_ECOSYSTEM_SLUG = "obsidian";
export const OBSIDIAN_PLUGIN_ID = "trans-hub-plugin-localizer";
export const OBSIDIAN_AUTH_CALLBACK_ACTION = "trans-hub-plugin-localizer-auth";
export const OBSIDIAN_SOURCE_LOCALE = "en";
export const OBSIDIAN_CLIENT_VERSION = __TRANS_HUB_OBSIDIAN_CLIENT_VERSION__;
export const PRODUCTION_API_BASE_URL = "https://api.trans-hub.net";
export const PRODUCTION_REGISTRATION_URL = "https://trans-hub.net/register";
export const PRODUCTION_WEB_BASE_URL = "https://trans-hub.net";

export const TARGET_LOCALE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "es", label: "Español" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "ru", label: "Русский" },
] as const;

export type TargetLocale = (typeof TARGET_LOCALE_OPTIONS)[number]["value"];
export type BuildChannel = "development" | "production";

export const TRANS_HUB_BUILD_CHANNEL: BuildChannel = __TRANS_HUB_OBSIDIAN_BUILD_CHANNEL__;
export const TRANS_HUB_API_BASE_URL = assertSafeApiBaseUrl(__TRANS_HUB_OBSIDIAN_API_BASE_URL__);
export const TRANS_HUB_REGISTRATION_URL = assertSafeApiBaseUrl(__TRANS_HUB_OBSIDIAN_REGISTRATION_URL__);
export const TRANS_HUB_WEB_BASE_URL = assertSafeApiBaseUrl(__TRANS_HUB_OBSIDIAN_WEB_BASE_URL__);
export const TRANS_HUB_OBSIDIAN_ECOSYSTEM_URL =
  `${TRANS_HUB_WEB_BASE_URL}/ecosystems/${OBSIDIAN_ECOSYSTEM_SLUG}`;
export const TRANS_HUB_TRANSLATION_EXPORT_TRUST_ROOTS =
  __TRANS_HUB_OBSIDIAN_TRANSFER_TRUST_ROOTS__;

if (
  TRANS_HUB_BUILD_CHANNEL === "production" &&
  (
    TRANS_HUB_API_BASE_URL !== PRODUCTION_API_BASE_URL ||
    TRANS_HUB_REGISTRATION_URL !== PRODUCTION_REGISTRATION_URL ||
    TRANS_HUB_WEB_BASE_URL !== PRODUCTION_WEB_BASE_URL
  )
) {
  throw new Error("正式版只能连接语枢生产服务。");
}

export function parseTargetLocale(value: unknown, fallback: TargetLocale = "zh-CN"): TargetLocale {
  return TARGET_LOCALE_OPTIONS.some((option) => option.value === value)
    ? value as TargetLocale
    : fallback;
}

export function resolveObsidianTargetLocale(value: unknown): TargetLocale {
  if (typeof value !== "string") return "en";
  const normalized = value.trim().replaceAll("_", "-").toLowerCase();
  if (normalized === "") return "en";
  if (normalized === "zh-tw" || normalized === "zh-hk" || normalized.startsWith("zh-hant")) {
    return "zh-TW";
  }
  if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
  if (normalized === "pt" || normalized.startsWith("pt-br")) return "pt-BR";
  const base = normalized.split("-", 1)[0];
  return parseTargetLocale(base, "en");
}
