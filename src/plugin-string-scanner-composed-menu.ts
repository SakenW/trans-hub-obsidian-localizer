import {
  readCallArguments, readPropertyExpression, splitTopLevelTokens, topLevelTokenIndex,
  type MatchingTokenIndexes, type Token,
} from "./plugin-string-scanner-lexical";
import { decodeJsLiteral, staticCatalogKey, type CandidateAggregate } from "./plugin-string-scanner-evidence";
import { addIndirectText, identifierUses } from "./plugin-string-scanner-indirect";

function objectText(object: readonly Token[], property: string): string | undefined {
  if (object[0]?.raw !== "{" || object.at(-1)?.raw !== "}") return undefined;
  const fields = splitTopLevelTokens(object.slice(1, -1));
  const values = fields.filter((field) => {
    const colon = topLevelTokenIndex(field, ":");
    return colon > 0 && staticCatalogKey(field.slice(0, colon)) === property;
  });
  if (values.length !== 1) return undefined;
  const colon = topLevelTokenIndex(values[0] ?? [], ":");
  const literal = values[0]?.slice(colon + 1);
  return literal?.length === 1 && literal[0]?.kind === "literal"
    ? decodeJsLiteral(literal[0].raw) ?? undefined : undefined;
}

/** A static label/description array becomes UI text only when the same array
 * is iterated directly into one menu title. No source literal is patchable. */
export function collectComposedMenuTitles(
  tokens: readonly Token[], matching: MatchingTokenIndexes,
  target: Map<string, CandidateAggregate>, sourceLocale: string,
): void {
  for (let index = 1; index + 3 < tokens.length; index += 1) {
    const name = tokens[index];
    if (name?.kind !== "identifier" || !["const", "let", "var"].includes(tokens[index - 1]?.raw ?? "")
      || tokens[index + 1]?.raw !== "=" || tokens[index + 2]?.raw !== "[") continue;
    const arrayEnd = matching[index + 2] ?? -1;
    if (arrayEnd < 0 || ![";", ","].includes(tokens[arrayEnd + 1]?.raw ?? "")) continue;
    const entries = splitTopLevelTokens(tokens.slice(index + 3, arrayEnd));
    if (entries.length < 2 || entries.length > 20) continue;
    const labels = entries.map((entry) => ({
      label: objectText(entry, "label"),
      description: objectText(entry, "description"),
      type: objectText(entry, "type"),
      icon: objectText(entry, "iconId"),
      token: entry[0],
    }));
    if (labels.some((entry) => !entry.label || !entry.description || !entry.type || !entry.icon)) continue;
    const uses = identifierUses(tokens, name.raw);
    if (uses.length !== 2 || uses[0] !== index) continue;
    const use = uses[1];
    if (tokens[use - 1]?.raw !== "of" || tokens[use - 2]?.kind !== "identifier"
      || !["let", "const"].includes(tokens[use - 3]?.raw ?? "")
      || tokens[use - 4]?.raw !== "(" || tokens[use - 5]?.raw !== "for"
      || tokens[use + 1]?.raw !== ")") continue;
    const item = tokens[use - 2]?.raw ?? "";
    const bodyStart = use + 2;
    const bodyEnd = tokens[bodyStart]?.raw === "{"
      ? matching[bodyStart] ?? -1
      : bodyStart + readPropertyExpression(tokens, bodyStart).length;
    if (bodyEnd <= bodyStart || bodyEnd - bodyStart > 160) continue;
    const body = tokens.slice(bodyStart, bodyEnd);
    const itemUses = identifierUses(body, item);
    if (itemUses.some((relative) => {
      const use = body[relative];
      if (use?.raw !== item || body[relative + 1]?.raw !== ".") return true;
      const property = body[relative + 2]?.raw;
      return !["type", "label", "description", "iconId"].includes(property ?? "")
        || ["=", "+=", "-=", "++", "--"].includes(body[relative + 3]?.raw ?? "");
    })) continue;
    if (body.filter((token) => token.kind === "literal" && token.raw.startsWith("`")
      && token.raw.includes(`\${${item}.`)).length !== 1) continue;
    let separator: string | undefined;
    for (let cursor = bodyStart; cursor < bodyEnd; cursor += 1) {
      if (tokens[cursor]?.raw !== "setTitle" || tokens[cursor - 1]?.raw !== "."
        || tokens[cursor + 1]?.raw !== "(") continue;
      const argument = readCallArguments(tokens, cursor + 1, matching)?.arguments[0];
      const raw = argument?.length === 1 ? argument[0]?.raw : undefined;
      if (raw === undefined || !raw.startsWith("`") || !raw.endsWith("`")) continue;
      const lead = `\${${item}.label}`;
      const tail = `\${${item}.description}`;
      const body = raw.slice(1, -1);
      if (!body.startsWith(lead) || !body.endsWith(tail)) continue;
      const middle = body.slice(lead.length, -tail.length);
      if (middle.includes("${")) continue;
      separator = decodeJsLiteral(`\`${middle}\``) ?? undefined;
      break;
    }
    if (separator === undefined || separator.trim().length === 0) continue;
    for (const entry of labels) {
      if (entry.token !== undefined && entry.label !== undefined && entry.description !== undefined) {
        addIndirectText(target, `${entry.label}${separator}${entry.description}`, entry.token,
          "composedMenuTitle", sourceLocale);
      }
    }
  }
}
