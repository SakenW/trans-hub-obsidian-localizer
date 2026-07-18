from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType

import pytest


def _load_script() -> ModuleType:
    path = Path(__file__).parents[1] / "testing/local_plugin_translation_worker.py"
    spec = importlib.util.spec_from_file_location(
        "obsidian_local_plugin_translation_worker", path
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


SCRIPT = _load_script()


def _plugin_state(snapshot: dict[str, object]) -> dict[str, object]:
    strings = snapshot["strings"]
    assert isinstance(strings, list)
    return {
        "state": {
            "pluginCatalogs": {
                "example-plugin": {
                    "pluginId": "example-plugin",
                    "pluginName": "Example Plugin",
                    "pluginVersion": "1.2.3",
                    "sourceLocale": "en",
                    "digest": "ab" * 32,
                    "artifactDigest": snapshot["artifact_digest"],
                    "strings": [
                        {
                            "key": row["key"],
                            "source": row["source"],
                            "placeholderSignature": row["placeholder_signature"],
                        }
                        for row in strings
                    ],
                }
            },
            "pluginSubmissions": {
                "example-plugin": {
                    "repository": "owner/example-plugin",
                    "contributionId": "019f0000-0000-7000-8000-000000000001",
                    "localizationContributionId": (
                        "019f0000-0000-7000-8000-000000000002"
                    ),
                    "localizationTargetLocale": "zh-CN",
                }
            },
        }
    }


def _snapshot() -> dict[str, object]:
    manifest = json.dumps(
        {
            "id": "example-plugin",
            "name": "Example Plugin",
            "version": "1.2.3",
            "description": "Example description",
        }
    ).encode()
    bundle = b'plugin.addSettingTab().setName("Example settings");'
    return json.loads(
        SCRIPT.build_snapshot(
            manifest,
            bundle,
            registry_metadata_content=json.dumps(_registry_entry()).encode(),
        )
    )


def _registry_entry(repository: str = "owner/example-plugin") -> dict[str, str]:
    return {
        "id": "example-plugin",
        "name": "Example Plugin",
        "description": "Official example listing.",
        "repo": repository,
    }


def test_worker_accepts_official_release_when_catalog_keys_and_sources_match(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    snapshot = _snapshot()
    state_path = tmp_path / "data.json"
    state_path.write_text(json.dumps(_plugin_state(snapshot)), encoding="utf-8")
    coordinate = SCRIPT._load_plugin_coordinate(state_path, "example-plugin")
    manifest = json.dumps(
        {
            "id": "example-plugin",
            "name": "Example Plugin",
            "version": "1.2.3",
            "description": "Example description",
        }
    ).encode()
    bundle = b'plugin.addSettingTab().setName("Example settings");'
    monkeypatch.setattr(
        SCRIPT,
        "_download_release_component",
        lambda _repository, _version, name: manifest if name == "manifest.json" else bundle,
    )
    monkeypatch.setattr(
        SCRIPT, "_official_registry_entry", lambda _plugin_id: _registry_entry()
    )

    verified = SCRIPT._verified_snapshot(coordinate)

    assert verified["plugin"]["id"] == "example-plugin"
    assert len(verified["strings"]) == len(snapshot["strings"])
    assert len(verified["snapshot_digest"]) == 64


def test_worker_rejects_release_whose_catalog_differs_from_local_observation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    snapshot = _snapshot()
    state = _plugin_state(snapshot)
    catalog = state["state"]["pluginCatalogs"]["example-plugin"]
    catalog["strings"][0]["source"] = "Tampered local source"
    state_path = tmp_path / "data.json"
    state_path.write_text(json.dumps(state), encoding="utf-8")
    coordinate = SCRIPT._load_plugin_coordinate(state_path, "example-plugin")
    manifest = json.dumps(
        {
            "id": "example-plugin",
            "name": "Example Plugin",
            "version": "1.2.3",
            "description": "Example description",
        }
    ).encode()
    bundle = b'plugin.addSettingTab().setName("Example settings");'
    monkeypatch.setattr(
        SCRIPT,
        "_download_release_component",
        lambda _repository, _version, name: manifest if name == "manifest.json" else bundle,
    )
    monkeypatch.setattr(
        SCRIPT, "_official_registry_entry", lambda _plugin_id: _registry_entry()
    )

    with pytest.raises(ValueError, match="catalog_mismatch"):
        SCRIPT._verified_snapshot(coordinate)


def test_worker_rejects_client_repository_that_differs_from_official_registry(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    snapshot = _snapshot()
    state_path = tmp_path / "data.json"
    state_path.write_text(json.dumps(_plugin_state(snapshot)), encoding="utf-8")
    coordinate = SCRIPT._load_plugin_coordinate(state_path, "example-plugin")
    monkeypatch.setattr(
        SCRIPT,
        "_official_registry_entry",
        lambda _plugin_id: _registry_entry("official/example-plugin"),
    )

    with pytest.raises(ValueError, match="official_registry_repository_mismatch"):
        SCRIPT._verified_snapshot(coordinate)


def test_publication_document_preserves_string_keys_and_target_locale() -> None:
    snapshot = _snapshot()
    coordinate = {
        "plugin_id": "example-plugin",
        "plugin_name": "Example Plugin",
        "plugin_version": "1.2.3",
        "repository": "owner/example-plugin",
        "target_locale": "fr",
    }
    snapshot["snapshot_digest"] = "cd" * 32
    translations = [
        {
            "source": row["source"],
            "target": f"FR {row['source']}",
            "provenanceKind": "th-automatic",
            "application": "fill",
        }
        for row in snapshot["strings"]
    ]

    document = SCRIPT._publication_document(coordinate, snapshot, translations)
    catalog = document["state"]["pluginCatalogs"]["example-plugin"]
    translated = document["state"]["pluginTranslations"]["example-plugin"]

    assert catalog["digest"] == "cd" * 32
    assert [row["key"] for row in catalog["strings"]] == [
        row["key"] for row in snapshot["strings"]
    ]
    assert translated["targetLocale"] == "fr"
    assert all(row["semanticRole"] for row in catalog["strings"])
    assert all(
        row["provenanceKind"] == "th-automatic"
        and row["application"] == "fill"
        for row in translated["entries"]
    )


def test_published_query_requires_current_catalog_size() -> None:
    query_constants = SCRIPT._already_published.__code__.co_consts
    sql = next(
        value
        for value in query_constants
        if isinstance(value, str) and "v_public_translation_coverage" in value
    )

    assert "coverage.total_unit_count=:catalog_count" in sql


def test_pending_plugins_excludes_matching_local_translation(tmp_path: Path) -> None:
    snapshot = _snapshot()
    state = _plugin_state(snapshot)
    state["state"]["pluginTranslations"] = {
        "example-plugin": {
            "pluginVersion": "1.2.3",
            "targetLocale": "zh-CN",
            "entries": [
                {"source": row["source"], "target": f"译文 {row['source']}"}
                for row in snapshot["strings"]
            ],
        }
    }
    state_path = tmp_path / "data.json"
    state_path.write_text(json.dumps(state), encoding="utf-8")

    assert SCRIPT._pending_plugin_ids(state_path) == []

    state["state"]["pluginTranslations"]["example-plugin"]["targetLocale"] = "fr"
    state_path.write_text(json.dumps(state), encoding="utf-8")
    assert SCRIPT._pending_plugin_ids(state_path) == ["example-plugin"]


def test_pending_plugins_includes_partial_local_translation(tmp_path: Path) -> None:
    snapshot = _snapshot()
    state = _plugin_state(snapshot)
    state["state"]["pluginTranslations"] = {
        "example-plugin": {
            "pluginVersion": "1.2.3",
            "targetLocale": "zh-CN",
            "entries": [
                {"source": snapshot["strings"][0]["source"], "target": "部分译文"}
            ],
        }
    }
    state_path = tmp_path / "data.json"
    state_path.write_text(json.dumps(state), encoding="utf-8")

    assert SCRIPT._pending_plugin_ids(state_path) == ["example-plugin"]


@pytest.mark.asyncio
async def test_pending_worker_skips_export_that_is_already_public(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    snapshot = _snapshot()
    state = _plugin_state(snapshot)
    state["state"]["pluginTranslations"] = {}
    state_path = tmp_path / "data.json"
    state_path.write_text(json.dumps(state), encoding="utf-8")
    monkeypatch.setattr(SCRIPT, "_database_url", lambda: "postgresql://unused")
    monkeypatch.setattr(SCRIPT, "_already_published", lambda _coordinate, _dsn: True)

    results = await SCRIPT.process_pending_once(
        plugin_data=state_path,
        plugin_ids=None,
        storage_root=tmp_path / "objects",
        origin="http://127.0.0.1:8000",
    )

    assert results == [
        {"plugin_id": "example-plugin", "status": "already_published"}
    ]


def test_public_readiness_requires_shared_work_items() -> None:
    source = Path(SCRIPT.__file__).read_text(encoding="utf-8")

    assert "FROM th.translation_work_items item" in source
    assert "= coverage.total_unit_count" in source
