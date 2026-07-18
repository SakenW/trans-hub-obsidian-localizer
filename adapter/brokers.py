"""Byte-free Broker commands owned by the dedicated Obsidian adapter slice."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Final, Literal, Mapping
from urllib.parse import unquote, urlsplit
from uuid import UUID, uuid5

COMMAND_NAMESPACE: Final = UUID("f0956cd0-78a6-5ed4-9f6a-e6715c155ff1")
COMMAND_TTL: Final = timedelta(minutes=5)
ALLOWED_ASSET_NAMES: Final = frozenset({"manifest.json", "main.js", "styles.css"})
MAX_ASSET_BYTES: Final = 64 * 1024 * 1024
PLUGIN_ID_PATTERN: Final = re.compile(r"^[a-z0-9][a-z0-9-]{0,127}$")
VERSION_PATTERN: Final = re.compile(r"^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$")
SHA256_PATTERN: Final = re.compile(r"^[0-9a-f]{64}$")
COMMIT_PATTERN: Final = re.compile(r"^[0-9a-f]{40}$")


class ObsidianBrokerContractError(ValueError):
    """A command attempted to escape the server-pinned Obsidian authority."""


def _require_utc(value: datetime, field: str) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ObsidianBrokerContractError(f"{field}_must_be_timezone_aware")


def _validate_segment(value: str, pattern: re.Pattern[str], field: str) -> None:
    if not pattern.fullmatch(value) or ".." in value or "/" in value:
        raise ObsidianBrokerContractError(f"{field}_invalid")


def _validate_github_release_url(value: str, asset_name: str) -> None:
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or parsed.hostname != "github.com"
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port is not None
        or parsed.query
        or parsed.fragment
    ):
        raise ObsidianBrokerContractError("official_asset_url_invalid")
    segments = [unquote(segment) for segment in parsed.path.split("/") if segment]
    if (
        len(segments) < 6
        or segments[2:4] != ["releases", "download"]
        or segments[-1] != asset_name
        or any(segment in {".", ".."} for segment in segments)
    ):
        raise ObsidianBrokerContractError("official_asset_release_path_invalid")


def _canonical_json(value: Mapping[str, object]) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode()


@dataclass(frozen=True, slots=True)
class ObsidianOfficialAsset:
    """One asset resolved from the server-owned, commit-pinned official catalog."""

    plugin_id: str
    version: str
    asset_name: Literal["manifest.json", "main.js", "styles.css"]
    github_asset_id: int
    download_url: str
    size_bytes: int
    updated_at: datetime
    catalog_commit_sha: str

    def __post_init__(self) -> None:
        _validate_segment(self.plugin_id, PLUGIN_ID_PATTERN, "plugin_id")
        _validate_segment(self.version, VERSION_PATTERN, "version")
        if self.asset_name not in ALLOWED_ASSET_NAMES:
            raise ObsidianBrokerContractError("official_asset_name_invalid")
        if self.github_asset_id <= 0:
            raise ObsidianBrokerContractError("github_asset_id_invalid")
        if not 0 < self.size_bytes <= MAX_ASSET_BYTES:
            raise ObsidianBrokerContractError("official_asset_size_invalid")
        _require_utc(self.updated_at, "official_asset_updated_at")
        if not COMMIT_PATTERN.fullmatch(self.catalog_commit_sha):
            raise ObsidianBrokerContractError("catalog_commit_sha_invalid")
        _validate_github_release_url(self.download_url, self.asset_name)

    @property
    def quarantine_key(self) -> str:
        return (
            f"quarantine/{self.plugin_id}/{self.version}/"
            f"{self.github_asset_id}/{self.asset_name}"
        )

    @property
    def identity(self) -> str:
        return (
            f"{self.catalog_commit_sha}:{self.plugin_id}:{self.version}:"
            f"{self.github_asset_id}:{self.asset_name}:{self.size_bytes}:"
            f"{self.updated_at.astimezone(UTC).isoformat()}"
        )


@dataclass(frozen=True, slots=True)
class ObsidianFetchCommand:
    command_id: UUID
    source_url: str
    target_bucket: str
    target_key: str
    expected_size_bytes: int
    catalog_commit_sha: str
    github_asset_id: int
    issued_at: datetime
    expires_at: datetime

    def __post_init__(self) -> None:
        _require_utc(self.issued_at, "fetch_issued_at")
        _require_utc(self.expires_at, "fetch_expires_at")
        if self.expires_at <= self.issued_at:
            raise ObsidianBrokerContractError("fetch_expiry_invalid")
        if not self.target_key.startswith("quarantine/") or ".." in self.target_key:
            raise ObsidianBrokerContractError("fetch_target_key_invalid")
        if not self.target_bucket:
            raise ObsidianBrokerContractError("fetch_target_bucket_invalid")

    def payload(self) -> dict[str, object]:
        return {
            "kind": "obsidian_official_asset_fetch",
            "commandId": str(self.command_id),
            "sourceUrl": self.source_url,
            "targetBucket": self.target_bucket,
            "targetKey": self.target_key,
            "expectedSizeBytes": self.expected_size_bytes,
            "catalogCommitSha": self.catalog_commit_sha,
            "githubAssetId": self.github_asset_id,
            "issuedAt": self.issued_at.astimezone(UTC).isoformat(),
            "expiresAt": self.expires_at.astimezone(UTC).isoformat(),
        }

    def signing_frame(self) -> bytes:
        return _canonical_json(self.payload())


class ObsidianFetchBroker:
    """Issue a QVM command only from a trusted official-catalog asset object."""

    def __init__(self, *, bucket: str) -> None:
        if not bucket:
            raise ObsidianBrokerContractError("fetch_bucket_invalid")
        self._bucket = bucket

    def issue(
        self, asset: ObsidianOfficialAsset, *, now: datetime
    ) -> ObsidianFetchCommand:
        _require_utc(now, "fetch_now")
        command_id = uuid5(COMMAND_NAMESPACE, f"fetch:{asset.identity}")
        return ObsidianFetchCommand(
            command_id=command_id,
            source_url=asset.download_url,
            target_bucket=self._bucket,
            target_key=asset.quarantine_key,
            expected_size_bytes=asset.size_bytes,
            catalog_commit_sha=asset.catalog_commit_sha,
            github_asset_id=asset.github_asset_id,
            issued_at=now,
            expires_at=now + COMMAND_TTL,
        )


@dataclass(frozen=True, slots=True)
class ObsidianVerifiedAsset:
    """Database-backed verifier receipt eligible for server-side promotion."""

    verification_id: UUID
    official_asset: ObsidianOfficialAsset
    source_bucket: str
    source_key: str
    source_object_version: str
    sha256_hex: str
    verified_at: datetime
    status: Literal["verified", "rejected"]

    def __post_init__(self) -> None:
        if self.source_key != self.official_asset.quarantine_key:
            raise ObsidianBrokerContractError("verified_source_key_mismatch")
        if not self.source_bucket:
            raise ObsidianBrokerContractError("verified_source_bucket_invalid")
        if not self.source_object_version:
            raise ObsidianBrokerContractError("verified_source_version_missing")
        if not SHA256_PATTERN.fullmatch(self.sha256_hex):
            raise ObsidianBrokerContractError("verified_sha256_invalid")
        _require_utc(self.verified_at, "verified_at")
        if self.status != "verified":
            raise ObsidianBrokerContractError("asset_not_verified")

    @property
    def verified_key(self) -> str:
        return f"verified/sha256/{self.sha256_hex}/{self.official_asset.asset_name}"

    @property
    def manifest_key(self) -> str:
        return f"manifests/sha256/{self.sha256_hex}/verification.json"


@dataclass(frozen=True, slots=True)
class ObsidianPromotionCommand:
    command_id: UUID
    source_bucket: str
    source_key: str
    source_object_version: str
    target_bucket: str
    target_key: str
    verification_id: UUID
    sha256_hex: str
    signed_manifest_key: str
    issued_at: datetime
    expires_at: datetime

    def __post_init__(self) -> None:
        _require_utc(self.issued_at, "promotion_issued_at")
        _require_utc(self.expires_at, "promotion_expires_at")
        if self.expires_at <= self.issued_at:
            raise ObsidianBrokerContractError("promotion_expiry_invalid")
        if not self.source_key.startswith("quarantine/") or ".." in self.source_key:
            raise ObsidianBrokerContractError("promotion_source_key_invalid")
        if (
            not self.target_key.startswith("verified/sha256/")
            or ".." in self.target_key
        ):
            raise ObsidianBrokerContractError("promotion_target_key_invalid")
        if not self.signed_manifest_key.startswith("manifests/sha256/"):
            raise ObsidianBrokerContractError("promotion_manifest_key_invalid")
        if self.source_bucket != self.target_bucket:
            raise ObsidianBrokerContractError("promotion_cross_bucket_forbidden")

    def payload(self) -> dict[str, object]:
        return {
            "kind": "obsidian_verified_asset_promotion",
            "commandId": str(self.command_id),
            "sourceBucket": self.source_bucket,
            "sourceKey": self.source_key,
            "sourceObjectVersion": self.source_object_version,
            "targetBucket": self.target_bucket,
            "targetKey": self.target_key,
            "verificationId": str(self.verification_id),
            "sha256": self.sha256_hex,
            "signedManifestKey": self.signed_manifest_key,
            "issuedAt": self.issued_at.astimezone(UTC).isoformat(),
            "expiresAt": self.expires_at.astimezone(UTC).isoformat(),
        }

    def signing_frame(self) -> bytes:
        return _canonical_json(self.payload())


class ObsidianPromotionBroker:
    """Issue byte-free Copy commands from accepted verifier receipts only."""

    def issue(
        self, receipt: ObsidianVerifiedAsset, *, now: datetime
    ) -> ObsidianPromotionCommand:
        _require_utc(now, "promotion_now")
        identity = (
            f"promote:{receipt.verification_id}:{receipt.source_object_version}:"
            f"{receipt.sha256_hex}"
        )
        return ObsidianPromotionCommand(
            command_id=uuid5(COMMAND_NAMESPACE, identity),
            source_bucket=receipt.source_bucket,
            source_key=receipt.source_key,
            source_object_version=receipt.source_object_version,
            target_bucket=receipt.source_bucket,
            target_key=receipt.verified_key,
            verification_id=receipt.verification_id,
            sha256_hex=receipt.sha256_hex,
            signed_manifest_key=receipt.manifest_key,
            issued_at=now,
            expires_at=now + COMMAND_TTL,
        )


__all__ = [
    "ObsidianBrokerContractError",
    "ObsidianFetchBroker",
    "ObsidianFetchCommand",
    "ObsidianOfficialAsset",
    "ObsidianPromotionBroker",
    "ObsidianPromotionCommand",
    "ObsidianVerifiedAsset",
]
