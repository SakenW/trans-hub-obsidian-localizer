import { MAX_PENDING_TRANSLATION_QUICK_RETRIES, pendingTranslationRetryDelay } from "./plugin-selection-processing";

interface RetryEntry { context: string; attempts: number; due: number | null }

/** One bounded retry budget per plugin and its language/source context. */
export class PluginRetrySchedule {
  private readonly entries = new Map<string, RetryEntry>();

  queue(pluginId: string, context: string, now: number, serverSuggestedMs?: number): void {
    let entry = this.entries.get(pluginId);
    if (entry?.context !== context) {
      entry = { context, attempts: 0, due: null };
      this.entries.set(pluginId, entry);
    }
    if (entry.attempts >= MAX_PENDING_TRANSLATION_QUICK_RETRIES) return;
    const due = now + pendingTranslationRetryDelay(entry.attempts, serverSuggestedMs);
    // A repeated observation must not postpone an already scheduled retry.
    if (entry.due === null) entry.due = due;
  }

  nextDelay(now: number): number | undefined {
    const due = [...this.entries.values()].flatMap((entry) => entry.due === null ? [] : [entry.due]);
    return due.length === 0 ? undefined : Math.max(0, Math.min(...due) - now);
  }

  takeDue(now: number, currentContext?: (pluginId: string) => string | undefined): readonly { pluginId: string; context: string }[] {
    const result: { pluginId: string; context: string }[] = [];
    for (const [pluginId, entry] of this.entries) {
      if (entry.due === null || entry.due > now) continue;
      if (currentContext !== undefined) {
        const context = currentContext(pluginId);
        if (context === undefined) { this.entries.delete(pluginId); continue; }
        if (context !== entry.context) { this.queue(pluginId, context, now); continue; }
      }
      entry.due = null;
      entry.attempts += 1;
      result.push({ pluginId, context: entry.context });
    }
    return result;
  }

  complete(pluginId: string): void { this.entries.delete(pluginId); }
  clear(): void { this.entries.clear(); }
}
