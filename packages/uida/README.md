# @trans-hub/uida

Public TypeScript implementation of the Trans-Hub UIDA v1 identity protocol.

The package accepts a namespace and a strict JSON-compatible identity value, recursively normalizes
strings and object keys to Unicode NFC, serializes RFC 8785 canonical bytes, applies the version-one
binary namespace frame, and computes SHA-256 through WebCrypto or an injected `DigestPort`.

```ts
import { computeUida, verifyUida } from "@trans-hub/uida";

const input = {
  namespace: "game.lang-entry",
  identity: { file: "assets/example/lang/en_us.json", key: "block.example.stone" },
} as const;

const result = await computeUida(input);
await verifyUida(input, result.uida);
```

`UidaResult` is the only result shape and contains branded `uida`, `canonicalBytes`, `hashBytes`, and
lowercase `hashHex`. Use `computeUidaBatch` for bounded in-memory batches and `iterateUida` for
ordered streaming. Both default to 32-way concurrency and support `AbortSignal`.

The protocol rejects null, floats, unsafe integers, unsupported runtime values, unpaired Unicode
surrogates, NFC key collisions, cycles, invalid namespaces, and inputs exceeding the published
resource limits. All failures use `UidaError` with a stable `code`.

The authoritative cross-language fixtures are published in
`test-vectors/uida-v1-golden-vectors.json`.
