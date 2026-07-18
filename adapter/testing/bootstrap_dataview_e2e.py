#!/usr/bin/env python3
"""Publish one local Obsidian plugin translation through the real export authority.

This script is intentionally local-development only.  It compiles the already
approved plugin translations into the same immutable export authority read by
the production API, while keeping the byte plane in LocalObjectStorage. It is
owned by the Obsidian adapter slice and is not a Trans-Hub Core entry point.
"""

from __future__ import annotations

import argparse
import json
import os
import struct
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID, uuid5, uuid7  # type: ignore[attr-defined]

from sqlalchemy import Connection, create_engine, text
from trans_hub_core.domain.transfer.object_storage import (
    ImmutableObjectPublishRequest,
    PublishedObject,
    translation_pack_object_key,
)
from trans_hub_core.infrastructure.object_storage.local import LocalObjectStorage
from trans_hub_core.use_cases.transfer.build_translation_pack import (
    ExportPolicyIdentity,
    TranslationPackBuilder,
    TranslationPackBuildRequest,
    TranslationPackBuildResult,
    TranslationPackItem,
)

PLUGIN_ID = "dataview"
PLUGIN_NAME = "Dataview"
PLUGIN_VERSION = "0.5.68"
PLUGIN_REPOSITORY = "blacksmithgu/obsidian-dataview"
TARGET_LOCALE = "zh-CN"
TARGET_VARIANT = "default"
SOURCE_LOCALE = "en"
STREAM_KEY = "obsidian-community-plugin:dataview:0.5.68"
NAMESPACE_KEY = "obsidian.plugin.ui-string.v1"
TRANSFER_POLICY_KEY = "obsidian-local-dev-import"
FIXTURE_NAMESPACE = UUID("019f73a1-c82e-7fd0-a400-1b34bcc43703")


@dataclass(frozen=True, slots=True)
class FixtureTranslation:
    string_key: str
    source: str
    target: str | None
    provenance_kind: str | None = None
    application: str | None = None
    native_target: str | None = None


@dataclass(frozen=True, slots=True)
class AuthorityScope:
    tenant_id: UUID
    workspace_id: UUID
    ecosystem_id: UUID
    object_id: UUID
    object_kind_id: UUID
    object_version_id: UUID
    source_stream_resource_type_id: UUID


@dataclass(frozen=True, slots=True)
class WorkbenchPolicyScope:
    review_policy_id: UUID
    review_policy_revision_id: UUID
    qa_policy_id: UUID
    qa_policy_revision_id: UUID


def configure_fixture(
    *,
    plugin_id: str,
    plugin_name: str,
    plugin_version: str,
    plugin_repository: str,
    target_locale: str,
) -> None:
    """Configure one process-local plugin coordinate for the dev publisher."""
    global PLUGIN_ID, PLUGIN_NAME, PLUGIN_VERSION, PLUGIN_REPOSITORY
    global TARGET_LOCALE, STREAM_KEY
    if not plugin_id or not plugin_name or not plugin_version or not target_locale:
        raise ValueError("obsidian_fixture_coordinate_required")
    repository_parts = plugin_repository.split("/")
    if len(repository_parts) != 2 or not all(repository_parts):
        raise ValueError("obsidian_fixture_repository_invalid")
    PLUGIN_ID = plugin_id
    PLUGIN_NAME = plugin_name
    PLUGIN_VERSION = plugin_version
    PLUGIN_REPOSITORY = plugin_repository
    TARGET_LOCALE = target_locale
    STREAM_KEY = f"obsidian-community-plugin:{plugin_id}:{plugin_version}"


def _digest(label: str) -> bytes:
    return sha256(label.encode("utf-8")).digest()


def _fixture_id(label: str) -> UUID:
    return uuid5(FIXTURE_NAMESPACE, label)


def _stream_fixture_id(source_stream_id: UUID, label: str) -> UUID:
    """Keep immutable row identities stable without colliding across streams."""
    return _fixture_id(f"{source_stream_id}:{label}")


def _uida_digest(namespace_key: str, canonical_key: bytes) -> bytes:
    namespace_bytes = namespace_key.encode("utf-8")
    framed = b"".join(
        (
            b"trans-hub-uida\x00sha256\x00",
            struct.pack(">i", len(namespace_bytes)),
            namespace_bytes,
            struct.pack(">q", len(canonical_key)),
            canonical_key,
        )
    )
    return sha256(framed).digest()


def load_translations(path: Path) -> tuple[bytes, tuple[FixtureTranslation, ...]]:
    document = json.loads(path.read_text(encoding="utf-8"))
    return load_translation_document(document)


def load_translation_document(
    document: dict[str, Any],
) -> tuple[bytes, tuple[FixtureTranslation, ...]]:
    catalog = document["state"]["pluginCatalogs"][PLUGIN_ID]
    translations = document["state"]["pluginTranslations"][PLUGIN_ID]
    if (
        catalog["pluginId"] != PLUGIN_ID
        or catalog["pluginVersion"] != PLUGIN_VERSION
        or translations["pluginId"] != PLUGIN_ID
        or translations["pluginVersion"] != PLUGIN_VERSION
        or translations["targetLocale"] != TARGET_LOCALE
    ):
        raise ValueError("obsidian_fixture_coordinate_mismatch")
    targets: dict[str, tuple[str, str, str, str | None]] = {}
    for entry in translations["entries"]:
        source = entry.get("source")
        target = entry.get("target")
        if not isinstance(source, str) or not source.strip():
            raise ValueError("obsidian_fixture_translation_invalid")
        if not isinstance(target, str) or not target.strip():
            raise ValueError("obsidian_fixture_translation_invalid")
        provenance_kind = entry.get("provenanceKind", "th-published")
        application = entry.get("application", "fill")
        native_target = entry.get("nativeTarget")
        if provenance_kind not in {
            "upstream-native",
            "th-reviewed-fill",
            "th-reviewed-correction",
            "th-automatic",
            "th-published",
        } or application not in {"fill", "correction"}:
            raise ValueError("obsidian_fixture_translation_provenance_invalid")
        if application == "correction" and (
            provenance_kind != "th-reviewed-correction"
            or not isinstance(native_target, str)
            or not native_target.strip()
        ):
            raise ValueError("obsidian_fixture_translation_correction_invalid")
        if native_target is not None and not isinstance(native_target, str):
            raise ValueError("obsidian_fixture_translation_correction_invalid")
        candidate = (target, provenance_kind, application, native_target)
        existing = targets.get(source)
        if existing is not None and existing != candidate:
            raise ValueError("obsidian_fixture_translation_conflict")
        targets[source] = candidate
    rows = tuple(
        FixtureTranslation(
            string_key=row["key"],
            source=row["source"],
            target=(targets[row["source"]][0] if row["source"] in targets else None),
            provenance_kind=(targets[row["source"]][1] if row["source"] in targets else None),
            application=(targets[row["source"]][2] if row["source"] in targets else None),
            native_target=(targets[row["source"]][3] if row["source"] in targets else None),
        )
        for row in catalog["strings"]
    )
    if not rows or len({row.string_key for row in rows}) != len(rows):
        raise ValueError("obsidian_fixture_catalog_invalid")
    if any(
        len(row.string_key) != 32
        or any(character not in "0123456789abcdef" for character in row.string_key)
        or not row.source.strip()
        or (row.target is not None and not row.target.strip())
        for row in rows
    ):
        raise ValueError("obsidian_fixture_translation_invalid")
    return bytes.fromhex(catalog["digest"]), rows


def _workbench_stream_key(source_snapshot_digest: bytes) -> str:
    """Give each immutable extraction snapshot one stable local stream."""
    return f"{STREAM_KEY}:workbench:{source_snapshot_digest.hex()[:16]}"


def _published_target(row: FixtureTranslation) -> str:
    if row.target is None:
        raise ValueError("obsidian_fixture_translation_missing")
    return row.target


