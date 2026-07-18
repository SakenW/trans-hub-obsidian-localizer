#!/usr/bin/env python3
"""Deterministic static UI scanner for official Obsidian plugin releases.

This file is also the immutable artifact executed by Adapter Plane.  It stays
stdlib-only so the sandbox does not need the API process environment or any
ambient dependency, credential, or network access.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from bisect import bisect_right
from pathlib import Path
from typing import Final, Literal, NamedTuple, TypedDict, cast

CONTRACT_REVISION: Final = 4
PARSER_ID: Final = "obsidian-plugin-ui-structured-v4"
PLUGIN_ID_PATTERN: Final = re.compile(r"^[a-z0-9][a-z0-9-]{0,127}$")
LOCALE_ROLE_PATTERN: Final = re.compile(
    r"^locale:([A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*)$"
)
MAX_LOCALE_COMPONENT_BYTES: Final = 4 * 1024 * 1024
MAX_LOCALE_ENTRIES: Final = 10_000
MAX_LOCALE_DEPTH: Final = 16
MAX_README_COMPONENT_BYTES: Final = 1024 * 1024
QUOTED: Final = r'("(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|`(?:\\.|[^`\\])*`)'
UI_CALL: Final = re.compile(
    rf"(?:Notice|setText|setButtonText|setName|setDesc|setPlaceholder|"
    rf"setTooltip|setTitle|addHeading|appendText)\s*\(\s*{QUOTED}"
)
OPTION_CALL: Final = re.compile(rf"addOption\s*\(\s*{QUOTED}\s*,\s*{QUOTED}")
UI_PROPERTY: Final = re.compile(
    rf"(?:name|description|text|placeholder|label|tooltip|title|header|desc|"
    rf"message|buttonText|ariaLabel|caption|subtitle|summary|warning|error|"
    rf"success|hint)\s*:\s*{QUOTED}"
)
PLACEHOLDER: Final = re.compile(
    r"\$\{[^}]+\}|\{\{[^}]+\}\}|\{\d+\}|%[sdif]|"
    r"</?[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w:.-]*"
    r"(?:=(?:\"[^\"]*\"|'[^']*'|[^\s\"'=<>`]+))?)*\s*/?>"
)
README_HEADING: Final = re.compile(r"^\s{0,3}#{1,6}(?:\s+|$)")
README_LIST_ITEM: Final = re.compile(r"^\s{0,3}(?:[-+*]|\d+[.)])\s+")
README_BLOCKQUOTE: Final = re.compile(r"^\s{0,3}>")
README_FENCE_START: Final = re.compile(r"^\s{0,3}(`{3,}|~{3,})")
README_TABLE_ROW: Final = re.compile(r"^\s*\|?.*\|.*\|?\s*$")
README_HORIZONTAL_RULE: Final = re.compile(r"^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$")
README_INLINE_CODE: Final = re.compile(r"(`+)([^`]*?)\1")
README_INLINE_LINK: Final = re.compile(r"(!?)\[([^\]]*)\]\((?:\\.|[^)])*\)")
README_REFERENCE_LINK: Final = re.compile(r"(!?)\[([^\]]*)\]\[[^\]]*\]")
README_AUTOLINK: Final = re.compile(r"<https?://[^>]+>")
README_HTML_TAG: Final = re.compile(r"</?[A-Za-z][^>]*>")
DYNAMIC_PLACEHOLDER_PREFIX: Final = "th:expr:"
UI_CALL_NAMES: Final = frozenset(
    {
        "Notice",
        "setText",
        "setButtonText",
        "setName",
        "setDesc",
        "setPlaceholder",
        "setTooltip",
        "setTitle",
        "addHeading",
        "appendText",
    }
)
UI_PROPERTY_NAMES: Final = frozenset(
    {
        "name",
        "description",
        "text",
        "placeholder",
        "label",
        "tooltip",
        "title",
        "header",
        "desc",
        "message",
        "buttonText",
        "ariaLabel",
        "caption",
        "subtitle",
        "summary",
        "warning",
        "error",
        "success",
        "hint",
    }
)

StringOrigin = Literal[
    "manifest.name",
    "manifest.description",
    "registry.name",
    "registry.description",
    "readme",
    "ui-call",
    "ui-property",
]
ExtractionStrategy = Literal[
    "manifest", "registry", "markdown", "structured", "regex-fallback"
]
SemanticRole = Literal["official-name", "description", "readme", "runtime-ui"]


class StringEvidence(TypedDict):
    origin: StringOrigin
    strategy: ExtractionStrategy
    symbol: str
    offset: int | None
    line: int | None
    column: int | None


class SnapshotString(TypedDict):
    evidence: list[StringEvidence]
    key: str
    origins: list[StringOrigin]
    semantic_role: SemanticRole
    placeholder_signature: str
    source: str


class NativeLocaleEntry(TypedDict):
    placeholder_signature: str
    resource_key: str
    source: str
    string_key: str
    target: str


class NativeLocalization(TypedDict):
    entries: list[NativeLocaleEntry]
    locale: str
    resource_digest: str
    resource_name: str
    source_resource_digest: str
    source_resource_name: str


class _Token(NamedTuple):
    kind: Literal["identifier", "literal", "punctuation", "other"]
    raw: str
    start: int
    end: int
    line: int
    column: int


class _RenderedExpression(NamedTuple):
    text: str
    static_text: str


class AdapterContractError(ValueError):
    """The acquired component closure does not satisfy the Obsidian contract."""


class ComponentRow(TypedDict):
    role: str
    name: str
    media_type: str
    path: str
    size: int
    transport_digest: str


class AdapterRequest(TypedDict):
    job_id: str
    ipc_namespace: str
    components: list[ComponentRow]


def _canonical_json(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _read_request(path: Path) -> AdapterRequest:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise AdapterContractError("adapter_request_invalid") from exc
    if not isinstance(raw, dict) or not isinstance(raw.get("components"), list):
        raise AdapterContractError("adapter_request_invalid")
    return cast(AdapterRequest, raw)


def _read_component(row: ComponentRow) -> bytes:
    try:
        path = Path(row["path"])
        expected_size = row["size"]
        expected_digest = row["transport_digest"]
    except (KeyError, TypeError) as exc:
        raise AdapterContractError("adapter_component_metadata_invalid") from exc
    if (
        not path.is_absolute()
        or isinstance(expected_size, bool)
        or not isinstance(expected_size, int)
        or expected_size < 0
        or not isinstance(expected_digest, str)
        or not re.fullmatch(r"[0-9a-f]{64}", expected_digest)
    ):
        raise AdapterContractError("adapter_component_metadata_invalid")
    try:
        content = path.read_bytes()
    except OSError as exc:
        raise AdapterContractError("adapter_component_unreadable") from exc
    if (
        len(content) != expected_size
        or hashlib.sha256(content).hexdigest() != expected_digest
    ):
        raise AdapterContractError("adapter_component_identity_mismatch")
    return content


def _canonical_locale(value: str) -> str:
    parts = value.split("-")
    canonical = [parts[0].lower()]
    for part in parts[1:]:
        if len(part) == 4 and part.isalpha():
            canonical.append(part.title())
        elif len(part) == 2 and part.isalpha():
            canonical.append(part.upper())
        else:
            canonical.append(part.lower())
    return "-".join(canonical)


def _required_components(
    request: AdapterRequest,
) -> tuple[bytes, bytes, bytes | None, bytes | None, dict[str, tuple[str, bytes]]]:
    selected: dict[str, bytes] = {}
    registry_metadata: bytes | None = None
    readme_content: bytes | None = None
    locale_components: dict[str, tuple[str, bytes]] = {}
    for raw_row in request["components"]:
        if not isinstance(raw_row, dict):
            raise AdapterContractError("adapter_component_metadata_invalid")
        row = cast(ComponentRow, raw_row)
        role = row.get("role")
        name = row.get("name")
        if not isinstance(role, str) or not isinstance(name, str):
            raise AdapterContractError("adapter_component_metadata_invalid")
        locale_match = LOCALE_ROLE_PATTERN.fullmatch(role)
        if locale_match is not None:
            locale = _canonical_locale(locale_match.group(1))
            if (
                locale in locale_components
                or not name
                or name != Path(name).name
            ):
                raise AdapterContractError("adapter_locale_component_invalid")
            content = _read_component(row)
            if len(content) > MAX_LOCALE_COMPONENT_BYTES:
                raise AdapterContractError("adapter_locale_component_too_large")
            locale_components[locale] = (name, content)
            continue
        if role == "registry-metadata":
            if name != "community-plugin.json" or registry_metadata is not None:
                raise AdapterContractError("adapter_registry_metadata_invalid")
            registry_metadata = _read_component(row)
            continue
        if role == "readme":
            if name != "README.md" or readme_content is not None:
                raise AdapterContractError("adapter_readme_component_invalid")
            readme_content = _read_component(row)
            if (
                len(readme_content) > MAX_README_COMPONENT_BYTES
                or b"\x00" in readme_content
            ):
                raise AdapterContractError("adapter_readme_component_invalid")
            continue
        expected_name = {"manifest": "manifest.json", "main": "main.js"}.get(role)
        if expected_name is None:
            continue
        if name != expected_name or role in selected:
            raise AdapterContractError("adapter_component_closure_invalid")
        selected[role] = _read_component(row)
    if set(selected) != {"manifest", "main"}:
        raise AdapterContractError("adapter_component_closure_incomplete")
    return (
        selected["manifest"],
        selected["main"],
        registry_metadata,
        readme_content,
        locale_components,
    )


def _manifest_value(manifest: dict[str, object], field: str) -> str:
    value = manifest.get(field)
    if not isinstance(value, str) or not value.strip():
        raise AdapterContractError(f"plugin_manifest_{field}_invalid")
    return unicodedata.normalize("NFC", value.strip())


def _decode_manifest(content: bytes) -> dict[str, object]:
    try:
        raw = json.loads(content.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise AdapterContractError("plugin_manifest_invalid") from exc
    if not isinstance(raw, dict):
        raise AdapterContractError("plugin_manifest_invalid")
    return cast(dict[str, object], raw)


def _decode_registry_metadata(content: bytes, plugin_id: str) -> tuple[str, str]:
    try:
        raw = json.loads(content.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise AdapterContractError("plugin_registry_metadata_invalid") from exc
    if not isinstance(raw, dict) or raw.get("id") != plugin_id:
        raise AdapterContractError("plugin_registry_metadata_identity_mismatch")
    metadata = cast(dict[str, object], raw)
    return (
        _manifest_value(metadata, "name"),
        _manifest_value(metadata, "description"),
    )


def _decode_js_literal(literal: str) -> str | None:
    if len(literal) < 2 or literal[0] not in {'"', "'", "`"}:
        return None
    quote = literal[0]
    if literal[-1] != quote:
        return None
    body = literal[1:-1]
    if quote == "`" and "${" in body:
        return None
    output: list[str] = []
    index = 0
    while index < len(body):
        character = body[index]
        if character != "\\":
            output.append(character)
            index += 1
            continue
        index += 1
        if index >= len(body):
            return None
        escaped = body[index]
        index += 1
        simple = {
            "n": "\n",
            "r": "\r",
            "t": "\t",
            "b": "\b",
            "f": "\f",
            "v": "\v",
        }
        if escaped in simple:
            output.append(simple[escaped])
            continue
        if escaped in {"x", "u"}:
            width = 2 if escaped == "x" else 4
            code = body[index : index + width]
            if len(code) != width or not re.fullmatch(r"[0-9a-fA-F]+", code):
                return None
            value = int(code, 16)
            if 0xD800 <= value <= 0xDFFF:
                return None
            output.append(chr(value))
            index += width
            continue
        output.append(escaped)
    return "".join(output)


def _is_translatable_ui_text(value: str) -> bool:
    if not 2 <= len(value) <= 300:
        return False
    if not any(unicodedata.category(character).startswith("L") for character in value):
        return False
    exclusions = (
        r"^(?:https?:|data:|app:|obsidian:)",
        r"[/\\].+\.(?:js|ts|json|css|svg|png|md)$",
        r"^[a-z0-9_.-]+(?:/[a-z0-9_.{}:-]+)+$",
        r"^[.#][A-Za-z0-9_-]+$",
        r"^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+){2,}$",
        r"^[a-z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)+$",
        r"^[A-Z_][A-Z0-9_]+$",
        r"^%[A-Za-z_][A-Za-z0-9_]*$",
    )
    return not any(
        re.search(pattern, value, re.IGNORECASE if index < 2 else 0)
        for index, pattern in enumerate(exclusions)
    )


def _is_plausible_source_locale_text(value: str, source_locale: str) -> bool:
    if source_locale != "en":
        return True
    for character in value:
        if not unicodedata.category(character).startswith("L"):
            continue
        if not unicodedata.name(character, "").startswith("LATIN"):
            return False
    return True


def _placeholder_signature(value: str) -> str:
    return "\0".join(PLACEHOLDER.findall(value))


def _add_candidate(
    collected: dict[str, tuple[set[StringOrigin], dict[str, StringEvidence]]],
    raw: str,
    origin: StringOrigin,
    evidence: StringEvidence,
    *,
    source_locale: str = "en",
    static_probe: str | None = None,
) -> None:
    value = unicodedata.normalize("NFC", raw).strip()
    probe = unicodedata.normalize("NFC", static_probe or raw).strip()
    if (
        not _is_translatable_ui_text(value)
        or not _is_translatable_ui_text(probe)
        or not _is_plausible_source_locale_text(value, source_locale)
    ):
        return
    origins, evidence_rows = collected.setdefault(value, (set(), {}))
    origins.add(origin)
    evidence_rows[_canonical_json(evidence).decode("utf-8")] = evidence


def _collect_regex_matches(
    bundle: str,
    pattern: re.Pattern[str],
    collected: dict[str, tuple[set[StringOrigin], dict[str, StringEvidence]]],
    origin: StringOrigin,
    symbol: str,
    capture_index: int = 1,
) -> None:
    for match in pattern.finditer(bundle):
        decoded = _decode_js_literal(match.group(capture_index))
        if decoded is None:
            continue
        line, column = _offset_location(bundle, match.start())
        _add_candidate(
            collected,
            decoded,
            origin,
            {
                "origin": origin,
                "strategy": "regex-fallback",
                "symbol": symbol,
                "offset": match.start(),
                "line": line,
                "column": column,
            },
        )


def _collect_structured_matches(
    bundle: str,
    collected: dict[str, tuple[set[StringOrigin], dict[str, StringEvidence]]],
) -> bool:
    tokens = _tokenize_javascript(bundle)
    if tokens is None:
        return False
    for index, token in enumerate(tokens):
        if token.kind != "identifier":
            continue
        next_token = tokens[index + 1] if index + 1 < len(tokens) else None
        if (
            (token.raw in UI_CALL_NAMES or token.raw == "addOption")
            and next_token is not None
            and next_token.raw == "("
        ):
            arguments = _read_call_arguments(tokens, index + 1)
            if arguments is None:
                return False
            argument_index = 1 if token.raw == "addOption" else 0
            if argument_index < len(arguments):
                _add_structured_expression(
                    collected, arguments[argument_index], "ui-call", token
                )
            continue
        if (
            token.raw in UI_PROPERTY_NAMES
            and next_token is not None
            and next_token.raw == ":"
        ):
            expression = _read_property_expression(tokens, index + 2)
            if expression:
                _add_structured_expression(collected, expression, "ui-property", token)
    return True


def _add_structured_expression(
    collected: dict[str, tuple[set[StringOrigin], dict[str, StringEvidence]]],
    expression: list[_Token],
    origin: StringOrigin,
    symbol: _Token,
) -> None:
    counter = [0]
    rendered = _render_expression(expression, counter)
    if rendered is None:
        return
    _add_candidate(
        collected,
        rendered.text,
        origin,
        {
            "origin": origin,
            "strategy": "structured",
            "symbol": symbol.raw,
            "offset": symbol.start,
            "line": symbol.line,
            "column": symbol.column,
        },
        static_probe=rendered.static_text,
    )


def _render_expression(
    tokens: list[_Token], counter: list[int]
) -> _RenderedExpression | None:
    expression = _strip_wrapping_parentheses(tokens)
    if len(expression) == 1 and expression[0].kind == "literal":
        literal = expression[0].raw
        if literal.startswith("`"):
            return _render_template_literal(literal, counter)
        decoded = _decode_js_literal(literal)
        if decoded is None:
            return None
        return _RenderedExpression(decoded, decoded)
    plus = _find_last_top_level_plus(expression)
    if plus == -1:
        return None
    left = _render_expression(expression[:plus], counter)
    right_tokens = expression[plus + 1 :]
    if left is not None:
        right = _render_expression(right_tokens, counter)
        if right is None:
            return _RenderedExpression(
                left.text + _next_dynamic_placeholder(counter), left.static_text
            )
        return _RenderedExpression(
            left.text + right.text, left.static_text + right.static_text
        )
    right = _render_expression(right_tokens, counter)
    if right is None:
        return None
    return _RenderedExpression(
        _next_dynamic_placeholder(counter) + right.text, right.static_text
    )


def _render_template_literal(
    raw: str, counter: list[int]
) -> _RenderedExpression | None:
    body = raw[1:-1]
    text: list[str] = []
    static_text: list[str] = []
    chunk: list[str] = []
    index = 0
    while index < len(body):
        character = body[index]
        if character == "\\":
            if index + 1 >= len(body):
                return None
            chunk.append(body[index : index + 2])
            index += 2
            continue
        if character != "$" or index + 1 >= len(body) or body[index + 1] != "{":
            chunk.append(character)
            index += 1
            continue
        decoded = _decode_js_literal(f"`{''.join(chunk)}`")
        if decoded is None:
            return None
        text.append(decoded)
        static_text.append(decoded)
        chunk = []
        end = _find_template_expression_end(body, index + 2)
        if end == -1:
            return None
        text.append(_next_dynamic_placeholder(counter))
        index = end + 1
    decoded = _decode_js_literal(f"`{''.join(chunk)}`")
    if decoded is None:
        return None
    text.append(decoded)
    static_text.append(decoded)
    return _RenderedExpression("".join(text), "".join(static_text))


def _find_template_expression_end(body: str, start: int) -> int:
    depth = 1
    index = start
    while index < len(body):
        character = body[index]
        if character == "\\":
            index += 2
            continue
        if character in {'"', "'", "`"}:
            end = _find_quoted_end(body, index, character)
            if end == -1:
                return -1
            index = end + 1
            continue
        if character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                return index
        index += 1
    return -1


def _next_dynamic_placeholder(counter: list[int]) -> str:
    placeholder = f"{{{{{DYNAMIC_PLACEHOLDER_PREFIX}{counter[0]}}}}}"
    counter[0] += 1
    return placeholder


def _strip_wrapping_parentheses(tokens: list[_Token]) -> list[_Token]:
    current = tokens
    while (
        current
        and current[0].raw == "("
        and _matching_token_index(current, 0) == len(current) - 1
    ):
        current = current[1:-1]
    return current


def _find_last_top_level_plus(tokens: list[_Token]) -> int:
    depth = 0
    last = -1
    for index, token in enumerate(tokens):
        if token.raw in {"(", "[", "{"}:
            depth += 1
        elif token.raw in {
            ")",
            "]",
            "}",
        }:
            depth -= 1
        elif token.raw == "+" and depth == 0:
            last = index
    return last


def _read_call_arguments(
    tokens: list[_Token], open_index: int
) -> list[list[_Token]] | None:
    arguments: list[list[_Token]] = [[]]
    depth = 1
    for token in tokens[open_index + 1 :]:
        if token.raw in {"(", "[", "{"}:
            depth += 1
        elif token.raw in {
            ")",
            "]",
            "}",
        }:
            depth -= 1
            if depth == 0:
                return arguments
            if depth < 0:
                return None
        if token.raw == "," and depth == 1:
            arguments.append([])
        else:
            arguments[-1].append(token)
    return None


def _read_property_expression(tokens: list[_Token], start: int) -> list[_Token]:
    result: list[_Token] = []
    depth = 0
    for token in tokens[start:]:
        if token.raw in {"(", "[", "{"}:
            depth += 1
        elif token.raw in {
            ")",
            "]",
            "}",
        }:
            if depth == 0:
                break
            depth -= 1
        if depth == 0 and token.raw in {",", ";"}:
            break
        result.append(token)
    return result


def _matching_token_index(tokens: list[_Token], open_index: int) -> int:
    pairs = {"(": ")", "[": "]", "{": "}"}
    opening = tokens[open_index].raw
    closing = pairs.get(opening)
    if closing is None:
        return -1
    depth = 0
    for index in range(open_index, len(tokens)):
        if tokens[index].raw == opening:
            depth += 1
        elif tokens[index].raw == closing:
            depth -= 1
            if depth == 0:
                return index
    return -1


def _tokenize_javascript(source: str) -> list[_Token] | None:
    tokens: list[_Token] = []
    line_starts = [0]
    line_starts.extend(index + 1 for index, value in enumerate(source) if value == "\n")
    index = 0
    while index < len(source):
        character = source[index]
        if character.isspace():
            index += 1
            continue
        if source.startswith("//", index):
            newline = source.find("\n", index + 2)
            if newline == -1:
                break
            index = newline
            continue
        if source.startswith("/*", index):
            end = source.find("*/", index + 2)
            if end == -1:
                return None
            index = end + 2
            continue
        start = index
        if character in {'"', "'", "`"}:
            end = _find_quoted_end(source, index, character)
            if end == -1:
                return None
            index = end + 1
            tokens.append(
                _make_token("literal", source[start:index], start, index, line_starts)
            )
            continue
        if character in {"$", "_"} or character.isalpha():
            index += 1
            while index < len(source):
                value = source[index]
                if value not in {"$", "_"} and not value.isalnum():
                    break
                index += 1
            tokens.append(
                _make_token(
                    "identifier", source[start:index], start, index, line_starts
                )
            )
            continue
        index += 1
        kind: Literal["punctuation", "other"] = (
            "punctuation" if character in "()[]{}:,.+;?" else "other"
        )
        tokens.append(_make_token(kind, character, start, index, line_starts))
    return tokens


def _find_quoted_end(source: str, start: int, quote: str) -> int:
    index = start + 1
    while index < len(source):
        if source[index] == "\\":
            index += 2
            continue
        if source[index] == quote:
            return index
        index += 1
    return -1


def _make_token(
    kind: Literal["identifier", "literal", "punctuation", "other"],
    raw: str,
    start: int,
    end: int,
    line_starts: list[int],
) -> _Token:
    line_index = bisect_right(line_starts, start) - 1
    return _Token(
        kind,
        raw,
        start,
        end,
        line_index + 1,
        start - line_starts[line_index],
    )


def _offset_location(source: str, offset: int) -> tuple[int, int]:
    prefix = source[:offset]
    return prefix.count("\n") + 1, offset - prefix.rfind("\n") - 1


def _readme_is_comment_start(line: str) -> bool:
    return line.lstrip().startswith("<!--")


def _readme_is_boundary(line: str) -> bool:
    return bool(
        not line.strip()
        or README_HEADING.match(line)
        or README_LIST_ITEM.match(line)
        or README_BLOCKQUOTE.match(line)
        or README_FENCE_START.match(line)
        or _readme_is_comment_start(line)
    )


def _render_readme_source(value: str) -> str | None:
    sentinel = "\ue000"

    def protect(label: str) -> str:
        return sentinel if label.strip() else ""

    rendered = README_INLINE_CODE.sub(lambda match: protect(match.group(2)), value)
    rendered = README_INLINE_LINK.sub(
        lambda match: "" if match.group(1) == "!" else protect(match.group(2)),
        rendered,
    )
    rendered = README_REFERENCE_LINK.sub(
        lambda match: "" if match.group(1) == "!" else protect(match.group(2)),
        rendered,
    )
    rendered = README_AUTOLINK.sub(
        lambda match: protect(match.group(0)[1:-1]), rendered
    )
    rendered = README_HTML_TAG.sub("", rendered)
    token_index = 0

    def number_token(_match: re.Match[str]) -> str:
        nonlocal token_index
        token = f"{{{{th:expr:{token_index}}}}}"
        token_index += 1
        return token

    rendered = re.sub(sentinel, number_token, rendered)
    rendered = README_LIST_ITEM.sub("", rendered)
    rendered = re.sub(r"[*_~]+", "", rendered)
    rendered = (
        rendered.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )
    rendered = re.sub(r"\s+", " ", rendered).strip()
    if not rendered or not any(character.isalpha() for character in rendered):
        return None
    return unicodedata.normalize("NFC", rendered)


def _extract_readme_strings(content: bytes) -> list[str]:
    try:
        markdown = content.decode("utf-8")
    except UnicodeError as exc:
        raise AdapterContractError("adapter_readme_component_invalid") from exc
    lines = markdown.removeprefix("\ufeff").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    values: set[str] = set()
    index = 0
    if lines and lines[0].strip() == "---":
        for cursor in range(1, len(lines)):
            if lines[cursor].strip() in {"---", "..."}:
                index = cursor + 1
                break

    def add(value: str) -> None:
        for pattern in (README_INLINE_LINK, README_REFERENCE_LINK):
            for match in pattern.finditer(value):
                if match.group(1) == "!":
                    continue
                label = _render_readme_source(match.group(2))
                if label is not None:
                    values.add(label)
        rendered = _render_readme_source(value)
        if rendered is not None:
            values.add(rendered)

    while index < len(lines):
        line = lines[index]
        if not line.strip():
            index += 1
            continue
        if _readme_is_comment_start(line):
            while index < len(lines):
                current = lines[index]
                index += 1
                if "-->" in current:
                    break
            continue
        fence = README_FENCE_START.match(line)
        if fence is not None:
            opening = fence.group(1)
            marker = re.escape(opening[0])
            closing = re.compile(rf"^\s{{0,3}}{marker}{{{len(opening)},}}\s*$")
            index += 1
            while index < len(lines):
                current = lines[index]
                index += 1
                if closing.match(current):
                    break
            continue
        if README_HEADING.match(line):
            value = README_HEADING.sub("", line)
            value = re.sub(r"\s+#+\s*$", "", value).strip()
            if not README_HORIZONTAL_RULE.match(line):
                add(value)
            index += 1
            continue
        if README_LIST_ITEM.match(line):
            block: list[str] = []
            while index < len(lines):
                candidate = lines[index]
                if not candidate.strip():
                    break
                if block and (
                    README_HEADING.match(candidate)
                    or README_BLOCKQUOTE.match(candidate)
                    or README_FENCE_START.match(candidate)
                    or _readme_is_comment_start(candidate)
                ):
                    break
                block.append(candidate)
                index += 1
            if not any(README_TABLE_ROW.match(candidate) for candidate in block):
                for candidate in block:
                    add(candidate)
            continue
        if README_BLOCKQUOTE.match(line):
            block = []
            while index < len(lines) and README_BLOCKQUOTE.match(lines[index]):
                block.append(re.sub(r"^\s{0,3}>\s?", "", lines[index]).strip())
                index += 1
            if not any(README_TABLE_ROW.match(candidate) for candidate in block):
                add("\n".join(candidate for candidate in block if candidate))
            continue
        block = []
        while index < len(lines) and not _readme_is_boundary(lines[index]):
            block.append(lines[index])
            index += 1
        if not block:
            index += 1
            continue
        if (
            not any(README_TABLE_ROW.match(candidate) for candidate in block)
            and not README_HORIZONTAL_RULE.match("\n".join(block))
        ):
            add("\n".join(block).strip())
    return sorted(values)


def _evidence_sort_key(row: StringEvidence) -> tuple[int, str, str, str]:
    return (
        row["offset"] if row["offset"] is not None else -1,
        row["origin"],
        row["strategy"],
        row["symbol"],
    )


def _semantic_role(origins: set[StringOrigin]) -> SemanticRole:
    if "manifest.name" in origins or "registry.name" in origins:
        return "official-name"
    if "manifest.description" in origins or "registry.description" in origins:
        return "description"
    if "readme" in origins:
        return "readme"
    return "runtime-ui"


def _json_pointer_segment(value: str) -> str:
    return value.replace("~", "~0").replace("/", "~1")


def _flatten_locale_document(content: bytes) -> dict[str, str]:
    try:
        decoded: object = json.loads(content.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise AdapterContractError("adapter_locale_component_invalid") from exc
    if not isinstance(decoded, dict):
        raise AdapterContractError("adapter_locale_component_invalid")
    flattened: dict[str, str] = {}

    def visit(value: object, path: tuple[str, ...], depth: int) -> None:
        if depth > MAX_LOCALE_DEPTH:
            raise AdapterContractError("adapter_locale_component_too_deep")
        if isinstance(value, dict):
            for raw_key, child in value.items():
                if not isinstance(raw_key, str) or raw_key == "":
                    raise AdapterContractError("adapter_locale_component_invalid")
                visit(child, (*path, raw_key), depth + 1)
            return
        if isinstance(value, list):
            raise AdapterContractError("adapter_locale_component_invalid")
        if not isinstance(value, str):
            return
        normalized = unicodedata.normalize("NFC", value).strip()
        if normalized == "":
            return
        resource_key = "/" + "/".join(_json_pointer_segment(part) for part in path)
        flattened[resource_key] = normalized
        if len(flattened) > MAX_LOCALE_ENTRIES:
            raise AdapterContractError("adapter_locale_component_too_many_entries")

    visit(decoded, (), 0)
    return flattened


def _build_native_localizations(
    strings: list[SnapshotString],
    locale_components: dict[str, tuple[str, bytes]],
) -> list[NativeLocalization]:
    english = locale_components.get("en")
    if english is None:
        return []
    source_name, source_content = english
    source_document = _flatten_locale_document(source_content)
    scanned_by_source = {row["source"]: row for row in strings}
    result: list[NativeLocalization] = []
    for locale in sorted(locale_components):
        if locale == "en":
            continue
        resource_name, resource_content = locale_components[locale]
        target_document = _flatten_locale_document(resource_content)
        entries: list[NativeLocaleEntry] = []
        for resource_key in sorted(set(source_document) & set(target_document)):
            source = source_document[resource_key]
            target = target_document[resource_key]
            scanned = scanned_by_source.get(source)
            if (
                scanned is None
                or source == target
                or _placeholder_signature(target) != scanned["placeholder_signature"]
            ):
                continue
            entries.append(
                {
                    "placeholder_signature": scanned["placeholder_signature"],
                    "resource_key": resource_key,
                    "source": source,
                    "string_key": scanned["key"],
                    "target": target,
                }
            )
        if entries:
            result.append(
                {
                    "entries": entries,
                    "locale": locale,
                    "resource_digest": hashlib.sha256(resource_content).hexdigest(),
                    "resource_name": resource_name,
                    "source_resource_digest": hashlib.sha256(source_content).hexdigest(),
                    "source_resource_name": source_name,
                }
            )
    return result


def build_snapshot(
    manifest_content: bytes,
    bundle_content: bytes,
    *,
    registry_metadata_content: bytes | None = None,
    readme_content: bytes | None = None,
    native_locale_components: dict[str, tuple[str, bytes]] | None = None,
) -> bytes:
    manifest = _decode_manifest(manifest_content)
    plugin_id = _manifest_value(manifest, "id")
    if not PLUGIN_ID_PATTERN.fullmatch(plugin_id):
        raise AdapterContractError("plugin_manifest_id_invalid")
    plugin_name = _manifest_value(manifest, "name")
    plugin_version = _manifest_value(manifest, "version")
    description = _manifest_value(manifest, "description")
    registry_metadata = (
        _decode_registry_metadata(registry_metadata_content, plugin_id)
        if registry_metadata_content is not None
        else None
    )
    try:
        bundle = bundle_content.decode("utf-8")
    except UnicodeError as exc:
        raise AdapterContractError("plugin_bundle_utf8_invalid") from exc

    collected: dict[str, tuple[set[StringOrigin], dict[str, StringEvidence]]] = {}
    _add_candidate(
        collected,
        plugin_name,
        "manifest.name",
        {
            "origin": "manifest.name",
            "strategy": "manifest",
            "symbol": "manifest.name",
            "offset": None,
            "line": None,
            "column": None,
        },
    )
    _add_candidate(
        collected,
        description,
        "manifest.description",
        {
            "origin": "manifest.description",
            "strategy": "manifest",
            "symbol": "manifest.description",
            "offset": None,
            "line": None,
            "column": None,
        },
    )
    if registry_metadata is not None:
        registry_name, registry_description = registry_metadata
        _add_candidate(
            collected,
            registry_name,
            "registry.name",
            {
                "origin": "registry.name",
                "strategy": "registry",
                "symbol": "community-plugins.name",
                "offset": None,
                "line": None,
                "column": None,
            },
        )
        _add_candidate(
            collected,
            registry_description,
            "registry.description",
            {
                "origin": "registry.description",
                "strategy": "registry",
                "symbol": "community-plugins.description",
                "offset": None,
                "line": None,
                "column": None,
            },
        )
    if readme_content is not None:
        if (
            len(readme_content) > MAX_README_COMPONENT_BYTES
            or b"\x00" in readme_content
        ):
            raise AdapterContractError("adapter_readme_component_invalid")
        for source in _extract_readme_strings(readme_content):
            _add_candidate(
                collected,
                source,
                "readme",
                {
                    "origin": "readme",
                    "strategy": "markdown",
                    "symbol": "README.md",
                    "offset": None,
                    "line": None,
                    "column": None,
                },
            )
    if not _collect_structured_matches(bundle, collected):
        _collect_regex_matches(bundle, UI_CALL, collected, "ui-call", "ui-call")
        _collect_regex_matches(
            bundle, OPTION_CALL, collected, "ui-call", "addOption", 2
        )
        _collect_regex_matches(
            bundle, UI_PROPERTY, collected, "ui-property", "ui-property"
        )

    strings: list[SnapshotString] = []
    for source in sorted(collected):
        normalized = unicodedata.normalize("NFC", source)
        key = hashlib.sha256(f"{plugin_id}\0{normalized}".encode()).hexdigest()[:32]
        origins, evidence = collected[source]
        sorted_evidence: list[StringEvidence] = sorted(
            list(evidence.values()), key=_evidence_sort_key
        )
        strings.append(
            {
                "evidence": sorted_evidence,
                "key": key,
                "origins": sorted(origins),
                "semantic_role": _semantic_role(origins),
                "placeholder_signature": _placeholder_signature(source),
                "source": normalized,
            }
        )

    return _canonical_json(
        {
            "adapter": "obsidian",
            "artifact_digest": hashlib.sha256(bundle_content).hexdigest(),
            "contract_revision": CONTRACT_REVISION,
            "parser": PARSER_ID,
            "plugin": {
                "description": description,
                "id": plugin_id,
                "name": plugin_name,
                "version": plugin_version,
            },
            "source_locale": "en",
            "strings": strings,
            "native_localizations": _build_native_localizations(
                strings, native_locale_components or {}
            ),
        }
    )


def run_adapter(request_path: Path, output_dir: Path) -> Path:
    request = _read_request(request_path)
    (
        manifest_content,
        bundle_content,
        registry_metadata,
        readme_content,
        locale_components,
    ) = _required_components(request)
    if not output_dir.is_dir():
        raise AdapterContractError("adapter_output_directory_invalid")
    snapshot_path = output_dir / "snapshot.bin"
    snapshot_path.write_bytes(
        build_snapshot(
            manifest_content,
            bundle_content,
            registry_metadata_content=registry_metadata,
            readme_content=readme_content,
            native_locale_components=locale_components,
        )
    )
    return snapshot_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    run_adapter(args.request, args.output)


if __name__ == "__main__":
    main()
