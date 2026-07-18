from __future__ import annotations

import json
import os
import platform
import subprocess
import sys
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path

import pytest
from adapter_worker import (
    AdapterContractError,
    _placeholder_signature,
    build_snapshot,
)
from trans_hub_core.domain.adapter_plane.models import (
    AcquiredComponent,
    AdapterPlaneError,
)
from trans_hub_core.infrastructure.adapter_plane.process_sandbox import (
    MacOSSandboxExecBuilder,
    ProcessSandboxExecutor,
)
from trans_hub_core.use_cases.adapter_plane.ports import (
    ApprovedAdapterProcess,
    SandboxExecutionSpec,
)


def _worker_path() -> Path:
    return (Path(__file__).parents[1] / "adapter_worker.py").resolve()


@dataclass
class _ApprovedRegistry:
    process: ApprovedAdapterProcess

    async def verify_production_contract(self) -> None:
        return None

    async def resolve(self, artifact_digest: bytes) -> ApprovedAdapterProcess:
        if artifact_digest != self.process.artifact_digest:
            raise AdapterPlaneError("unapproved adapter build")
        return self.process


def _manifest() -> bytes:
    return json.dumps(
        {
            "id": "example-plugin",
            "name": "Example Plugin",
            "version": "1.2.3",
            "description": "Explore your notes.",
        }
    ).encode()


def test_build_snapshot_is_deterministic_and_extracts_ui_literals() -> None:
    bundle = b"""new Notice("Ready now"); setName('Display name');\n"""
    bundle += b"""addOption("compact", "Compact view");"""
    bundle += b"""const metadata = { title: "Settings title" };"""
    bundle += b"""const grammar = { name: "%_Choice_1" };"""

    first = build_snapshot(_manifest(), bundle)
    second = build_snapshot(_manifest(), bundle)
    payload = json.loads(first)

    assert first == second
    assert payload["adapter"] == "obsidian"
    assert payload["artifact_digest"] == sha256(bundle).hexdigest()
    assert payload["plugin"] == {
        "description": "Explore your notes.",
        "id": "example-plugin",
        "name": "Example Plugin",
        "version": "1.2.3",
    }
    assert [row["source"] for row in payload["strings"]] == [
        "Compact view",
        "Display name",
        "Example Plugin",
        "Explore your notes.",
        "Ready now",
        "Settings title",
    ]
    roles = {row["source"]: row["semantic_role"] for row in payload["strings"]}
    assert roles["Example Plugin"] == "official-name"
    assert roles["Explore your notes."] == "description"
    assert roles["Ready now"] == "runtime-ui"
    assert payload["contract_revision"] == 3
    assert payload["parser"] == "obsidian-plugin-ui-structured-v3"
    assert payload["native_localizations"] == []


def test_build_snapshot_includes_official_registry_description() -> None:
    registry = json.dumps(
        {
            "id": "example-plugin",
            "name": "Example Plugin",
            "description": "Browse example workflows.",
            "repo": "owner/example-plugin",
        }
    ).encode()

    payload = json.loads(
        build_snapshot(
            _manifest(),
            b"",
            registry_metadata_content=registry,
        )
    )
    rows = {row["source"]: row for row in payload["strings"]}

    assert rows["Example Plugin"]["origins"] == [
        "manifest.name",
        "registry.name",
    ]
    assert rows["Browse example workflows."]["semantic_role"] == "description"
    assert rows["Browse example workflows."]["evidence"][0]["strategy"] == "registry"


def test_build_snapshot_pairs_only_verified_placeholder_safe_native_locale_entries() -> None:
    bundle = b'setting.setName("Settings"); setting.setDesc(`Rows: ${pageCount}`);'
    english = json.dumps(
        {"settings": {"title": "Settings", "rows": "Rows: {{th:expr:0}}"}}
    ).encode()
    chinese = json.dumps(
        {"settings": {"title": "设置", "rows": "行数"}}, ensure_ascii=False
    ).encode()

    payload = json.loads(
        build_snapshot(
            _manifest(),
            bundle,
            native_locale_components={
                "en": ("en.json", english),
                "zh-CN": ("zh-CN.json", chinese),
            },
        )
    )

    assert payload["native_localizations"] == [
        {
            "entries": [
                {
                    "placeholder_signature": "",
                    "resource_key": "/settings/title",
                    "source": "Settings",
                    "string_key": sha256(b"example-plugin\0Settings").hexdigest()[:32],
                    "target": "设置",
                }
            ],
            "locale": "zh-CN",
            "resource_digest": sha256(chinese).hexdigest(),
            "resource_name": "zh-CN.json",
            "source_resource_digest": sha256(english).hexdigest(),
            "source_resource_name": "en.json",
        }
    ]