def _load_scope(connection: Connection) -> AuthorityScope:
    row = (
        connection.execute(
            text("""SELECT ecosystem.tenant_id,ecosystem.workspace_id,
                      ecosystem.id AS ecosystem_id,object.id AS object_id,
                      object.object_kind_id,version.id AS object_version_id,
                      resource_type.id AS source_stream_resource_type_id
                 FROM th.ecosystems ecosystem
                 JOIN th.ecosystem_objects object
                   ON object.ecosystem_id=ecosystem.id AND object.slug=:plugin_id
                 JOIN th.ecosystem_object_versions version
                   ON version.object_id=object.id AND version.version_key=:plugin_version
                 JOIN th.resource_type_definitions resource_type
                   ON resource_type.resource_type_key='source_stream'
                WHERE ecosystem.slug='obsidian'
                  AND ecosystem.lifecycle_status='active'
                  AND object.lifecycle_status='active'
                  AND version.lifecycle_status='published'"""),
            {"plugin_id": PLUGIN_ID, "plugin_version": PLUGIN_VERSION},
        )
        .mappings()
        .one()
    )
    return AuthorityScope(**row)


def _ensure_scope(connection: Connection, *, content_digest: bytes) -> None:
    """Create the local public catalog coordinate when discovery is new.

    This is deliberately confined to the Obsidian local-development adapter.
    Production catalog creation remains governed by the generic ecosystem
    command surface.
    """
    if len(content_digest) != 32:
        raise ValueError("obsidian_fixture_content_digest_invalid")
    base = (
        connection.execute(
            text("""SELECT ecosystem.tenant_id,ecosystem.workspace_id,
                          ecosystem.id AS ecosystem_id,kind.id AS object_kind_id,
                          registry.id AS registry_id,
                          object_resource_type.id AS object_resource_type_id
                     FROM th.ecosystems ecosystem
                     JOIN th.ecosystem_object_kinds kind
                       ON kind.kind_key='plugin' AND kind.lifecycle_status='active'
                     JOIN th.ecosystem_external_registries registry
                       ON registry.registry_key='obsidian_community_plugins'
                     JOIN th.ecosystem_external_registry_revisions registry_revision
                       ON registry_revision.registry_id=registry.id
                      AND registry_revision.lifecycle_status='active'
                     JOIN th.resource_type_definitions object_resource_type
                       ON object_resource_type.resource_type_key='ecosystem_object'
                      AND object_resource_type.is_active
                    WHERE ecosystem.slug='obsidian'
                      AND ecosystem.lifecycle_status='active'
                    ORDER BY kind.version DESC,registry_revision.revision DESC LIMIT 1""")
        )
        .mappings()
        .one()
    )
    object_id = _fixture_id(f"ecosystem-object:{PLUGIN_ID}")
    version_id = _fixture_id(f"ecosystem-object-version:{PLUGIN_ID}:{PLUGIN_VERSION}")
    resolved_object_id = connection.scalar(
        text("""SELECT id FROM th.ecosystem_objects
                 WHERE tenant_id=:tenant_id AND workspace_id=:workspace_id
                   AND ecosystem_id=:ecosystem_id AND slug=:slug
                   AND lifecycle_status='active'
                 ORDER BY published_at DESC,id LIMIT 1"""),
        {**base, "slug": PLUGIN_ID},
    )
    if resolved_object_id is None:
        object_resource_id = _fixture_id(f"ecosystem-object-resource:{PLUGIN_ID}")
        connection.execute(
            text("""INSERT INTO th.securable_resources
                (id,tenant_id,workspace_id,resource_type_definition_id,resource_key)
                VALUES(:id,:tenant_id,:workspace_id,:type_id,:resource_key)"""),
            {
                **base,
                "id": object_resource_id,
                "type_id": base["object_resource_type_id"],
                "resource_key": f"ecosystem_object:{object_id}",
            },
        )
        connection.execute(
            text("""INSERT INTO th.ecosystem_objects
                (id,tenant_id,workspace_id,ecosystem_id,object_kind_id,slug,name,
                 lifecycle_status,published_at,securable_resource_id,
                 resource_type_definition_id,resource_type_key)
                VALUES(:id,:tenant_id,:workspace_id,:ecosystem_id,:object_kind_id,
                :slug,:name,'active',clock_timestamp(),:resource_id,
                :resource_type_id,'ecosystem_object')"""),
            {
                **base,
                "id": object_id,
                "slug": PLUGIN_ID,
                "name": PLUGIN_NAME,
                "resource_id": object_resource_id,
                "resource_type_id": base["object_resource_type_id"],
            },
        )
        resolved_object_id = object_id
    if resolved_object_id is None:
        raise RuntimeError("obsidian_fixture_object_missing")
    connection.execute(
        text("""INSERT INTO th.ecosystem_object_versions
            (id,tenant_id,workspace_id,ecosystem_id,object_id,object_kind_id,
             version_scheme,version_key,content_digest,lifecycle_status,published_at)
            VALUES(:id,:tenant_id,:workspace_id,:ecosystem_id,:object_id,
            :object_kind_id,'semver',:version_key,:content_digest,'published',
            clock_timestamp())
            ON CONFLICT (tenant_id,workspace_id,ecosystem_id,object_id,
                         version_scheme,version_key) DO NOTHING"""),
        {
            **base,
            "id": version_id,
            "object_id": resolved_object_id,
            "version_key": PLUGIN_VERSION,
            "content_digest": content_digest,
        },
    )
    connection.execute(
        text("""INSERT INTO th.ecosystem_external_identities
            (id,tenant_id,workspace_id,ecosystem_id,object_id,object_kind_id,
             registry_id,external_id,verified_at)
            VALUES(:id,:tenant_id,:workspace_id,:ecosystem_id,:object_id,
            :object_kind_id,:registry_id,:external_id,clock_timestamp())
            ON CONFLICT (registry_id,external_id) DO NOTHING"""),
        {
            **base,
            "id": _fixture_id(f"external-identity:{PLUGIN_REPOSITORY}"),
            "object_id": resolved_object_id,
            "external_id": PLUGIN_REPOSITORY,
        },
    )


