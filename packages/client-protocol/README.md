# @trans-hub/client-protocol

Public, ecosystem-neutral wire contracts for Trans-Hub client bootstrap,
public contribution intake, source acquisition, state receipts, and source
attestation. It also defines public upload grants, published artifact manifests,
and public download tickets with fixed audience, plane, digest, size, expiry,
credential epoch, and detached server-proof fields.

Public installation rotation is also ecosystem-neutral. A short-lived
`PublicInstallationLifecycleCommand` is signed by a platform lifecycle key and
binds the installation, principal/workspace scope, current public key, current
credential/key epochs, and the exact adjacent Core key epoch. The resulting
rotation request carries current/replacement Ed25519 proofs over one
non-circular request digest. Callers cannot select an arbitrary key handle,
skip epochs, reuse a command across scopes, or treat an unsigned lifecycle
response as server authorization. Reinstall is intentionally outside this
contract until a separately authorized recovery grant exists.

The package validates untrusted JSON fail closed. Use `parseProtocolDocument`
or a document-specific parser before treating values as protocol types. Wire
objects reject unknown fields, unsupported revisions, floating-point numbers,
unsafe integers, duplicate JSON keys, invalid UTF-8, mutable source locators,
and digest-domain mismatches.

UIDA values are referenced from `@trans-hub/uida`; language tags are
structurally normalized through `@trans-hub/language-tags` and then bound to the
versioned platform locale/variant contract. This package contains no authority
logic and grants no publish or workspace capability.

`BootstrapResponse.intakeCredential` is a short-lived, server-issued admission
credential for the `public-contribution-intake` audience. It is bound to the
installation, credential epoch and granted capability subset; the client must
also match the echoed nonce and installation key ID. It is not a workspace,
adapter, upload, publication or management credential, and exact contribution
targets remain server-resolved on every Intake transaction.

`BootstrapLinkBinding` is prepared before Web authorization and freezes the
installation public key, client nonce, client metadata and requested capability
set. A one-time linking code must be issued for that exact binding; consuming
the code with a substituted key, nonce or capability set must fail closed.

Language-neutral fixtures live under `test-vectors/`. The JSON documents, error
codes, canonical bytes, and domain-separated frames are the cross-language
contract; TypeScript, Python, and Rust consumers must reproduce them without
changing wire meaning.

Detached signatures use the exported signature-frame helpers; callers must not
sign ad hoc JSON. Raw component bytes use `computeTransportDigest`, whose
domain prefix is streamed exactly once and is independent of chunk boundaries.