def test_build_snapshot_does_not_guess_native_localization_without_english_baseline() -> None:
    payload = json.loads(
        build_snapshot(
            _manifest(),
            b'setting.setName("Settings");',
            native_locale_components={
                "zh-CN": ("zh-CN.json", '{"title":"设置"}'.encode())
            },
        )
    )

    assert payload["native_localizations"] == []


def test_build_snapshot_folds_static_and_signs_dynamic_set_desc() -> None:
    bundle = b"\n".join(
        (
            b'setting.setName("Open " + "Dataview settings");',
            b'setting.setDesc("Rows: " + pageCount + " \xc2\xb7 fields: " + fieldCount);',
            b"setting.setDesc(`Indexed ${pageCount} pages`);",
            b'const worker = { name: "Dataview Indexer " + (index + 1) };',
            b'const cache = { name: "dataview/cache/" + appId };',
            b"setting.setDesc(description);",
        )
    )

    payload = json.loads(build_snapshot(_manifest(), bundle))
    rows = {row["source"]: row for row in payload["strings"]}

    assert "Open Dataview settings" in rows
    assert "Rows: {{th:expr:0}} \u00b7 fields: {{th:expr:1}}" in rows
    assert "Indexed {{th:expr:0}} pages" in rows
    assert "Dataview Indexer {{th:expr:0}}" in rows
    assert "{{th:expr:0}}" not in rows
    assert "dataview/cache/{{th:expr:0}}" not in rows
    dynamic = rows["Rows: {{th:expr:0}} \u00b7 fields: {{th:expr:1}}"]
    assert dynamic["placeholder_signature"] == ("{{th:expr:0}}\0{{th:expr:1}}")
    assert dynamic["evidence"] == [
        {
            "column": 8,
            "line": 2,
            "offset": 56,
            "origin": "ui-call",
            "strategy": "structured",
            "symbol": "setDesc",
        }
    ]


def test_build_snapshot_uses_regex_fallback_after_structural_failure() -> None:
    payload = json.loads(
        build_snapshot(
            _manifest(),
            b'setting.setDesc("Fallback description"); /* damaged trailing comment',
        )
    )
    fallback = next(
        row for row in payload["strings"] if row["source"] == "Fallback description"
    )

    assert fallback["evidence"][0]["strategy"] == "regex-fallback"


def test_placeholder_signature_distinguishes_diagnostics_from_html() -> None:
    assert _placeholder_signature("<unknown widget '{{th:expr:0}}>'") == (
        "{{th:expr:0}}"
    )
    assert _placeholder_signature('<strong class="name">Value</strong>') == (
        '<strong class="name">\0</strong>'
    )


def test_build_snapshot_rejects_incomplete_or_invalid_manifest() -> None:
    with pytest.raises(AdapterContractError, match="description"):
        build_snapshot(b'{"id":"demo","name":"Demo","version":"1"}', b"")
    with pytest.raises(AdapterContractError, match="id_invalid"):
        build_snapshot(
            b'{"id":"../demo","name":"Demo","version":"1","description":"Demo plugin"}',
            b"",
        )


