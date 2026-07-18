from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType
from uuid import uuid7  # type: ignore[attr-defined]

import pytest


def _load_script() -> ModuleType:
    path = Path(__file__).parents[1] / "testing/bootstrap_dataview_e2e.py"
    spec = importlib.util.spec_from_file_location(
        "bootstrap_obsidian_dataview_e2e", path
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


SCRIPT = _load_script()


def _fixture_document() -> dict[str, object]:
    strings = [
        {
            "key": f"{index:032x}",
            "source": f"Dataview source {index}",
        }
        for index in range(77)
    ]
    return {
        "state": {
            "pluginCatalogs": {
                "dataview": {
                    "pluginId": "dataview",
                    "pluginVersion": "0.5.68",
                    "digest": "ab" * 32,
                    "strings": strings,
                }
            },
            "pluginTranslations": {
                "dataview": {
                    "pluginId": "dataview",
                    "pluginVersion": "0.5.68",
                    "targetLocale": "zh-CN",
                    "entries": [
                        {
                            "source": row["source"],
                            "target": f"Dataview translation {index}",
                        }
                        for index, row in enumerate(strings)
                    ],
                }
            },
        }
    }


def test_fixture_builds_one_core_pack_with_all_plugin_occurrences(
    tmp_path: Path,
) -> None:
    fixture = tmp_path / "data.json"
    fixture.write_text(json.dumps(_fixture_document()), encoding="utf-8")

    digest, rows = SCRIPT.load_translations(fixture)
    source_version_id = uuid7()
    request, build = SCRIPT._build_export(
        source_stream_id=uuid7(),
        source_version_id=source_version_id,
        rows=rows,
    )

    assert digest == bytes.fromhex("ab" * 32)
    assert len(rows) == 77
    assert request.source_version_id == source_version_id
    assert len(build.packs) == 1
    assert build.packs[0].item_count == 77
    payload = json.loads(build.packs[0].canonical_bytes)
    assert payload["source_version_id"] == str(source_version_id)
    assert len(payload["items"]) == 77
    assert all(
        item["occurrence_key"].startswith("obsidian:plugin-ui:dataview:")
        for item in payload["items"]
    )
    assert all(
        item["structured_content"]["delivery_provenance"]
        == {"kind": "th-published", "application": "fill"}
        for item in payload["items"]
    )


def test_fixture_keeps_untranslated_catalog_rows_out_of_the_export(
    tmp_path: Path,
) -> None:
    document = _fixture_document()
    state = document["state"]
    assert isinstance(state, dict)
    translations = state["pluginTranslations"]
    assert isinstance(translations, dict)
    dataview = translations["dataview"]
    assert isinstance(dataview, dict)
    entries = dataview["entries"]
    assert isinstance(entries, list)
    del entries[-7:]
    fixture = tmp_path / "data.json"
    fixture.write_text(json.dumps(document), encoding="utf-8")

    digest, rows = SCRIPT.load_translations(fixture)
    request, build = SCRIPT._build_export(
        source_stream_id=uuid7(),
        source_version_id=uuid7(),
        rows=rows,
    )

    assert digest == bytes.fromhex("ab" * 32)
    assert len(rows) == 77
    assert sum(row.target is None for row in rows) == 7
    assert len(request.items) == 70
    assert build.packs[0].item_count == 70


def test_workbench_rows_share_export_identity() -> None:
    document = _fixture_document()
    row = document["state"]["pluginCatalogs"]["dataview"]["strings"][0]
    fixture = SCRIPT.FixtureTranslation(
        string_key=row["key"],
        source=row["source"],
        target="译文",
    )
    scope = SCRIPT.AuthorityScope(
        tenant_id=uuid7(),
        workspace_id=uuid7(),
        ecosystem_id=uuid7(),
        object_id=uuid7(),
        object_kind_id=uuid7(),
        object_version_id=uuid7(),
        source_stream_resource_type_id=uuid7(),
    )
    source_stream_id = uuid7()
    parameters = SCRIPT._workbench_row_parameters(
        scope=scope,
        source_stream_id=source_stream_id,
        source_version_id=uuid7(),
        namespace_id=uuid7(),
        namespace_schema_revision_id=uuid7(),
        content_source_id=uuid7(),
        transfer_policy_binding_id=uuid7(),
        row=fixture,
        order_index=0,
    )

    assert parameters["occurrence_key"] == (f"obsidian:plugin-ui:dataview:{row['key']}")
    assert parameters["translation_id"] == SCRIPT._stream_fixture_id(
        source_stream_id, f"translation:{row['key']}"
    )
    assert parameters["source_text"] == row["source"]
    assert parameters["order_index"] == 0


def test_fixture_populates_the_shared_workbench_authority() -> None:
    source = Path(SCRIPT.__file__).read_text(encoding="utf-8")

    assert "INSERT INTO th.translation_work_items" in source
    assert "obsidian_fixture_work_item_count_mismatch" in source
    assert source.count("_seed_workbench_items(") >= 3


def test_fixture_rejects_conflicting_translation_for_one_source(
    tmp_path: Path,
) -> None:
    document = _fixture_document()
    state = document["state"]
    assert isinstance(state, dict)
    translations = state["pluginTranslations"]
    assert isinstance(translations, dict)
    dataview = translations["dataview"]
    assert isinstance(dataview, dict)
    entries = dataview["entries"]
    assert isinstance(entries, list)
    entries.append({"source": "Dataview source 0", "target": "Conflicting translation"})
    fixture = tmp_path / "data.json"
    fixture.write_text(json.dumps(document), encoding="utf-8")

    with pytest.raises(ValueError, match="translation_conflict"):
        SCRIPT.load_translations(fixture)


@pytest.mark.parametrize(
    ("allow_local_dev_data", "origin", "storage_root", "error"),
    [
        (False, "http://127.0.0.1:8000", Path("/tmp/objects"), "allow_local"),
        (True, "https://127.0.0.1", Path("/tmp/objects"), "loopback"),
        (True, "http://example.com", Path("/tmp/objects"), "loopback"),
        (True, "http://user:pass@127.0.0.1", Path("/tmp/objects"), "loopback"),
        (True, "http://127.0.0.1", Path("relative"), "absolute"),
    ],
)
def test_local_fixture_rejects_nonlocal_or_implicit_runtime(
    allow_local_dev_data: bool,
    origin: str,
    storage_root: Path,
    error: str,
) -> None:
    with pytest.raises(ValueError, match=error):
        SCRIPT.validate_local_runtime(
            allow_local_dev_data=allow_local_dev_data,
            origin=origin,
            storage_root=storage_root,
        )