def _existing_fixture(
    connection: Connection, scope: AuthorityScope, *, stream_key: str = STREAM_KEY
) -> dict[str, Any] | None:
    row = (
        connection.execute(
            text(
                """SELECT version.id AS source_version_id,stream.id AS source_stream_id,
                      pointer.manifest_id
                 FROM th.source_streams stream
                 JOIN th.source_versions version
                   ON version.tenant_id=stream.tenant_id
                  AND version.workspace_id=stream.workspace_id
                  AND version.stream_id=stream.id
                 LEFT JOIN th.translation_export_current_pointers pointer
                   ON pointer.tenant_id=version.tenant_id
                  AND pointer.workspace_id=version.workspace_id
                  AND pointer.source_stream_id=stream.id
                  AND pointer.source_version_id=version.id
                  AND pointer.target_locale=:target_locale
                  AND pointer.target_variant=:target_variant
                WHERE stream.tenant_id=:tenant_id
                  AND stream.workspace_id=:workspace_id
                  AND stream.stream_key=:stream_key"""
            ),
            {
                "tenant_id": scope.tenant_id,
                "workspace_id": scope.workspace_id,
                "stream_key": stream_key,
                "target_locale": TARGET_LOCALE,
                "target_variant": TARGET_VARIANT,
            },
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        return None
    if row["manifest_id"] is None:
        raise RuntimeError("obsidian_dataview_fixture_partial_state")
    return dict(row)


def _active_fixture(
    connection: Connection, scope: AuthorityScope
) -> dict[str, Any] | None:
    row = (
        connection.execute(
            text("""SELECT version.id AS source_version_id,
                          stream.id AS source_stream_id,pointer.manifest_id,
                          coverage.generation_id AS coverage_generation_id
                     FROM th.source_streams stream
                     JOIN th.source_versions version
                       ON version.tenant_id=stream.tenant_id
                      AND version.workspace_id=stream.workspace_id
                      AND version.stream_id=stream.id
                     JOIN th.translation_export_current_pointers pointer
                       ON pointer.tenant_id=version.tenant_id
                      AND pointer.workspace_id=version.workspace_id
                      AND pointer.source_stream_id=stream.id
                      AND pointer.source_version_id=version.id
                      AND pointer.target_locale=:target_locale
                      AND pointer.target_variant=:target_variant
                     JOIN th.coverage_snapshots coverage
                       ON coverage.tenant_id=version.tenant_id
                      AND coverage.workspace_id=version.workspace_id
                      AND coverage.source_stream_id=stream.id
                      AND coverage.source_version_id=version.id
                      AND coverage.target_locale=:target_locale
                      AND coverage.target_variant=:target_variant
                    WHERE stream.tenant_id=:tenant_id
                      AND stream.workspace_id=:workspace_id
                      AND stream.stream_key LIKE :stream_prefix
                      AND stream.lifecycle_status='active'
                      AND version.lifecycle_status='published'
                    ORDER BY pointer.published_at DESC LIMIT 1"""),
            {
                "tenant_id": scope.tenant_id,
                "workspace_id": scope.workspace_id,
                "stream_prefix": f"{STREAM_KEY}%",
                "target_locale": TARGET_LOCALE,
                "target_variant": TARGET_VARIANT,
            },
        )
        .mappings()
        .one_or_none()
    )
    return None if row is None else dict(row)


def _active_coverage_generation_id(
    connection: Connection, scope: AuthorityScope
) -> UUID | None:
    value = connection.scalar(
        text("""SELECT id FROM th.read_model_generations
                 WHERE tenant_id=:tenant_id AND workspace_id=:workspace_id
                   AND projection_kind='coverage' AND status='active'
                 ORDER BY generation_number DESC LIMIT 1"""),
        {"tenant_id": scope.tenant_id, "workspace_id": scope.workspace_id},
    )
    return UUID(str(value)) if value is not None else None


def _build_export(
    *,
    source_stream_id: UUID,
    source_version_id: UUID,
    rows: tuple[FixtureTranslation, ...],
) -> tuple[TranslationPackBuildRequest, TranslationPackBuildResult]:
    generation_id = uuid7()
    translated_rows = tuple(row for row in rows if row.target is not None)
    if not translated_rows:
        raise ValueError("obsidian_fixture_has_no_published_translations")
    items = tuple(
        TranslationPackItem(
            source_occurrence_id=_stream_fixture_id(
                source_stream_id, f"occurrence:{row.string_key}"
            ),
            source_unit_id=_stream_fixture_id(
                source_stream_id, f"unit:{row.string_key}"
            ),
            content_atom_id=_stream_fixture_id(
                source_stream_id, f"atom:{row.string_key}"
            ),
            occurrence_key=f"obsidian:plugin-ui:{PLUGIN_ID}:{row.string_key}",
            translation_id=_stream_fixture_id(
                source_stream_id, f"translation:{row.string_key}"
            ),
            publication_id=_stream_fixture_id(
                source_stream_id, f"publication:{row.string_key}"
            ),
            revision_id=_stream_fixture_id(
                source_stream_id, f"revision:{row.string_key}"
            ),
            revision_number=1,
            review_id=_stream_fixture_id(source_stream_id, f"review:{row.string_key}"),
            payload_id=_stream_fixture_id(
                source_stream_id, f"payload:{row.string_key}"
            ),
            payload_digest=sha256(_published_target(row).encode("utf-8")).digest(),
            target_text=_published_target(row),
            structured_content={
                "source_text": row.source,
                "delivery_provenance": {
                    "kind": row.provenance_kind or "th-published",
                    "application": row.application or "fill",
                    **(
                        {"native_target": row.native_target}
                        if row.native_target is not None
                        else {}
                    ),
                },
            },
        )
        for row in translated_rows
    )
    request = TranslationPackBuildRequest(
        generation_id=generation_id,
        generation_number=1,
        generation_digest=_digest(
            f"obsidian-{PLUGIN_ID}-{PLUGIN_VERSION}-{TARGET_LOCALE}-generation-v1"
        ),
        source_stream_id=source_stream_id,
        source_version_id=source_version_id,
        target_locale=TARGET_LOCALE,
        target_variant=TARGET_VARIANT,
        scope="public",
        delivery_policy=ExportPolicyIdentity(
            key="obsidian-public-local-dev", revision=1, digest=_digest("delivery-v1")
        ),
        license_policy=ExportPolicyIdentity(
            key="mit-upstream", revision=1, digest=_digest("mit-upstream-v1")
        ),
        target_size_bytes=4 * 1024 * 1024,
        items=items,
        item_source_version_ids=(source_version_id,) * len(items),
    )
    return request, TranslationPackBuilder().build(request)


def _workbench_row_parameters(
    *,
    scope: AuthorityScope,
    source_stream_id: UUID,
    source_version_id: UUID,
    namespace_id: UUID,
    namespace_schema_revision_id: UUID,
    content_source_id: UUID,
    transfer_policy_binding_id: UUID,
    row: FixtureTranslation,
    order_index: int,
) -> dict[str, object]:
    return {
        "tenant_id": scope.tenant_id,
        "workspace_id": scope.workspace_id,
        "stream_id": source_stream_id,
        "version_id": source_version_id,
        "namespace_id": namespace_id,
        "namespace_schema_revision_id": namespace_schema_revision_id,
        "content_source_id": content_source_id,
        "binding_id": transfer_policy_binding_id,
        "atom_id": _stream_fixture_id(source_stream_id, f"atom:{row.string_key}"),
        "unit_id": _stream_fixture_id(source_stream_id, f"unit:{row.string_key}"),
        "occurrence_id": _stream_fixture_id(
            source_stream_id, f"occurrence:{row.string_key}"
        ),
        "translation_id": _stream_fixture_id(
            source_stream_id, f"translation:{row.string_key}"
        ),
        "head_id": _stream_fixture_id(
            source_stream_id, f"translation-head:{row.string_key}"
        ),
        "canonical_key": row.string_key.encode("utf-8"),
        "uida_hash": _uida_digest(NAMESPACE_KEY, row.string_key.encode("utf-8")),
        "source_digest": sha256(row.source.encode("utf-8")).digest(),
        "source_text": row.source,
        "occurrence_key": f"obsidian:plugin-ui:{PLUGIN_ID}:{row.string_key}",
        "occurrence_digest": _digest(
            f"{PLUGIN_ID}:{PLUGIN_VERSION}:{row.string_key}:{row.source}"
        ),
        "order_index": order_index,
    }


def _seed_workbench_authority(
    connection: Connection,
    *,
    scope: AuthorityScope,
    source_snapshot_digest: bytes,
    source_stream_id: UUID,
    source_version_id: UUID,
    rows: tuple[FixtureTranslation, ...],
) -> int:
    namespace = (
        connection.execute(
            text("""SELECT namespace.id AS namespace_id,revision.id AS revision_id
                     FROM th.localization_namespaces namespace
                     JOIN th.localization_namespace_schema_revisions revision
                       ON revision.namespace_id=namespace.id
                    WHERE namespace.namespace_key=:namespace_key
                    ORDER BY revision.revision DESC LIMIT 1"""),
            {"namespace_key": NAMESPACE_KEY},
        )
        .mappings()
        .one()
    )
    namespace_id = namespace["namespace_id"]
    namespace_schema_revision_id = namespace["revision_id"]
    version_namespace_id = _stream_fixture_id(
        source_stream_id, "source-version-namespace"
    )
    content_source_id = _stream_fixture_id(source_stream_id, "content-source")
    transfer_policy_binding_id = _stream_fixture_id(
        source_stream_id, "transfer-policy-binding"
    )
    connection.execute(
        text("""INSERT INTO th.source_version_namespace_revisions
            (id,tenant_id,workspace_id,source_stream_id,source_version_id,
             namespace_id,namespace_schema_revision_id)
            VALUES(:id,:tenant_id,:workspace_id,:stream_id,:version_id,
            :namespace_id,:revision_id)
            ON CONFLICT DO NOTHING"""),
        {
            "id": version_namespace_id,
            "tenant_id": scope.tenant_id,
            "workspace_id": scope.workspace_id,
            "stream_id": source_stream_id,
            "version_id": source_version_id,
            "namespace_id": namespace_id,
            "revision_id": namespace_schema_revision_id,
        },
    )
    connection.execute(
        text("""INSERT INTO th.content_sources
            (id,tenant_id,workspace_id,source_stream_id,source_version_id,
             logical_path,source_locale,format_family,source_digest,provenance)
            VALUES(:id,:tenant_id,:workspace_id,:stream_id,:version_id,
            :logical_path,:source_locale,'javascript',:source_digest,
            CAST(:provenance AS jsonb))
            ON CONFLICT DO NOTHING"""),
        {
            "id": content_source_id,
            "tenant_id": scope.tenant_id,
            "workspace_id": scope.workspace_id,
            "stream_id": source_stream_id,
            "version_id": source_version_id,
            "logical_path": f"{PLUGIN_ID}/{PLUGIN_VERSION}/main.js",
            "source_locale": SOURCE_LOCALE,
            "source_digest": source_snapshot_digest,
            "provenance": json.dumps(
                {"adapter": "obsidian", "fixture": "local-development"},
                separators=(",", ":"),
            ),
        },
    )
    connection.execute(
        text("""INSERT INTO th.translation_transfer_policy_bindings
            (id,tenant_id,workspace_id,source_stream_id,target_locale,
             target_variant,policy_key,policy_revision,status)
            VALUES(:id,:tenant_id,:workspace_id,:stream_id,:locale,:variant,
            :policy_key,1,'active')
            ON CONFLICT DO NOTHING"""),
        {
            "id": transfer_policy_binding_id,
            "tenant_id": scope.tenant_id,
            "workspace_id": scope.workspace_id,
            "stream_id": source_stream_id,
            "locale": TARGET_LOCALE,
            "variant": TARGET_VARIANT,
            "policy_key": TRANSFER_POLICY_KEY,
        },
    )
    parameters = [
        _workbench_row_parameters(
            scope=scope,
            source_stream_id=source_stream_id,
            source_version_id=source_version_id,
            namespace_id=namespace_id,
            namespace_schema_revision_id=namespace_schema_revision_id,
            content_source_id=content_source_id,
            transfer_policy_binding_id=transfer_policy_binding_id,
            row=row,
            order_index=index,
        )
        for index, row in enumerate(rows)
    ]
    connection.execute(
        text("""INSERT INTO th.content_atoms
            (id,tenant_id,workspace_id,source_stream_id,source_locale,
             content_digest,source_text)
            VALUES(:atom_id,:tenant_id,:workspace_id,:stream_id,:source_locale,
            :source_digest,:source_text)
            ON CONFLICT DO NOTHING"""),
        [{**row, "source_locale": SOURCE_LOCALE} for row in parameters],
    )
    connection.execute(
        text("""INSERT INTO th.source_units
            (id,tenant_id,workspace_id,source_stream_id,namespace_id,
             canonical_key_bytes,uida_hash_bytes)
            VALUES(:unit_id,:tenant_id,:workspace_id,:stream_id,:namespace_id,
            :canonical_key,:uida_hash)
            ON CONFLICT DO NOTHING"""),
        parameters,
    )
    connection.execute(
        text("""INSERT INTO th.source_unit_occurrences
            (id,tenant_id,workspace_id,source_stream_id,source_version_id,
             source_unit_id,namespace_id,namespace_schema_revision_id,
             content_atom_id,content_source_id,occurrence_key,occurrence_digest,
             state,order_index,context)
            VALUES(:occurrence_id,:tenant_id,:workspace_id,:stream_id,:version_id,
            :unit_id,:namespace_id,:namespace_schema_revision_id,:atom_id,
            :content_source_id,:occurrence_key,:occurrence_digest,'active',
            :order_index,CAST(:context AS jsonb))
            ON CONFLICT DO NOTHING"""),
        [
            {
                **row,
                "context": json.dumps(
                    {"pluginId": PLUGIN_ID, "pluginVersion": PLUGIN_VERSION},
                    separators=(",", ":"),
                ),
            }
            for row in parameters
        ],
    )
    connection.execute(
        text("""INSERT INTO th.translations
            (id,tenant_id,workspace_id,source_stream_id,source_unit_id,
             content_atom_id,identity_anchor_source_version_id,
             identity_anchor_occurrence_id,target_locale,target_variant,
             transfer_policy_binding_id,transfer_policy_key,
             transfer_policy_revision,transfer_policy_status)
            VALUES(:translation_id,:tenant_id,:workspace_id,:stream_id,:unit_id,
            :atom_id,:version_id,:occurrence_id,:target_locale,:target_variant,
            :binding_id,:policy_key,1,'active')
            ON CONFLICT DO NOTHING"""),
        [
            {
                **row,
                "target_locale": TARGET_LOCALE,
                "target_variant": TARGET_VARIANT,
                "policy_key": TRANSFER_POLICY_KEY,
            }
            for row in parameters
        ],
    )
    connection.execute(
        text("""INSERT INTO th.translation_heads
            (id,tenant_id,workspace_id,translation_id,current_state,head_version)
            VALUES(:head_id,:tenant_id,:workspace_id,:translation_id,'empty',0)
            ON CONFLICT DO NOTHING"""),
        parameters,
    )
    return int(
        connection.scalar(
            text("""SELECT count(*) FROM th.translations
                    WHERE tenant_id=:tenant_id AND workspace_id=:workspace_id
                      AND source_stream_id=:stream_id
                      AND target_locale=:locale AND target_variant=:variant"""),
            {
                "tenant_id": scope.tenant_id,
                "workspace_id": scope.workspace_id,
                "stream_id": source_stream_id,
                "locale": TARGET_LOCALE,
                "variant": TARGET_VARIANT,
            },
        )
        or 0
    )


def _seed_workbench_policies(
    connection: Connection, scope: AuthorityScope
) -> WorkbenchPolicyScope:
    """Install the minimal local policies required to create Workbench items."""
    review_policy_id = _fixture_id(f"review-policy:{scope.workspace_id}")
    review_revision_id = _fixture_id(f"review-policy-revision:{scope.workspace_id}")
    qa_policy_id = _fixture_id(f"qa-policy:{scope.workspace_id}")
    qa_revision_id = _fixture_id(f"qa-policy-revision:{scope.workspace_id}")
    connection.execute(
        text("""INSERT INTO th.translation_review_policies
            (id,tenant_id,workspace_id,policy_key)
            VALUES(:id,:tenant_id,:workspace_id,'obsidian-local-review')
            ON CONFLICT DO NOTHING"""),
        {
            "id": review_policy_id,
            "tenant_id": scope.tenant_id,
            "workspace_id": scope.workspace_id,
        },
    )
    connection.execute(
        text("""INSERT INTO th.translation_review_policy_revisions
            (id,tenant_id,workspace_id,policy_id,revision,
             required_approvals,required_role_keys)
            VALUES(:id,:tenant_id,:workspace_id,:policy_id,1,1,ARRAY['reviewer'])
            ON CONFLICT DO NOTHING"""),
        {
            "id": review_revision_id,
            "tenant_id": scope.tenant_id,
            "workspace_id": scope.workspace_id,
            "policy_id": review_policy_id,
        },
    )
    connection.execute(
        text("""INSERT INTO th.translation_qa_policies
            (id,tenant_id,workspace_id,policy_key)
            VALUES(:id,:tenant_id,:workspace_id,'obsidian-local-qa')
            ON CONFLICT DO NOTHING"""),
        {
            "id": qa_policy_id,
            "tenant_id": scope.tenant_id,
            "workspace_id": scope.workspace_id,
        },
    )
    connection.execute(
        text("""INSERT INTO th.translation_qa_policy_revisions
            (id,tenant_id,workspace_id,policy_id,revision)
            VALUES(:id,:tenant_id,:workspace_id,:policy_id,1)
            ON CONFLICT DO NOTHING"""),
        {
            "id": qa_revision_id,
            "tenant_id": scope.tenant_id,
            "workspace_id": scope.workspace_id,
            "policy_id": qa_policy_id,
        },
    )
    return WorkbenchPolicyScope(
        review_policy_id=review_policy_id,
        review_policy_revision_id=review_revision_id,
        qa_policy_id=qa_policy_id,
        qa_policy_revision_id=qa_revision_id,
    )


def _seed_workbench_items(
    connection: Connection,
    *,
    scope: AuthorityScope,
    source_stream_id: UUID,
    source_version_id: UUID,
    policies: WorkbenchPolicyScope,
) -> int:
    """Create the generic workflow rows required by the shared Workbench."""
    connection.execute(
        text("""INSERT INTO th.translation_work_items(
            tenant_id,workspace_id,source_stream_id,source_version_id,
            source_occurrence_id,source_version_lifecycle_status,
            source_unit_id,content_atom_id,translation_id,translation_head_id,
            target_locale,target_variant,transfer_policy_key,
            transfer_policy_revision,review_policy_id,
            review_policy_revision_id,review_policy_revision,qa_policy_id,
            qa_policy_revision_id,qa_policy_revision)
        SELECT translation.tenant_id,translation.workspace_id,
               translation.source_stream_id,occurrence.source_version_id,
               occurrence.id,'published',translation.source_unit_id,
               translation.content_atom_id,translation.id,head.id,
               translation.target_locale,translation.target_variant,
               translation.transfer_policy_key,translation.transfer_policy_revision,
               :review_policy_id,:review_revision_id,1,
               :qa_policy_id,:qa_revision_id,1
          FROM th.source_unit_occurrences occurrence
          JOIN th.translations translation
            ON translation.tenant_id=occurrence.tenant_id
           AND translation.workspace_id=occurrence.workspace_id
           AND translation.source_stream_id=occurrence.source_stream_id
           AND translation.source_unit_id=occurrence.source_unit_id
           AND translation.content_atom_id=occurrence.content_atom_id
          JOIN th.translation_heads head
            ON head.tenant_id=translation.tenant_id
           AND head.workspace_id=translation.workspace_id
           AND head.translation_id=translation.id
         WHERE occurrence.tenant_id=:tenant_id
           AND occurrence.workspace_id=:workspace_id
           AND occurrence.source_stream_id=:stream_id
           AND occurrence.source_version_id=:version_id
           AND occurrence.state='active'
        ON CONFLICT (tenant_id,workspace_id,translation_id,source_occurrence_id)
        DO NOTHING"""),
        {
            "tenant_id": scope.tenant_id,
            "workspace_id": scope.workspace_id,
            "stream_id": source_stream_id,
            "version_id": source_version_id,
            "review_policy_id": policies.review_policy_id,
            "review_revision_id": policies.review_policy_revision_id,
            "qa_policy_id": policies.qa_policy_id,
            "qa_revision_id": policies.qa_policy_revision_id,
        },
    )
    return int(
        connection.scalar(
            text("""SELECT count(*) FROM th.translation_work_items
                    WHERE tenant_id=:tenant_id AND workspace_id=:workspace_id
                      AND source_stream_id=:stream_id
                      AND source_version_id=:version_id
                      AND target_locale=:locale AND target_variant=:variant"""),
            {
                "tenant_id": scope.tenant_id,
                "workspace_id": scope.workspace_id,
                "stream_id": source_stream_id,
                "version_id": source_version_id,
                "locale": TARGET_LOCALE,
                "variant": TARGET_VARIANT,
            },
        )
        or 0
    )


def _seed_database(
    connection: Connection,
    *,
    scope: AuthorityScope,
    source_snapshot_digest: bytes,
    source_stream_id: UUID,
    source_version_id: UUID,
    request: TranslationPackBuildRequest,
    build: TranslationPackBuildResult,
    published: PublishedObject,
    catalog_rows: tuple[FixtureTranslation, ...],
    stream_key: str = STREAM_KEY,
    coverage_generation_id: UUID | None = None,
) -> tuple[UUID, UUID]:
    now = datetime.now(UTC)
    pack = build.packs[0]
    ids = {
        name: uuid7()
        for name in (
            "resource",
            "coverage_generation",
            "worker",
            "upload",
            "evidence",
            "attempt",
            "result",
            "claim",
            "replica",
            "promotion",
            "manifest",
            "pack",
            "object_ref",
            "pointer",
        )
    }
    coverage_generation_number = int(
        connection.scalar(
            text("""SELECT coalesce(max(generation_number),0)+1
                    FROM th.read_model_generations
                    WHERE tenant_id=:tenant_id AND workspace_id=:workspace_id
                      AND projection_kind='coverage'"""),
            {
                "tenant_id": scope.tenant_id,
                "workspace_id": scope.workspace_id,
            },
        )
        or 1
    )
    connection.execute(
        text("""INSERT INTO th.securable_resources
        (id,tenant_id,workspace_id,resource_type_definition_id,resource_key)
        VALUES(:id,:tenant_id,:workspace_id,:type_id,:key)"""),
        {
            "id": ids["resource"],
            "tenant_id": scope.tenant_id,
            "workspace_id": scope.workspace_id,
            "type_id": scope.source_stream_resource_type_id,
            "key": stream_key,
        },
    )
    connection.execute(
        text("""INSERT INTO th.source_streams
        (id,tenant_id,workspace_id,stream_key,securable_resource_id,
         resource_type_definition_id,resource_type_key,ecosystem_id,
         ecosystem_object_id,ecosystem_object_kind_id,lifecycle_status)
        VALUES(:id,:tenant_id,:workspace_id,:stream_key,:resource_id,:type_id,
        'source_stream',:ecosystem_id,:object_id,:object_kind_id,'active')"""),
        {
            "id": source_stream_id,
            "tenant_id": scope.tenant_id,
            "workspace_id": scope.workspace_id,
            "stream_key": stream_key,
            "resource_id": ids["resource"],
            "type_id": scope.source_stream_resource_type_id,
            "ecosystem_id": scope.ecosystem_id,
            "object_id": scope.object_id,
            "object_kind_id": scope.object_kind_id,
        },
    )
    connection.execute(
        text("""INSERT INTO th.source_versions
        (id,tenant_id,workspace_id,stream_id,stream_revision,lifecycle_status,
         source_snapshot_digest,ecosystem_id,ecosystem_object_id,
         ecosystem_object_kind_id,ecosystem_object_version_id)
        VALUES(:id,:tenant_id,:workspace_id,:stream_id,1,'finalizing',:digest,
        :ecosystem_id,:object_id,:object_kind_id,:object_version_id)"""),
        {
            "id": source_version_id,
            "tenant_id": scope.tenant_id,
            "workspace_id": scope.workspace_id,
            "stream_id": source_stream_id,
            "digest": source_snapshot_digest,
            "ecosystem_id": scope.ecosystem_id,
            "object_id": scope.object_id,
            "object_kind_id": scope.object_kind_id,
            "object_version_id": scope.object_version_id,
        },
    )
    _seed_workbench_authority(
        connection,
        scope=scope,
        source_snapshot_digest=source_snapshot_digest,
        source_stream_id=source_stream_id,
        source_version_id=source_version_id,
        rows=catalog_rows,
    )
    policies = _seed_workbench_policies(connection, scope)
    connection.execute(
        text("""UPDATE th.source_versions
                   SET lifecycle_status='published',published_at=:now
                 WHERE id=:id AND lifecycle_status='finalizing'"""),
        {"id": source_version_id, "now": now},
    )
    connection.execute(
        text("""UPDATE th.source_stream_heads
                   SET source_version_id=:version_id,
                       source_version_status='published',head_version=1
                 WHERE tenant_id=:tenant_id AND workspace_id=:workspace_id
                   AND stream_id=:stream_id AND head_version=0"""),
        {
            "tenant_id": scope.tenant_id,
            "workspace_id": scope.workspace_id,
            "stream_id": source_stream_id,
            "version_id": source_version_id,
        },
    )
    work_item_count = _seed_workbench_items(
        connection,
        scope=scope,
        source_stream_id=source_stream_id,
        source_version_id=source_version_id,
        policies=policies,
    )
    if work_item_count != len(catalog_rows):
        raise RuntimeError("obsidian_fixture_work_item_count_mismatch")
    for statement, parameters in (
        (
            """INSERT INTO th.iam_principals
         (id,tenant_id,home_workspace_id,kind,status,display_name)
         VALUES(:id,:tenant_id,:workspace_id,'service_account','active',
         'Obsidian local development verifier')""",
            {
                "id": ids["worker"],
                "tenant_id": scope.tenant_id,
                "workspace_id": scope.workspace_id,
            },
        ),
        (
            """INSERT INTO th.iam_service_accounts
         (principal_id,tenant_id,home_workspace_id,service_account_key)
         VALUES(:id,:tenant_id,:workspace_id,:key)""",
            {
                "id": ids["worker"],
                "tenant_id": scope.tenant_id,
                "workspace_id": scope.workspace_id,
                "key": f"obsidian-local-dev-{ids['worker']}",
            },
        ),
    ):
        connection.execute(text(statement), parameters)
    connection.execute(
        text("""INSERT INTO th.read_model_generations
        (id,tenant_id,workspace_id,projection_kind,generation_number,status,
         schema_revision,algorithm_key,algorithm_revision,build_parameters_digest,
         begin_command_id,begin_request_digest)
        VALUES(:id,:tenant_id,:workspace_id,'coverage',:generation_number,
        'building',1,'canonical',1,
        :digest,:begin_command,:digest)"""),
        {
            "id": ids["coverage_generation"],
            "tenant_id": scope.tenant_id,
            "workspace_id": scope.workspace_id,
            "generation_number": coverage_generation_number,
            "digest": _digest(f"coverage-v{coverage_generation_number}"),
            "begin_command": uuid7(),
        },
    )
    connection.execute(
        text("""INSERT INTO th.coverage_snapshots
        (tenant_id,workspace_id,generation_id,source_stream_id,source_version_id,
         target_locale,target_variant,total_unit_count,translated_unit_count,
         approved_unit_count,published_unit_count,missing_unit_count,
         reusable_unit_count,source_snapshot_digest,computed_at)
        VALUES(:tenant_id,:workspace_id,:generation_id,:stream_id,:version_id,
        :locale,:variant,:total_count,:published_count,:published_count,
        :published_count,:missing_count,:published_count,:digest,:now)"""),
        {
            "tenant_id": scope.tenant_id,
            "workspace_id": scope.workspace_id,
            "generation_id": ids["coverage_generation"],
            "stream_id": source_stream_id,
            "version_id": source_version_id,
            "locale": TARGET_LOCALE,
            "variant": TARGET_VARIANT,
            "total_count": len(catalog_rows),
            "published_count": len(request.items),
            "missing_count": len(catalog_rows) - len(request.items),
            "digest": source_snapshot_digest,
            "now": now,
        },
    )
    if coverage_generation_id is not None:
        connection.execute(
            text("""INSERT INTO th.coverage_snapshots
                (tenant_id,workspace_id,generation_id,source_stream_id,
                 source_version_id,target_locale,target_variant,total_unit_count,
                 translated_unit_count,approved_unit_count,published_unit_count,
                 missing_unit_count,reusable_unit_count,source_snapshot_digest,
                 computed_at)
                SELECT tenant_id,workspace_id,:new_generation_id,source_stream_id,
                       source_version_id,target_locale,target_variant,
                       total_unit_count,translated_unit_count,approved_unit_count,
                       published_unit_count,missing_unit_count,reusable_unit_count,
                       source_snapshot_digest,:now
                  FROM th.coverage_snapshots
                 WHERE generation_id=:previous_generation_id
                   AND (source_stream_id,source_version_id,target_locale,
                        target_variant)<>(:stream_id,:version_id,:locale,:variant)"""),
            {
                "new_generation_id": ids["coverage_generation"],
                "previous_generation_id": coverage_generation_id,
                "stream_id": source_stream_id,
                "version_id": source_version_id,
                "locale": TARGET_LOCALE,
                "variant": TARGET_VARIANT,
                "now": now,
            },
        )
    coverage_row_count = int(
        connection.scalar(
            text("""SELECT count(*) FROM th.coverage_snapshots
                     WHERE generation_id=:generation_id"""),
            {"generation_id": ids["coverage_generation"]},
        )
        or 0
    )
    connection.execute(
        text("""UPDATE th.read_model_generations
                   SET status='ready',ready_command_id=:ready_command,
                       ready_request_digest=:digest,
                       population_manifest_digest=:digest,build_digest=:digest,
                       row_count=:row_count,batch_count=1,ready_at=:now,
                       updated_at=:now
                 WHERE id=:id AND status='building'"""),
        {
            "id": ids["coverage_generation"],
            "ready_command": uuid7(),
            "digest": _digest(f"coverage-v{coverage_generation_number}"),
            "row_count": coverage_row_count,
            "now": now,
        },
    )
    if coverage_generation_id is not None:
        connection.execute(
            text("""UPDATE th.read_model_generations
                    SET status='retired',retired_at=:now,updated_at=:now
                    WHERE id=:id AND status='active'"""),
            {"id": coverage_generation_id, "now": now},
        )
    connection.execute(
        text("""UPDATE th.read_model_generations
                   SET status='active',activation_command_id=:activation_command,
                       activation_request_digest=:digest,activated_at=:now,
                       updated_at=:now
                 WHERE id=:id AND status='ready'"""),
        {
            "id": ids["coverage_generation"],
            "activation_command": uuid7(),
            "digest": _digest(f"coverage-v{coverage_generation_number}"),
            "now": now,
        },
    )
    license_digest = _digest(f"{PLUGIN_REPOSITORY}-mit-license")
    redistribution_digest = _digest(
        f"{PLUGIN_REPOSITORY}-{PLUGIN_VERSION}-official-release-redistribution"
    )
    connection.execute(
        text("""INSERT INTO th.transfer_public_logical_objects
    (id,logical_digest,canonical_payload_digest,logical_size,license_identifier,
     license_evidence_digest,redistribution_evidence_digest)
    VALUES(:id,:logical,:canonical,:size,'MIT',:license,:redistribution)"""),
        {
            "id": ids["object_ref"],
            "logical": pack.logical_digest,
            "canonical": pack.canonical_payload_digest,
            "size": len(pack.logical_bytes),
            "license": license_digest,
            "redistribution": redistribution_digest,
        },
    )
    quarantine_key = (
        f"quarantine/obsidian-local-dev/{PLUGIN_ID}/"
        f"{PLUGIN_VERSION}/{pack.transport_digest.hex()}"
    )
    connection.execute(
        text("""INSERT INTO th.transfer_public_upload_sessions
    (id,tenant_id,workspace_id,resource_id,logical_object_id,logical_digest,
     canonical_payload_digest,expected_transport_digest,expected_transport_size,
     upload_mode,quarantine_provider,quarantine_bucket,quarantine_object_key,
     compression_kind,policy_revision,session_identity_digest,expires_at)
    VALUES(:id,:tenant_id,:workspace_id,:resource_id,:logical_id,:logical,
    :canonical,:transport,:size,'single','local','local-quarantine',:key,'zstd',1,
    :identity,:expires)"""),
        {
            "id": ids["upload"],
            "tenant_id": scope.tenant_id,
            "workspace_id": scope.workspace_id,
            "resource_id": ids["resource"],
            "logical_id": ids["object_ref"],
            "logical": pack.logical_digest,
            "canonical": pack.canonical_payload_digest,
            "transport": pack.transport_digest,
            "size": len(pack.transport_bytes),
            "key": quarantine_key,
            "identity": _digest("upload-session-v1"),
            "expires": now + timedelta(days=1),
        },
    )
    connection.execute(
        text("""INSERT INTO th.transfer_public_provider_object_evidence
    (id,tenant_id,workspace_id,upload_session_id,logical_object_id,logical_digest,
     provider_object_version,provider_checksum_algorithm,provider_checksum_value,
     observed_transport_size,evidence_digest,observed_at)
    VALUES(:id,:tenant_id,:workspace_id,:upload_id,:logical_id,:logical,:version,
    'sha256',:checksum,:size,:evidence,:now)"""),
        {
            "id": ids["evidence"],
            "tenant_id": scope.tenant_id,
            "workspace_id": scope.workspace_id,
            "upload_id": ids["upload"],
            "logical_id": ids["object_ref"],
            "logical": pack.logical_digest,
            "version": published.provider_object_version,
            "checksum": pack.transport_digest,
            "size": len(pack.transport_bytes),
            "evidence": _digest("provider-evidence-v1"),
            "now": now,
        },
    )
    connection.execute(
        text("""INSERT INTO th.transfer_public_trusted_verification_attempts
    (id,tenant_id,workspace_id,upload_session_id,logical_object_id,logical_digest,
     provider_object_evidence_id,provider_object_version,provider_checksum_value,
     verification_method,trusted_worker_principal_id,attempt_identity_digest,started_at)
    VALUES(:id,:tenant_id,:workspace_id,:upload_id,:logical_id,:logical,:evidence_id,
    :version,:checksum,'streaming_rehash',:worker_id,:identity,:now)"""),
        {
            "id": ids["attempt"],
            "tenant_id": scope.tenant_id,
            "workspace_id": scope.workspace_id,
            "upload_id": ids["upload"],
            "logical_id": ids["object_ref"],
            "logical": pack.logical_digest,
            "evidence_id": ids["evidence"],
            "version": published.provider_object_version,
            "checksum": pack.transport_digest,
            "worker_id": ids["worker"],
            "identity": _digest("verification-attempt-v1"),
            "now": now,
        },
    )
    connection.execute(
        text("""INSERT INTO th.transfer_public_trusted_verification_results
    (id,tenant_id,workspace_id,verification_attempt_id,upload_session_id,
     logical_object_id,logical_digest,verification_outcome,verified_transport_digest,
     canonical_payload_digest,verified_logical_digest,result_evidence_digest,completed_at)
    VALUES(:id,:tenant_id,:workspace_id,:attempt_id,:upload_id,:logical_id,:logical,
    'successful',:transport,:canonical,:logical,:evidence,:now)"""),
        {
            "id": ids["result"],
            "tenant_id": scope.tenant_id,
            "workspace_id": scope.workspace_id,
            "attempt_id": ids["attempt"],
            "upload_id": ids["upload"],
            "logical_id": ids["object_ref"],
            "logical": pack.logical_digest,
            "transport": pack.transport_digest,
            "canonical": pack.canonical_payload_digest,
            "evidence": _digest("verification-result-v1"),
            "now": now,
        },
    )
    replica_fields = {
        "provider": published.provider_key,
        "bucket": published.bucket_name,
        "key": published.object_key,
        "version": published.provider_object_version,
        "logical": pack.logical_digest,
        "transport": pack.transport_digest,
        "canonical": pack.canonical_payload_digest,
        "checksum": pack.transport_digest,
        "size": len(pack.transport_bytes),
    }
    connection.execute(
        text("""INSERT INTO th.transfer_verified_physical_location_claims
    (id,security_scope,provider_key,bucket_name,object_key,provider_object_version,
     logical_digest,transport_digest,canonical_payload_digest,
     provider_checksum_algorithm,provider_checksum_value,compression_kind,
     transport_size,claim_evidence_digest)
    VALUES(:id,'public',:provider,:bucket,:key,:version,:logical,:transport,
    :canonical,'sha256',:checksum,'zstd',:size,:evidence)"""),
        {"id": ids["claim"], **replica_fields, "evidence": _digest("claim-v1")},
    )
    connection.execute(
        text("""INSERT INTO th.transfer_public_verified_replicas
    (id,physical_location_claim_id,logical_object_id,logical_digest,transport_digest,
     canonical_payload_digest,provider_key,bucket_name,object_key,
     provider_object_version,provider_checksum_algorithm,provider_checksum_value,
     compression_kind,transport_size,replica_evidence_digest)
    VALUES(:id,:claim_id,:logical_id,:logical,:transport,:canonical,:provider,:bucket,
    :key,:version,'sha256',:checksum,'zstd',:size,:evidence)"""),
        {
            "id": ids["replica"],
            "claim_id": ids["claim"],
            "logical_id": ids["object_ref"],
            **replica_fields,
            "evidence": _digest("replica-v1"),
        },
    )
    connection.execute(
        text("""INSERT INTO th.transfer_public_verified_replica_promotions
    (id,tenant_id,workspace_id,verification_result_id,logical_object_id,
     logical_digest,verified_transport_digest,canonical_payload_digest,
     verified_replica_id,provider_object_version,promotion_outcome,
     promotion_evidence_digest,promoted_at)
    VALUES(:id,:tenant_id,:workspace_id,:result_id,:logical_id,:logical,:transport,
    :canonical,:replica_id,:version,'created',:evidence,:now)"""),
        {
            "id": ids["promotion"],
            "tenant_id": scope.tenant_id,
            "workspace_id": scope.workspace_id,
            "result_id": ids["result"],
            "logical_id": ids["object_ref"],
            "logical": pack.logical_digest,
            "transport": pack.transport_digest,
            "canonical": pack.canonical_payload_digest,
            "replica_id": ids["replica"],
            "version": published.provider_object_version,
            "evidence": _digest("promotion-v1"),
            "now": now,
        },
    )
    connection.execute(
        text("""INSERT INTO th.translation_export_generations
    (id,tenant_id,workspace_id,source_stream_id,source_version_id,generation_number,
     protocol_version,generation_digest,delivery_policy_key,delivery_policy_revision,
     delivery_policy_digest,license_policy_key,license_policy_revision,
     license_policy_digest)
    VALUES(:id,:tenant_id,:workspace_id,:stream_id,:version_id,1,1,:generation_digest,
    :delivery_key,1,:delivery_digest,:license_key,1,:license_digest)"""),
        {
            "id": request.generation_id,
            "tenant_id": scope.tenant_id,
            "workspace_id": scope.workspace_id,
            "stream_id": source_stream_id,
            "version_id": source_version_id,
            "generation_digest": request.generation_digest,
            "delivery_key": request.delivery_policy.key,
            "delivery_digest": request.delivery_policy.digest,
            "license_key": request.license_policy.key,
            "license_digest": request.license_policy.digest,
        },
    )
    connection.execute(
        text("""INSERT INTO th.translation_export_locale_manifests
    (id,tenant_id,workspace_id,generation_id,generation_number,source_stream_id,
     source_version_id,target_locale,target_variant,is_public,manifest_digest,pack_count)
    VALUES(:id,:tenant_id,:workspace_id,:generation_id,1,:stream_id,:version_id,
    :locale,:variant,true,:digest,1)"""),
        {
            "id": ids["manifest"],
            "tenant_id": scope.tenant_id,
            "workspace_id": scope.workspace_id,
            "generation_id": request.generation_id,
            "stream_id": source_stream_id,
            "version_id": source_version_id,
            "locale": TARGET_LOCALE,
            "variant": TARGET_VARIANT,
            "digest": build.manifest_digest,
        },
    )
    connection.execute(
        text("""INSERT INTO th.translation_export_packs
    (id,tenant_id,workspace_id,generation_id,generation_number,manifest_id,
     source_stream_id,source_version_id,target_locale,target_variant,pack_index,
     item_count,canonical_payload_size,pack_logical_digest)
    VALUES(:id,:tenant_id,:workspace_id,:generation_id,1,:manifest_id,:stream_id,
    :version_id,:locale,:variant,0,:items,:size,:logical)"""),
        {
            "id": ids["pack"],
            "tenant_id": scope.tenant_id,
            "workspace_id": scope.workspace_id,
            "generation_id": request.generation_id,
            "manifest_id": ids["manifest"],
            "stream_id": source_stream_id,
            "version_id": source_version_id,
            "locale": TARGET_LOCALE,
            "variant": TARGET_VARIANT,
            "items": pack.item_count,
            "size": len(pack.canonical_bytes),
            "logical": pack.logical_digest,
        },
    )
    connection.execute(
        text("""INSERT INTO th.translation_export_public_object_refs
    (id,tenant_id,workspace_id,generation_id,generation_number,manifest_id,pack_id,
     source_stream_id,source_version_id,target_locale,target_variant,pack_index,
     logical_object_id,verified_replica_id,logical_object_digest,transport_digest,
     canonical_payload_digest,provider_object_version)
    VALUES(:id,:tenant_id,:workspace_id,:generation_id,1,:manifest_id,:pack_id,
    :stream_id,:version_id,:locale,:variant,0,:logical_id,:replica_id,:logical,
    :transport,:canonical,:provider_version)"""),
        {
            "id": uuid7(),
            "tenant_id": scope.tenant_id,
            "workspace_id": scope.workspace_id,
            "generation_id": request.generation_id,
            "manifest_id": ids["manifest"],
            "pack_id": ids["pack"],
            "stream_id": source_stream_id,
            "version_id": source_version_id,
            "locale": TARGET_LOCALE,
            "variant": TARGET_VARIANT,
            "logical_id": ids["object_ref"],
            "replica_id": ids["replica"],
            "logical": pack.logical_digest,
            "transport": pack.transport_digest,
            "canonical": pack.canonical_payload_digest,
            "provider_version": published.provider_object_version,
        },
    )
    connection.execute(
        text("""INSERT INTO th.translation_export_current_pointers
    (id,tenant_id,workspace_id,source_stream_id,source_version_id,target_locale,
     target_variant,is_public,generation_id,generation_number,manifest_id,
     pointer_version,published_at)
    VALUES(:id,:tenant_id,:workspace_id,:stream_id,:version_id,:locale,:variant,true,
    :generation_id,1,:manifest_id,0,:now)"""),
        {
            "id": ids["pointer"],
            "tenant_id": scope.tenant_id,
            "workspace_id": scope.workspace_id,
            "stream_id": source_stream_id,
            "version_id": source_version_id,
            "locale": TARGET_LOCALE,
            "variant": TARGET_VARIANT,
            "generation_id": request.generation_id,
            "manifest_id": ids["manifest"],
            "now": now,
        },
    )
    connection.exec_driver_sql(
        "REFRESH MATERIALIZED VIEW th.mv_public_ecosystem_directory"
    )
    return ids["manifest"], ids["pack"]


def _retire_incomplete_fixture(
    connection: Connection, *, source_stream_id: UUID, source_version_id: UUID
) -> None:
    connection.execute(
        text("""UPDATE th.source_stream_heads
                  SET source_version_id=NULL,source_version_status=NULL,
                      head_version=head_version+1
                WHERE stream_id=:stream_id AND source_version_id=:version_id"""),
        {"stream_id": source_stream_id, "version_id": source_version_id},
    )
    # Work items intentionally retain an exact FK to the published source
    # version. Retire only the stream from the public current set; keeping the
    # immutable version published preserves that historical workflow evidence.
    connection.execute(
        text("""UPDATE th.source_streams SET lifecycle_status='archived'
                WHERE id=:stream_id AND lifecycle_status='active'"""),
        {"stream_id": source_stream_id},
    )


def validate_local_runtime(
    *, allow_local_dev_data: bool, origin: str, storage_root: Path
) -> None:
    if not allow_local_dev_data:
        raise ValueError("allow_local_dev_data_required")
    parsed_origin = urlsplit(origin)
    if (
        parsed_origin.scheme != "http"
        or parsed_origin.hostname not in {"127.0.0.1", "localhost"}
        or parsed_origin.username is not None
        or parsed_origin.password is not None
    ):
        raise ValueError("local_loopback_object_storage_origin_required")
    if not storage_root.is_absolute():
        raise ValueError("local_storage_root_must_be_absolute")


def publish_translation_document(
    document: dict[str, Any],
    *,
    dsn: str,
    storage_root: Path,
    origin: str,
) -> dict[str, object]:
    source_snapshot_digest, rows = load_translation_document(document)
    stream_key = _workbench_stream_key(source_snapshot_digest)
    translated_count = sum(row.target is not None for row in rows)
    engine = create_engine(
        dsn.replace("postgresql+asyncpg://", "postgresql+psycopg://", 1)
    )
    with engine.begin() as connection:
        _ensure_scope(connection, content_digest=source_snapshot_digest)
        scope = _load_scope(connection)
        existing = _existing_fixture(connection, scope, stream_key=stream_key)
        previous = _active_fixture(connection, scope)
        active_coverage_generation_id = _active_coverage_generation_id(
            connection, scope
        )
        if existing is None:
            source_stream_id, source_version_id = uuid7(), uuid7()
        else:
            source_stream_id = UUID(str(existing["source_stream_id"]))
            source_version_id = UUID(str(existing["source_version_id"]))
    request, build = _build_export(
        source_stream_id=source_stream_id,
        source_version_id=source_version_id,
        rows=rows,
    )
    if len(build.packs) != 1:
        raise RuntimeError("obsidian_fixture_expected_single_pack")
    pack = build.packs[0]
    storage = LocalObjectStorage(root=storage_root, origin=origin)
    object_key = translation_pack_object_key(
        scope="public", transport_digest=pack.transport_digest
    )
    published = storage.publish_insert_only(
        ImmutableObjectPublishRequest(
            scope="public",
            tenant_id=None,
            workspace_id=None,
            object_key=object_key,
            transport_bytes=pack.transport_bytes,
            transport_digest=pack.transport_digest,
            canonical_payload_digest=pack.canonical_payload_digest,
            logical_digest=pack.logical_digest,
            content_type="application/zstd",
        )
    )
    if existing is not None:
        with engine.begin() as connection:
            scope = _load_scope(connection)
            policies = _seed_workbench_policies(connection, scope)
            work_item_count = _seed_workbench_items(
                connection,
                scope=scope,
                source_stream_id=source_stream_id,
                source_version_id=source_version_id,
                policies=policies,
            )
        return {
            "status": "existing",
            **existing,
            "translation_count": translated_count,
            "catalog_count": len(rows),
            "work_item_count": work_item_count,
            "object_created": published.created,
        }
    with engine.begin() as connection:
        scope = _load_scope(connection)
        manifest_id, pack_id = _seed_database(
            connection,
            scope=scope,
            source_snapshot_digest=source_snapshot_digest,
            source_stream_id=source_stream_id,
            source_version_id=source_version_id,
            request=request,
            build=build,
            published=published,
            catalog_rows=rows,
            stream_key=stream_key,
            coverage_generation_id=active_coverage_generation_id,
        )
        if previous is not None:
            _retire_incomplete_fixture(
                connection,
                source_stream_id=UUID(str(previous["source_stream_id"])),
                source_version_id=UUID(str(previous["source_version_id"])),
            )
    return {
        "status": "created",
        "workspace_id": scope.workspace_id,
        "source_stream_id": source_stream_id,
        "source_version_id": source_version_id,
        "manifest_id": manifest_id,
        "pack_id": pack_id,
        "translation_count": translated_count,
        "catalog_count": len(rows),
        "work_item_count": len(rows),
        "object_created": published.created,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--allow-local-dev-data", action="store_true")
    parser.add_argument("--plugin-data", type=Path, required=True)
    parser.add_argument("--plugin-id", default=PLUGIN_ID)
    parser.add_argument("--storage-root", type=Path, required=True)
    parser.add_argument("--origin", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    try:
        validate_local_runtime(
            allow_local_dev_data=args.allow_local_dev_data,
            origin=args.origin,
            storage_root=args.storage_root,
        )
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise SystemExit("DATABASE_URL is required")
    document = json.loads(args.plugin_data.read_text(encoding="utf-8"))
    state = document["state"]
    catalog = state["pluginCatalogs"][args.plugin_id]
    translation = state["pluginTranslations"][args.plugin_id]
    submission = state.get("pluginSubmissions", {}).get(args.plugin_id, {})
    repository = submission.get("repository")
    if not isinstance(repository, str) or not repository:
        if args.plugin_id != "dataview":
            raise SystemExit("plugin repository is required in pluginSubmissions")
        repository = PLUGIN_REPOSITORY
    configure_fixture(
        plugin_id=args.plugin_id,
        plugin_name=str(catalog.get("pluginName") or args.plugin_id),
        plugin_version=str(catalog["pluginVersion"]),
        plugin_repository=repository,
        target_locale=str(translation["targetLocale"]),
    )
    result = publish_translation_document(
        document,
        dsn=dsn,
        storage_root=args.storage_root,
        origin=args.origin,
    )
    print(result)


if __name__ == "__main__":
    main()
