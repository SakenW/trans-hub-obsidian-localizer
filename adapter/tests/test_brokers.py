from __future__ import annotations

from dataclasses import fields
from datetime import UTC, datetime
from uuid import UUID

import pytest
from brokers import (
    ObsidianBrokerContractError,
    ObsidianFetchBroker,
    ObsidianOfficialAsset,
    ObsidianPromotionBroker,
    ObsidianVerifiedAsset,
)

BUCKET = "transhub-prod-obsidian-z0-1383613930"
NOW = datetime(2026, 7, 18, 3, 30, tzinfo=UTC)


def _dataview_asset() -> ObsidianOfficialAsset:
    return ObsidianOfficialAsset(
        plugin_id="dataview",
        version="0.5.68",
        asset_name="manifest.json",
        github_asset_id=123456789,
        download_url=(
            "https://github.com/blacksmithgu/obsidian-dataview/"
            "releases/download/0.5.68/manifest.json"
        ),
        size_bytes=852,
        updated_at=datetime(2024, 2, 16, 12, 0, tzinfo=UTC),
        catalog_commit_sha="a" * 40,
    )


def test_fetch_command_comes_only_from_pinned_official_asset() -> None:
    asset = _dataview_asset()
    command = ObsidianFetchBroker(bucket=BUCKET).issue(asset, now=NOW)

    assert command.source_url == asset.download_url
    assert command.target_bucket == BUCKET
    assert command.target_key == ("quarantine/dataview/0.5.68/123456789/manifest.json")
    assert command.expected_size_bytes == 852
    assert b"obsidian_official_asset_fetch" in command.signing_frame()
    assert command.signing_frame() == command.signing_frame()


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("download_url", "https://evil.example/main.js"),
        ("download_url", "https://github.com/o/r/releases/download/v/../main.js"),
        ("plugin_id", "../dataview"),
        ("asset_name", "plugin.zip"),
        ("catalog_commit_sha", "not-a-commit"),
        ("size_bytes", 64 * 1024 * 1024 + 1),
    ],
)
def test_official_asset_rejects_client_controlled_source_escape(
    field: str, value: object
) -> None:
    asset = _dataview_asset()
    values = {item.name: getattr(asset, item.name) for item in fields(asset)}
    values[field] = value
    with pytest.raises(ObsidianBrokerContractError):
        ObsidianOfficialAsset(**values)


def test_promotion_is_byte_free_content_addressed_and_same_bucket() -> None:
    asset = _dataview_asset()
    receipt = ObsidianVerifiedAsset(
        verification_id=UUID("019b0000-0000-7000-8000-000000000001"),
        official_asset=asset,
        source_bucket=BUCKET,
        source_key=asset.quarantine_key,
        source_object_version="kodo-version-1",
        sha256_hex="b" * 64,
        verified_at=NOW,
        status="verified",
    )
    command = ObsidianPromotionBroker().issue(receipt, now=NOW)

    assert command.source_key == asset.quarantine_key
    assert command.target_bucket == command.source_bucket == BUCKET
    assert command.target_key == f"verified/sha256/{'b' * 64}/manifest.json"
    assert command.signed_manifest_key == (
        f"manifests/sha256/{'b' * 64}/verification.json"
    )
    assert "bytes" not in command.payload()
    assert "sourceUrl" not in command.payload()


def test_promotion_rejects_unverified_or_mismatched_source() -> None:
    asset = _dataview_asset()
    with pytest.raises(ObsidianBrokerContractError, match="asset_not_verified"):
        ObsidianVerifiedAsset(
            verification_id=UUID("019b0000-0000-7000-8000-000000000002"),
            official_asset=asset,
            source_bucket=BUCKET,
            source_key=asset.quarantine_key,
            source_object_version="kodo-version-2",
            sha256_hex="c" * 64,
            verified_at=NOW,
            status="rejected",
        )
    with pytest.raises(ObsidianBrokerContractError, match="source_key_mismatch"):
        ObsidianVerifiedAsset(
            verification_id=UUID("019b0000-0000-7000-8000-000000000003"),
            official_asset=asset,
            source_bucket=BUCKET,
            source_key="quarantine/other/main.js",
            source_object_version="kodo-version-3",
            sha256_hex="d" * 64,
            verified_at=NOW,
            status="verified",
        )
