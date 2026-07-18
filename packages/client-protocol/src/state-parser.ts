import type { ContributionState, ContributionStateReceipt, ContributionType } from "./contracts.js";
import { TERMINAL_CONTRIBUTION_STATES } from "./contracts.js";
import { protocolError } from "./errors.js";
import {
  ALL_CONTRIBUTION_STATES,
  CLAIM_STATES,
  CONTRIBUTION_TYPES,
  OBSERVATION_STATES,
  parseNullable,
  SOURCE_STATES,
  TRANSLATION_STATES,
} from "./parser-primitives.js";
import {
  exactObject,
  expectEnum,
  expectIdentifier,
  expectInteger,
  expectLiteral,
  expectTimestamp,
  expectUuid,
  parseDigest,
  parseProtocolVersion,
} from "./schema.js";

function stateSequenceFor(type: ContributionType): readonly string[] {
  if (type === "source_discovery") return SOURCE_STATES;
  if (type === "ecosystem_claim") return CLAIM_STATES;
  if (type === "explicit_translation_candidate") return TRANSLATION_STATES;
  return OBSERVATION_STATES;
}

function isTerminalState(state: string): boolean {
  return (TERMINAL_CONTRIBUTION_STATES as readonly string[]).includes(state);
}

export function assertContributionTransition(
  type: ContributionType,
  previous: ContributionState | null,
  next: ContributionState
): void {
  const sequence = stateSequenceFor(type);
  if (previous !== null && !sequence.includes(previous) && !isTerminalState(previous)) {
    protocolError(
      "CP_INVALID_STATE_TRANSITION",
      "$.expectedPreviousState",
      `${previous} is not a valid state for ${type}`
    );
  }
  if (!sequence.includes(next) && !isTerminalState(next)) {
    protocolError(
      "CP_INVALID_STATE_TRANSITION",
      "$.state",
      `${next} is not a valid state for ${type}`
    );
  }
  if (isTerminalState(previous ?? "")) {
    protocolError(
      "CP_INVALID_STATE_TRANSITION",
      "$.expectedPreviousState",
      "terminal contribution states cannot transition"
    );
  }
  if (isTerminalState(next)) return;
  const nextIndex = sequence.indexOf(next);
  const previousIndex = previous === null ? -1 : sequence.indexOf(previous);
  if (nextIndex < 0 || nextIndex !== previousIndex + 1) {
    protocolError(
      "CP_INVALID_STATE_TRANSITION",
      "$.state",
      `invalid ${type} transition from ${previous ?? "<none>"} to ${next}`
    );
  }
}

export function parseContributionStateReceipt(
  value: unknown,
  path = "$"
): ContributionStateReceipt {
  const record = exactObject(value, path, [
    "kind",
    "protocol",
    "receiptId",
    "contributionId",
    "contributionType",
    "state",
    "expectedPreviousState",
    "sequence",
    "outcome",
    "commandDigest",
    "policyRevision",
    "credentialEpoch",
    "authorityHeadDigest",
    "recordedAt",
  ]);
  expectLiteral(record.kind, "contribution_state_receipt", `${path}.kind`);
  const contributionType = expectEnum(
    record.contributionType,
    CONTRIBUTION_TYPES,
    `${path}.contributionType`
  );
  const state = expectEnum(record.state, ALL_CONTRIBUTION_STATES, `${path}.state`);
  const previous = parseNullable(record.expectedPreviousState, (item) =>
    expectEnum(item, ALL_CONTRIBUTION_STATES, `${path}.expectedPreviousState`)
  );
  const outcome = expectEnum(
    record.outcome,
    ["advanced", "terminal", "idempotent_replay"],
    `${path}.outcome`
  );
  if (outcome === "idempotent_replay") {
    if (previous !== state) {
      protocolError(
        "CP_INVALID_STATE_TRANSITION",
        `${path}.state`,
        "idempotent replay must preserve the previous state"
      );
    }
  } else {
    assertContributionTransition(contributionType, previous, state);
    if ((outcome === "terminal") !== isTerminalState(state)) {
      protocolError(
        "CP_INVALID_STATE_TRANSITION",
        `${path}.outcome`,
        "terminal outcome and terminal state must agree"
      );
    }
  }
  return {
    kind: "contribution_state_receipt",
    protocol: parseProtocolVersion(record.protocol, `${path}.protocol`),
    receiptId: expectUuid(record.receiptId, `${path}.receiptId`),
    contributionId: expectUuid(record.contributionId, `${path}.contributionId`),
    contributionType,
    state,
    expectedPreviousState: previous,
    sequence: expectInteger(record.sequence, `${path}.sequence`, { minimum: 1 }),
    outcome,
    commandDigest: parseDigest(record.commandDigest, "request", `${path}.commandDigest`),
    policyRevision: expectIdentifier(record.policyRevision, `${path}.policyRevision`),
    credentialEpoch: expectInteger(record.credentialEpoch, `${path}.credentialEpoch`, {
      minimum: 1,
    }),
    authorityHeadDigest: parseNullable(record.authorityHeadDigest, (item) =>
      parseDigest(item, "logical_object", `${path}.authorityHeadDigest`)
    ),
    recordedAt: expectTimestamp(record.recordedAt, `${path}.recordedAt`),
  };
}
