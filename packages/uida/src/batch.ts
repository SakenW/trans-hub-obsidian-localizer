import { computeUida } from "./compute.js";
import { throwIfAborted, UidaAbortError, UidaError } from "./errors.js";
import type {
  BatchUidaOptions,
  UidaIndexedResult,
  UidaInput,
  UidaResult,
} from "./types.js";

const DEFAULT_CONCURRENCY = 32;
const MAX_CONCURRENCY = 1024;

function resolveConcurrency(value?: number): number {
  const concurrency = value ?? DEFAULT_CONCURRENCY;
  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > MAX_CONCURRENCY
  ) {
    throw new UidaError(
      "UIDA_INVALID_CONCURRENCY",
      `Concurrency must be an integer between 1 and ${MAX_CONCURRENCY}`,
    );
  }
  return concurrency;
}

async function* toAsyncIterable(
  inputs: Iterable<UidaInput> | AsyncIterable<UidaInput>,
) {
  for await (const input of inputs) yield input;
}

export async function* iterateUida(
  inputs: Iterable<UidaInput> | AsyncIterable<UidaInput>,
  options: BatchUidaOptions = {},
): AsyncIterable<UidaIndexedResult> {
  throwIfAborted(options.signal);
  const concurrency = resolveConcurrency(options.concurrency);
  const iterator = toAsyncIterable(inputs)[Symbol.asyncIterator]();
  let index = 0;

  while (true) {
    const window: { readonly index: number; readonly input: UidaInput }[] = [];
    while (window.length < concurrency) {
      throwIfAborted(options.signal);
      const next = await iterator.next();
      if (next.done) break;
      window.push({ index, input: next.value });
      index += 1;
    }
    if (window.length === 0) return;

    const settled = await Promise.allSettled(
      window.map(({ input }) =>
        computeUida(input, {
          digestPort: options.digestPort,
          signal: options.signal,
        }),
      ),
    );
    if (options.signal?.aborted) throw new UidaAbortError();

    const firstFailure = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (firstFailure) throw firstFailure.reason;

    for (let offset = 0; offset < settled.length; offset += 1) {
      const result = settled[offset];
      const source = window[offset];
      if (result?.status !== "fulfilled" || !source) {
        throw new UidaError(
          "UIDA_INTERNAL_ERROR",
          "Batch result window became inconsistent",
        );
      }
      yield { index: source.index, result: result.value };
    }
  }
}

export async function computeUidaBatch(
  inputs: readonly UidaInput[],
  options: BatchUidaOptions = {},
): Promise<UidaResult[]> {
  const results: UidaResult[] = [];
  for await (const item of iterateUida(inputs, options))
    results.push(item.result);
  return results;
}
