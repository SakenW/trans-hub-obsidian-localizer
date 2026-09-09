import { matchingTokenIndex, type Token } from "./plugin-string-scanner-lexical";
import { decodeJsLiteral } from "./plugin-string-scanner-evidence";

/** Statically bind a locale switch to literal CommonJS dictionaries. Never run loaders. */
export function lazyLocaleCatalogs(
  tokens: readonly Token[],
  assignments: ReadonlyMap<string, readonly Token[]>,
  targetLocale: string | undefined,
): { english: readonly Token[]; englishReference: readonly Token[]; native: readonly Token[] } | undefined {
  const modules = new Map<string, readonly Token[]>();
  const duplicates = new Set<string>();
  for (let i = 15; i + 2 < tokens.length; i += 1) {
    if (tokens[i]?.raw !== "exports" || tokens[i + 1]?.raw !== "=" || tokens[i + 2]?.raw !== "{") continue;
    // var loader = commonJS((exports, module) => { module.exports = { literals } });
    const prefix = tokens.slice(i - 15, i).map((token) => token.raw);
    if (!["var", "let", "const", ","].includes(prefix[0] ?? "")
      || prefix[2] !== "=" || prefix[4] !== "(" || prefix[5] !== "("
      || prefix[7] !== "," || prefix[9] !== ")" || prefix[10] !== "="
      || prefix[11] !== ">" || prefix[12] !== "{" || prefix[14] !== "."
      || prefix[8] !== prefix[13]) continue;
    const loader = prefix[1];
    if (modules.has(loader)) { duplicates.add(loader); continue; }
    const end = matchingTokenIndex(tokens, i + 2);
    if (end < 0 || tokens[end + 1]?.raw !== "}" || tokens[end + 2]?.raw !== ")") continue;
    modules.set(loader, tokens.slice(i + 2, end + 1));
  }
  for (const name of duplicates) modules.delete(name);
  if (modules.size === 0) return undefined;
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i]?.raw !== "switch" || tokens[i + 1]?.raw !== "(") continue;
    const conditionEnd = matchingTokenIndex(tokens, i + 1);
    if (conditionEnd < 0 || tokens[conditionEnd + 1]?.raw !== "{") continue;
    const end = matchingTokenIndex(tokens, conditionEnd + 1);
    if (end < 0 || end - conditionEnd > 4096) continue;
    const locales = new Map<string, readonly Token[]>();
    let english: readonly Token[] | undefined;
    let invalid = false;
    for (let j = conditionEnd + 2; j < end; j += 1) {
      if (tokens[j]?.raw === "default" && tokens[j + 1]?.raw === ":"
        && tokens[j + 2]?.raw === "return" && tokens[j + 3]?.kind === "identifier"
        && [";", "}"].includes(tokens[j + 4]?.raw ?? "")) {
        english = assignments.get(tokens[j + 3].raw);
      }
      if (tokens[j]?.raw !== "case" || tokens[j + 1]?.kind !== "literal" || tokens[j + 2]?.raw !== ":") continue;
      const locale = decodeJsLiteral(tokens[j + 1].raw);
      if (locale === null || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/u.test(locale)) { invalid = true; break; }
      let stop = j + 3;
      while (stop < end && !["case", "default"].includes(tokens[stop]?.raw ?? "")) stop += 1;
      const loaders = new Set<string>();
      for (let k = j + 3; k < stop - 2; k += 1) {
        const name = tokens[k].raw;
        if (modules.has(name) && tokens[k + 1]?.raw === "(" && tokens[k + 2]?.raw === ")") loaders.add(name);
      }
      if (loaders.size !== 1 || locales.has(locale)) { invalid = true; break; }
      locales.set(locale, modules.get([...loaders][0])!);
    }
    // English branch plus a common fallback establish this as a localization switch.
    if (invalid || english === undefined || locales.size < 3
      || ![...locales.keys()].some((locale) => /^en(?:-|$)/u.test(locale))) continue;
    const native = targetLocale === undefined ? undefined
      : locales.get(targetLocale) ?? (targetLocale === "zh-CN" ? locales.get("zh") : undefined);
    const englishReference = [...locales].find(([locale]) => /^en(?:-|$)/u.test(locale))![1];
    return { english, englishReference, native: native ?? [] };
  }
  return undefined;
}