def test_worker_satisfies_adapter_plane_file_contract(tmp_path: Path) -> None:
    manifest = tmp_path / "manifest.json"
    main = tmp_path / "main.js"
    english = tmp_path / "en.json"
    chinese = tmp_path / "zh-CN.json"
    output = tmp_path / "output"
    output.mkdir()
    manifest.write_bytes(_manifest())
    main.write_bytes(b'new Notice("Adapter ready");')
    english.write_text('{"notice":"Adapter ready"}', encoding="utf-8")
    chinese.write_text('{"notice":"适配器就绪"}', encoding="utf-8")
    request = tmp_path / "request.json"
    request.write_text(
        json.dumps(
            {
                "job_id": "obsidian-test",
                "ipc_namespace": str(tmp_path / "ipc"),
                "components": [
                    {
                        "role": "manifest",
                        "name": "manifest.json",
                        "media_type": "application/json",
                        "path": str(manifest),
                        "size": manifest.stat().st_size,
                        "transport_digest": sha256(manifest.read_bytes()).hexdigest(),
                    },
                    {
                        "role": "main",
                        "name": "main.js",
                        "media_type": "text/javascript",
                        "path": str(main),
                        "size": main.stat().st_size,
                        "transport_digest": sha256(main.read_bytes()).hexdigest(),
                    },
                    {
                        "role": "locale:en",
                        "name": "en.json",
                        "media_type": "application/json",
                        "path": str(english),
                        "size": english.stat().st_size,
                        "transport_digest": sha256(english.read_bytes()).hexdigest(),
                    },
                    {
                        "role": "locale:zh-CN",
                        "name": "zh-CN.json",
                        "media_type": "application/json",
                        "path": str(chinese),
                        "size": chinese.stat().st_size,
                        "transport_digest": sha256(chinese.read_bytes()).hexdigest(),
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    result = subprocess.run(
        [
            sys.executable,
            "-I",
            str(_worker_path()),
            "--request",
            str(request),
            "--output",
            str(output),
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert [path.name for path in output.iterdir()] == ["snapshot.bin"]
    payload = json.loads((output / "snapshot.bin").read_bytes())
    assert [row["source"] for row in payload["strings"]] == [
        "Adapter ready",
        "Example Plugin",
        "Explore your notes.",
    ]
    assert payload["native_localizations"][0]["entries"][0] == {
        "placeholder_signature": "",
        "resource_key": "/notice",
        "source": "Adapter ready",
        "string_key": sha256(b"example-plugin\0Adapter ready").hexdigest()[:32],
        "target": "适配器就绪",
    }


@pytest.mark.asyncio
@pytest.mark.skipif(platform.system() != "Darwin", reason="macOS sandbox E2E")
async def test_real_dataview_release_in_adapter_plane_sandbox() -> None:
    raw_root = os.environ.get("TRANS_HUB_DATAVIEW_RELEASE_DIR")
    if raw_root is None:
        pytest.skip("set TRANS_HUB_DATAVIEW_RELEASE_DIR for the real release E2E")
    root = Path(raw_root).resolve()
    manifest = root / "manifest.json"
    main = root / "main.js"
    if not manifest.is_file() or not main.is_file():
        pytest.fail("Dataview release directory must contain manifest.json and main.js")

    worker = _worker_path()
    approved = ApprovedAdapterProcess(
        artifact_digest=sha256(worker.read_bytes()).digest(),
        artifact_path=worker,
        argv=(sys.executable, str(worker)),
    )
    try:
        builder = MacOSSandboxExecBuilder()
    except AdapterPlaneError as exc:
        pytest.skip(f"macOS sandbox unavailable: {exc}")
    executor = ProcessSandboxExecutor(
        registry=_ApprovedRegistry(approved),
        builder=builder,
        auto_detect_cgroup=False,
    )
    components = tuple(
        AcquiredComponent(
            role=role,
            name=path.name,
            media_type=media_type,
            content_path=path,
            byte_size=path.stat().st_size,
            digest=sha256(path.read_bytes()).digest(),
        )
        for role, path, media_type in (
            ("manifest", manifest, "application/json"),
            ("main", main, "text/javascript"),
        )
    )
    result = await executor.execute(
        spec=SandboxExecutionSpec(
            job_id="obsidian-dataview-0.5.68",
            principal_id="public-source-worker",
            workspace_id="ecosystem-obsidian",
            ipc_namespace="obsidian-dataview-0.5.68",
            network_enabled=False,
            secret_mounts=(),
            writable_mounts=("/isolated/obsidian-dataview-0.5.68/output",),
            read_only_root=True,
            cpu_seconds=10,
            wall_seconds=20,
            memory_bytes=256 * 1024 * 1024,
            max_processes=2,
            max_threads=2,
            max_output_bytes=1_000_000,
            max_files=10,
            max_archive_depth=2,
            max_expanded_bytes=4_000_000,
            max_compression_ratio=10,
        ),
        adapter_artifact_digest=approved.artifact_digest,
        components=components,
    )
    payload = json.loads(result.canonical_snapshot)

    assert payload["plugin"]["id"] == "dataview"
    assert payload["plugin"]["version"] == "0.5.68"
    assert payload["artifact_digest"] == (
        "794e9eaede73920bb8d54b0eda4f5de2182d698cc638774500f24f14bcd4da0b"
    )
    assert len(payload["strings"]) == 77
    assert result.network_was_disabled is True
    assert result.secrets_were_absent is True
    assert result.workspace_was_destroyed is True
