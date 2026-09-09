import { describe, expect, it } from "vitest";
import { PluginRetrySchedule } from "../src/plugin-retry-schedule";
import { MAX_PENDING_TRANSLATION_QUICK_RETRIES } from "../src/plugin-selection-processing";

describe("per-plugin retry schedule", () => {
  it("requeues the current task when a status refresh supersedes the queued context", () => {
    const retries = new PluginRetrySchedule();
    let current = "zh:task-1";
    retries.queue("one", current, 0);
    retries.queue("other", "zh:stable", 0, 45000);
    current = "zh:task-2:published";
    const resolve = (id: string) => id === "one" ? current : "zh:stable";
    expect(retries.takeDue(5000, resolve)).toEqual([]);
    expect(retries.nextDelay(5000)).toBe(5000);
    expect(retries.takeDue(10000, resolve)).toEqual([{ pluginId: "one", context: current }]);
    expect(retries.nextDelay(10000)).toBe(35000);
  });
  it("drops a disabled plugin without scheduling replacement work", () => {
    const retries = new PluginRetrySchedule();
    retries.queue("one", "zh:source", 0);
    expect(retries.takeDue(5000, () => undefined)).toEqual([]);
    expect(retries.nextDelay(5000)).toBeUndefined();
  });
  it("an exhausted plugin does not consume the next plugin's budget", () => {
    const retries = new PluginRetrySchedule(); let now = 0;
    for (let i = 0; i < MAX_PENDING_TRANSLATION_QUICK_RETRIES; i += 1) {
      retries.queue("old", "zh:source", now);
      now += retries.nextDelay(now)!;
      expect(retries.takeDue(now).map((entry) => entry.pluginId)).toEqual(["old"]);
    }
    retries.queue("old", "zh:source", now);
    expect(retries.nextDelay(now)).toBeUndefined();
    retries.queue("new", "zh:source", now);
    expect(retries.nextDelay(now)).toBe(5000);
    expect(retries.takeDue(now + 5000).map((entry) => entry.pluginId)).toEqual(["new"]);
  });
  it("only dispatches due plugins while preserving later server delays", () => {
    const retries = new PluginRetrySchedule();
    retries.queue("slow", "zh:source", 0, 45000);
    retries.queue("fresh", "zh:source", 1000);
    expect(retries.nextDelay(1000)).toBe(5000);
    expect(retries.takeDue(6000).map((entry) => entry.pluginId)).toEqual(["fresh"]);
    expect(retries.nextDelay(6000)).toBe(39000);
  });
  it("a changed language/source starts a new budget without resetting other plugins", () => {
    const retries = new PluginRetrySchedule();
    retries.queue("one", "zh:old", 0); retries.takeDue(5000);
    retries.queue("two", "zh:old", 5000, 45000);
    retries.queue("one", "ja:new", 5000);
    expect(retries.takeDue(10000)).toEqual([{ pluginId: "one", context: "ja:new" }]);
    retries.complete("one");
    expect(retries.nextDelay(10000)).toBe(40000);
    retries.clear(); expect(retries.nextDelay(10000)).toBeUndefined();
  });
  it("repeated observations do not postpone pending retries", () => {
    const retries = new PluginRetrySchedule();
    retries.queue("one", "zh:source", 0);
    retries.queue("one", "zh:source", 4000);
    expect(retries.nextDelay(4000)).toBe(1000);
  });
});
