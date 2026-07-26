import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import * as ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

import {
  isClientDisplayName,
  localizedClientName,
  setClientLocale,
  translate,
} from "../src/client-localization";

async function translationCallKeys(): Promise<readonly string[]> {
  const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
  const pendingDirectories = [sourceRoot];
  const sourceFiles: string[] = [];
  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop();
    if (directory === undefined) continue;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) pendingDirectories.push(path);
      else if (entry.name.endsWith(".ts") && entry.name !== "client-localization.ts") sourceFiles.push(path);
    }
  }

  const keys = new Set<string>();
  for (const path of sourceFiles) {
    const source = ts.createSourceFile(path, await readFile(path, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === "translate"
        && ts.isStringLiteralLike(node.arguments[0])
      ) keys.add(node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...keys].sort();
}

async function englishMessageKeys(): Promise<ReadonlySet<string>> {
  const path = fileURLToPath(new URL("../src/client-localization.ts", import.meta.url));
  const source = ts.createSourceFile(path, await readFile(path, "utf8"), ts.ScriptTarget.Latest, true);
  const keys = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node)
      && node.name.getText(source) === "ENGLISH_MESSAGES"
      && node.initializer !== undefined
      && ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const property of node.initializer.properties) {
        if (ts.isPropertyAssignment(property) && ts.isStringLiteralLike(property.name)) keys.add(property.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return keys;
}

describe("client localization", () => {
  afterEach(() => { setClientLocale("zh-CN"); });

  it("uses the selected translation target for the plugin's own UI", () => {
    setClientLocale("en");
    expect(translate("翻译为")).toBe("Translate to");
    expect(translate("已选择 {selected} / {total}", { selected: 2, total: 3 }))
      .toBe("Selected 2 / 3");
    expect(localizedClientName()).toBe("Trans-Hub Localizer");
    expect(translate("查看进展并参与贡献")).toBe("View progress and contribute");
  });

  it("keeps Simplified Chinese source copy for the Simplified Chinese target", () => {
    setClientLocale("zh-CN");
    expect(translate("翻译为")).toBe("翻译为");
    expect(localizedClientName()).toBe("语枢 · 插件本地化");
  });

  it("keeps both bundled Chinese and English UI packs complete", async () => {
    const keys = await translationCallKeys();
    const englishKeys = await englishMessageKeys();

    setClientLocale("zh-CN");
    expect(keys.map((key) => translate(key))).toEqual(keys);

    setClientLocale("en");
    expect(keys.filter((key) => !englishKeys.has(key))).toEqual([]);
  });

  it("recognizes the previous navigation title after switching client locale", () => {
    setClientLocale("zh-CN");
    const previousNavigationTitle = localizedClientName();

    setClientLocale("en");

    expect(localizedClientName()).toBe("Trans-Hub Localizer");
    expect(isClientDisplayName(previousNavigationTitle)).toBe(true);
    expect(isClientDisplayName(localizedClientName())).toBe(true);
    expect(isClientDisplayName("Dataview")).toBe(false);
  });

  it("falls back deterministically when a bundled target pack is not published yet", () => {
    setClientLocale("ja");
    expect(translate("翻译为")).toBe("Translate to");
  });
});
