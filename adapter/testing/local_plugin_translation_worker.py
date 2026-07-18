#!/usr/bin/env python3
"""Local-only Obsidian source verification, MT and export worker.

The worker consumes a contribution already accepted by the local Trans-Hub API,
downloads the official GitHub release, re-runs the immutable Obsidian adapter,
and publishes the resulting translations through the normal public export
authority.  It is intentionally outside Platform Core and refuses non-loopback
object storage.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from hashlib import sha256
from pathlib import Path
from typing import Any, cast
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import UUID

from sqlalchemy import create_engine, text
from trans_hub_core.domain.services.translation.models import TranslationRequest
from trans_hub_core.domain.services.translation.ports import TranslationPolicy
from trans_hub_core.domain.services.translation.smart_translator import SmartTranslator
from trans_hub_core.infrastructure.translation import (
    TranslatorsAdapter,
    TranslatorsRuntimeSettings,
)

ADAPTER_ROOT = Path(__file__).resolve().parents[1]
TESTING_ROOT = Path(__file__).resolve().parent
for import_root in (ADAPTER_ROOT, TESTING_ROOT):
    if str(import_root) not in sys.path:
        sys.path.insert(0, str(import_root))

from adapter_worker import _placeholder_signature, build_snapshot  # noqa: E402
from bootstrap_dataview_e2e import (  # noqa: E402
    configure_fixture,
    publish_translation_document,
    validate_local_runtime,
)

MAX_COMPONENT_BYTES = 64 * 1024 * 1024
MAX_REGISTRY_BYTES = 8 * 1024 * 1024
DEFAULT_POLL_SECONDS = 15.0
OFFICIAL_REGISTRY_URL = (
    "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/"
    "master/community-plugins.json"
)
_OFFICIAL_REGISTRY: dict[str, dict[str, str]] | None = None


def _database_url() -> str:
    value = os.environ.get("DATABASE_URL") or os.environ.get("TRANSHUB_DATABASE__URL")
    if not value:
        raise ValueError("local_translation_database_url_required")
    return value


def _load_plugin_coordinate(path: Path, plugin_id: str) -> dict[str, Any]:
    document = json.loads(path.read_text(encoding="utf-8"))
    state = document.get("state")
    if not isinstance(state, dict):
        raise ValueError("obsidian_plugin_state_invalid")
    catalogs = state.get("pluginCatalogs")
    submissions = state.get("pluginSubmissions")
    if not isinstance(catalogs, dict) or not isinstance(submissions, dict):
        raise ValueError("obsidian_plugin_state_invalid")
    catalog = catalogs.get(plugin_id)
    submission = submissions.get(plugin_id)
    if not isinstance(catalog, dict) or not isinstance(submission, dict):
        raise ValueError("obsidian_plugin_not_submitted")
    required = {
        "plugin_id": catalog.get("pluginId"),
        "plugin_name": catalog.get("pluginName"),
        "plugin_version": catalog.get("pluginVersion"),
        "source_locale": catalog.get("sourceLocale"),
        "repository": submission.get("repository"),
        "contribution_id": submission.get("contributionId"),
        "localization_contribution_id": submission.get("localizationContributionId"),
        "target_locale": submission.get("localizationTargetLocale"),
    }
    if any(not isinstance(value, str) or not value for value in required.values()):
        raise ValueError("obsidian_plugin_coordinate_invalid")
    if required["plugin_id"] != plugin_id:
        raise ValueError("obsidian_plugin_coordinate_mismatch")
    repository = str(required["repository"])
    if len(repository.split("/")) != 2:
        raise ValueError("obsidian_plugin_repository_invalid")
    strings = catalog.get("strings")
    if not isinstance(strings, list) or not strings:
        raise ValueError("obsidian_plugin_catalog_empty")
    return {**required, "catalog": catalog}


def _pending_plugin_ids(path: Path) -> list[str]:
    document = json.loads(path.read_text(encoding="utf-8"))
    state = document.get("state")
    if not isinstance(state, dict):
        raise ValueError("obsidian_plugin_state_invalid")
    catalogs = state.get("pluginCatalogs")
    submissions = state.get("pluginSubmissions")
    translations = state.get("pluginTranslations")
    if (
        not isinstance(catalogs, dict)
        or not isinstance(submissions, dict)
        or not isinstance(translations, dict)
    ):
        raise ValueError("obsidian_plugin_state_invalid")
    pending: list[str] = []
    for plugin_id, submission in submissions.items():
        if (
            not isinstance(plugin_id, str)
            or not isinstance(submission, dict)
            or not isinstance(catalogs.get(plugin_id), dict)
            or not isinstance(submission.get("localizationContributionId"), str)
            or not isinstance(submission.get("localizationTargetLocale"), str)
        ):
            continue
        catalog = catalogs[plugin_id]
        published = translations.get(plugin_id)
        catalog_sources = {
            row.get("source")
            for row in catalog.get("strings", [])
            if isinstance(row, dict) and isinstance(row.get("source"), str)
        }
        published_sources = (
            {
                row.get("source")
                for row in published.get("entries", [])
                if isinstance(row, dict)
                and isinstance(row.get("source"), str)
                and isinstance(row.get("target"), str)
                and row["target"].strip()
            }
            if isinstance(published, dict)
            and isinstance(published.get("entries"), list)
            else set()
        )
        if (
            isinstance(published, dict)
            and published.get("pluginVersion") == catalog.get("pluginVersion")
            and published.get("targetLocale")
            == submission.get("localizationTargetLocale")
            and catalog_sources
            and catalog_sources <= published_sources
        ):
            continue
        pending.append(plugin_id)
    return sorted(pending)


def _already_published(coordinate: dict[str, Any], dsn: str) -> bool:
    catalog_strings = coordinate["catalog"].get("strings")
    if not isinstance(catalog_strings, list) or not catalog_strings:
        raise ValueError("obsidian_plugin_catalog_empty")
    engine = create_engine(
        dsn.replace("postgresql+asyncpg://", "postgresql+psycopg://", 1)
    )
    with engine.connect() as connection:
        count = connection.scalar(
            text("""SELECT COUNT(*)
                       FROM th.v_public_translation_coverage coverage
                       JOIN th.ecosystem_objects object
                         ON object.id=coverage.object_id
                       JOIN th.ecosystem_object_versions version
                         ON version.id=coverage.object_version_id
                       JOIN th.source_versions source_version
                         ON source_version.id=coverage.source_version_id
                      WHERE object.slug=:plugin_id
                        AND object.lifecycle_status='active'
                        AND version.version_key=:plugin_version
                        AND version.lifecycle_status='published'
                        AND coverage.target_locale=:target_locale
                        AND coverage.target_variant='default'
                        AND coverage.total_unit_count=:catalog_count
                        AND coverage.published_unit_count > 0
                        AND (SELECT count(*)
                               FROM th.translation_work_items item
                              WHERE item.tenant_id=source_version.tenant_id
                                AND item.workspace_id=source_version.workspace_id
                                AND item.source_stream_id=source_version.stream_id
                                AND item.source_version_id=coverage.source_version_id
                                AND item.target_locale=coverage.target_locale
                                AND item.target_variant=coverage.target_variant)
                            = coverage.total_unit_count"""),
            {
                "plugin_id": coordinate["plugin_id"],
                "plugin_version": coordinate["plugin_version"],
                "target_locale": coordinate["target_locale"],
                "catalog_count": len(catalog_strings),
            },
        )
    engine.dispose()
    matches = int(count or 0)
    if matches > 1:
        raise ValueError("obsidian_published_coverage_ambiguous")
    return matches == 1


def _assert_local_contributions(coordinate: dict[str, Any], dsn: str) -> UUID:
    engine = create_engine(dsn.replace("postgresql+asyncpg://", "postgresql+psycopg://", 1))
    with engine.connect() as connection:
        rows = connection.execute(
            text("""SELECT id,tenant_id,contribution_type,external_registry_hint,
                          external_object_id_hint,state,intent
                     FROM th.public_contribution_intents
                    WHERE id IN (:source_id,:localization_id)"""),
            {
                "source_id": UUID(str(coordinate["contribution_id"])),
                "localization_id": UUID(
                    str(coordinate["localization_contribution_id"])
                ),
            },
        ).mappings().all()
    engine.dispose()
    by_type = {str(row["contribution_type"]): row for row in rows}
    source = by_type.get("source_discovery")
    localization = by_type.get("localization_observation")
    if source is None or localization is None:
        raise ValueError("obsidian_plugin_contribution_missing")
    if (
        source["state"] != "received"
        or localization["state"] != "received"
        or source["external_registry_hint"] != "obsidian_community_plugins"
        or source["external_object_id_hint"] != coordinate["repository"]
    ):
        raise ValueError("obsidian_plugin_contribution_not_eligible")
    observation = localization["intent"].get("observation", {})
    if observation.get("targetLocaleRaw") != coordinate["target_locale"]:
        raise ValueError("obsidian_plugin_target_locale_mismatch")
    return UUID(str(source["tenant_id"]))


def _download_release_component(repository: str, version: str, name: str) -> bytes:
    last_error: Exception | None = None
    for tag in (version, f"v{version}"):
        url = f"https://github.com/{repository}/releases/download/{tag}/{name}"
        try:
            request = Request(url, headers={"User-Agent": "Trans-Hub-Obsidian-Local-Dev/1"})
            with urlopen(request, timeout=30) as response:
                content = bytes(response.read(MAX_COMPONENT_BYTES + 1))
        except (HTTPError, URLError, TimeoutError) as exc:
            last_error = exc
            continue
        if not content or len(content) > MAX_COMPONENT_BYTES:
            raise ValueError("obsidian_official_release_component_size_invalid")
        return content
    raise RuntimeError(f"obsidian_official_release_component_unavailable:{name}") from last_error


def _official_registry_entry(plugin_id: str) -> dict[str, str]:
    global _OFFICIAL_REGISTRY
    if _OFFICIAL_REGISTRY is None:
        request = Request(
            OFFICIAL_REGISTRY_URL,
            headers={"User-Agent": "Trans-Hub-Obsidian-Local-Dev/1"},
        )
        try:
            with urlopen(request, timeout=30) as response:
                content = response.read(MAX_REGISTRY_BYTES + 1)
        except (HTTPError, URLError, TimeoutError) as exc:
            raise RuntimeError("obsidian_official_registry_unavailable") from exc
        if not content or len(content) > MAX_REGISTRY_BYTES:
            raise ValueError("obsidian_official_registry_size_invalid")
        try:
            entries = json.loads(content)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("obsidian_official_registry_invalid") from exc
        if not isinstance(entries, list):
            raise ValueError("obsidian_official_registry_invalid")
        registry: dict[str, dict[str, str]] = {}
        for entry in entries:
            if not isinstance(entry, dict):
                raise ValueError("obsidian_official_registry_invalid")
            entry_id = entry.get("id")
            repository = entry.get("repo")
            name = entry.get("name")
            description = entry.get("description")
            if (
                not isinstance(entry_id, str)
                or not isinstance(repository, str)
                or not isinstance(name, str)
                or not name.strip()
                or not isinstance(description, str)
                or not description.strip()
                or len(repository.split("/")) != 2
            ):
                raise ValueError("obsidian_official_registry_invalid")
            registry[entry_id] = {
                "id": entry_id,
                "repo": repository,
                "name": name,
                "description": description,
            }
        _OFFICIAL_REGISTRY = registry
    entry = _OFFICIAL_REGISTRY.get(plugin_id)
    if entry is None:
        raise ValueError("obsidian_plugin_not_in_official_registry")
    return entry


def _official_repository(plugin_id: str) -> str:
    return _official_registry_entry(plugin_id)["repo"]


def _verified_snapshot(coordinate: dict[str, Any]) -> dict[str, Any]:
    registry_entry = _official_registry_entry(str(coordinate["plugin_id"]))
    repository = registry_entry["repo"]
    if repository != coordinate["repository"]:
        raise ValueError("obsidian_official_registry_repository_mismatch")
    version = str(coordinate["plugin_version"])
    manifest = _download_release_component(repository, version, "manifest.json")
    bundle = _download_release_component(repository, version, "main.js")
    snapshot_bytes = build_snapshot(
        manifest,
        bundle,
        registry_metadata_content=json.dumps(
            registry_entry, ensure_ascii=False, sort_keys=True
        ).encode(),
    )
    raw_snapshot = json.loads(snapshot_bytes)
    if not isinstance(raw_snapshot, dict):
        raise ValueError("obsidian_official_release_snapshot_invalid")
    snapshot = cast(dict[str, Any], raw_snapshot)
    plugin = snapshot.get("plugin", {})
    if plugin.get("id") != coordinate["plugin_id"] or plugin.get("version") != version:
        raise ValueError("obsidian_official_release_coordinate_mismatch")
    official = {row["key"]: row["source"] for row in snapshot.get("strings", [])}
    local = {
        row["key"]: row["source"]
        for row in coordinate["catalog"].get("strings", [])
    }
    if not official or not local or any(official.get(key) != source for key, source in local.items()):
        raise ValueError("obsidian_official_release_catalog_mismatch")
    snapshot["snapshot_digest"] = sha256(snapshot_bytes).hexdigest()
    return snapshot


async def _translate_snapshot(
    snapshot: dict[str, Any], *, tenant_id: UUID, target_locale: str
) -> list[dict[str, str]]:
    rows = snapshot["strings"]
    translator = SmartTranslator(
        provider=TranslatorsAdapter(
            TranslatorsRuntimeSettings(
                service="auto",
                max_concurrent=3,
                max_retries=2,
                timeout_seconds=10.0,
            )
        ),
        strategy="translators:auto",
    )
    requests = [
        TranslationRequest(
            segment_id=row["key"],
            source_asset=row["source"],
            source_lang=str(snapshot["source_locale"]),
            target_lang=target_locale,
        )
        for row in rows
    ]
    results = await translator.translate_batch(
        tenant_id=tenant_id,
        requests=requests,
        tm_entries=[],
        glossary_entries=[],
        policy=TranslationPolicy(strategy="mt_only", tag_protect=True),
    )
    translations: list[dict[str, str]] = []
    for row, result in zip(rows, results, strict=True):
        target = result.text.strip()
        if (
            not target
            or result.origin == "error"
            or not result.signals.tag_integrity_ok
            or _placeholder_signature(target) != row["placeholder_signature"]
        ):
            raise RuntimeError(f"obsidian_machine_translation_failed:{row['key']}")
        translations.append(
            {
                "source": row["source"],
                "target": target,
                "provenanceKind": "th-automatic",
                "application": "fill",
            }
        )
    return translations


def _publication_document(
    coordinate: dict[str, Any],
    snapshot: dict[str, Any],
    translations: list[dict[str, str]],
) -> dict[str, Any]:
    catalog_rows = [
        {
            "key": row["key"],
            "source": row["source"],
            "origins": row["origins"],
            "semanticRole": row["semantic_role"],
            "placeholderSignature": row["placeholder_signature"],
            "evidence": row["evidence"],
        }
        for row in snapshot["strings"]
    ]
    plugin_id = str(coordinate["plugin_id"])
    return {
        "state": {
            "pluginCatalogs": {
                plugin_id: {
                    "pluginId": plugin_id,
                    "pluginName": coordinate["plugin_name"],
                    "pluginVersion": coordinate["plugin_version"],
                    "sourceLocale": snapshot["source_locale"],
                    "digest": snapshot["snapshot_digest"],
                    "artifactDigest": snapshot["artifact_digest"],
                    "strings": catalog_rows,
                }
            },
            "pluginTranslations": {
                plugin_id: {
                    "pluginId": plugin_id,
                    "pluginVersion": coordinate["plugin_version"],
                    "targetLocale": coordinate["target_locale"],
                    "entries": translations,
                }
            },
            "pluginSubmissions": {
                plugin_id: {"repository": coordinate["repository"]}
            },
        }
    }


async def localize_once(
    *, plugin_data: Path, plugin_id: str, storage_root: Path, origin: str
) -> dict[str, object]:
    validate_local_runtime(
        allow_local_dev_data=True,
        origin=origin,
        storage_root=storage_root,
    )
    dsn = _database_url()
    coordinate = _load_plugin_coordinate(plugin_data, plugin_id)
    tenant_id = _assert_local_contributions(coordinate, dsn)
    snapshot = _verified_snapshot(coordinate)
    translations = await _translate_snapshot(
        snapshot,
        tenant_id=tenant_id,
        target_locale=str(coordinate["target_locale"]),
    )
    configure_fixture(
        plugin_id=plugin_id,
        plugin_name=str(coordinate["plugin_name"]),
        plugin_version=str(coordinate["plugin_version"]),
        plugin_repository=str(coordinate["repository"]),
        target_locale=str(coordinate["target_locale"]),
    )
    result = publish_translation_document(
        _publication_document(coordinate, snapshot, translations),
        dsn=dsn,
        storage_root=storage_root,
        origin=origin,
    )
    return {
        **result,
        "plugin_id": plugin_id,
        "official_artifact_digest": snapshot["artifact_digest"],
        "verified_string_count": len(snapshot["strings"]),
        "provider": "translators:auto",
    }


async def process_pending_once(
    *,
    plugin_data: Path,
    plugin_ids: list[str] | None,
    storage_root: Path,
    origin: str,
) -> list[dict[str, object]]:
    dsn = _database_url()
    selected = plugin_ids if plugin_ids is not None else _pending_plugin_ids(plugin_data)
    results: list[dict[str, object]] = []
    for plugin_id in selected:
        try:
            coordinate = _load_plugin_coordinate(plugin_data, plugin_id)
            if _already_published(coordinate, dsn):
                results.append({"plugin_id": plugin_id, "status": "already_published"})
                continue
            results.append(
                await localize_once(
                    plugin_data=plugin_data,
                    plugin_id=plugin_id,
                    storage_root=storage_root,
                    origin=origin,
                )
            )
        except Exception as exc:  # noqa: BLE001 - one plugin must not stop the watcher
            results.append(
                {
                    "plugin_id": plugin_id,
                    "status": "failed",
                    "error": f"{type(exc).__name__}:{exc}",
                }
            )
    return results


async def watch_pending(
    *,
    plugin_data: Path,
    plugin_ids: list[str] | None,
    storage_root: Path,
    origin: str,
    poll_seconds: float,
) -> None:
    while True:
        try:
            results = await process_pending_once(
                plugin_data=plugin_data,
                plugin_ids=plugin_ids,
                storage_root=storage_root,
                origin=origin,
            )
        except Exception as exc:  # noqa: BLE001 - transient file reads must retry
            results = [
                {
                    "plugin_id": "*",
                    "status": "failed",
                    "error": f"{type(exc).__name__}:{exc}",
                }
            ]
        print(
            json.dumps(
                {"status": "poll_complete", "results": results},
                ensure_ascii=False,
                default=str,
                sort_keys=True,
            ),
            flush=True,
        )
        await asyncio.sleep(poll_seconds)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--allow-local-dev-data", action="store_true")
    parser.add_argument("--plugin-data", type=Path, required=True)
    parser.add_argument("--plugin-id", action="append")
    parser.add_argument("--storage-root", type=Path, required=True)
    parser.add_argument("--origin", default="http://127.0.0.1:8000")
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--poll-seconds", type=float, default=DEFAULT_POLL_SECONDS)
    args = parser.parse_args()
    if not args.allow_local_dev_data:
        raise SystemExit("allow_local_dev_data_required")
    if args.poll_seconds < 5 or args.poll_seconds > 3600:
        raise SystemExit("poll_seconds_out_of_range")
    if args.watch:
        asyncio.run(
            watch_pending(
                plugin_data=args.plugin_data,
                plugin_ids=args.plugin_id,
                storage_root=args.storage_root,
                origin=args.origin,
                poll_seconds=args.poll_seconds,
            )
        )
        return
    results = asyncio.run(
        process_pending_once(
            plugin_data=args.plugin_data,
            plugin_ids=args.plugin_id,
            storage_root=args.storage_root,
            origin=args.origin,
        )
    )
    print(json.dumps(results, ensure_ascii=False, default=str, sort_keys=True))


if __name__ == "__main__":
    main()
