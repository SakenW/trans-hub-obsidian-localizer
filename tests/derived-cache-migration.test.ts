import { describe, expect, it, vi } from "vitest";

import { retireExpiredDerivedCache } from "../src/derived-cache-migration";

describe("retireExpiredDerivedCache", () => {
  it("persists the current revision only after all expired files are removed", async () => {
    const order: string[] = [];
    const retired = await retireExpiredDerivedCache({
      clearAll: vi.fn(() => { order.push("clear"); return Promise.resolve(); }),
      persistCurrentRevision: vi.fn(() => {
        order.push("persist");
        return Promise.resolve();
      }),
      reportFailure: vi.fn(),
    });

    expect(retired).toBe(true);
    expect(order).toEqual(["clear", "persist"]);
  });

  it("keeps the revision expired after deletion fails and succeeds on the next load", async () => {
    const failure = new Error("vault is read-only");
    const clearAll = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);
    const persistCurrentRevision = vi.fn().mockResolvedValue(undefined);
    const reportFailure = vi.fn();

    expect(await retireExpiredDerivedCache({
      clearAll, persistCurrentRevision, reportFailure,
    })).toBe(false);
    expect(persistCurrentRevision).not.toHaveBeenCalled();
    expect(reportFailure).toHaveBeenCalledWith(failure);

    expect(await retireExpiredDerivedCache({
      clearAll, persistCurrentRevision, reportFailure,
    })).toBe(true);
    expect(clearAll).toHaveBeenCalledTimes(2);
    expect(persistCurrentRevision).toHaveBeenCalledOnce();
  });

  it("retries when persisting the new revision fails after cleanup", async () => {
    const persistCurrentRevision = vi.fn()
      .mockRejectedValueOnce(new Error("save failed"))
      .mockResolvedValueOnce(undefined);
    const clearAll = vi.fn().mockResolvedValue(undefined);

    expect(await retireExpiredDerivedCache({
      clearAll, persistCurrentRevision, reportFailure: vi.fn(),
    })).toBe(false);
    expect(await retireExpiredDerivedCache({
      clearAll, persistCurrentRevision, reportFailure: vi.fn(),
    })).toBe(true);
    expect(clearAll).toHaveBeenCalledTimes(2);
  });
});
