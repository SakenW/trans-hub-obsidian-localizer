/** Match the public MT quarantine shape before cached or downloaded text reaches the UI. */
export function suspiciousMachineTarget(source: string, target: string): boolean {
  if (target.includes("\uFFFD")) return true;
  if (source.trim().toLowerCase() === target.trim().toLowerCase()
    || !/^[a-z0-9]{16,}$/u.test(target)) return false;
  const letters = target.replace(/[0-9]/gu, "");
  const digits = target.length - letters.length;
  if (letters.length < 8) return false;
  if (digits >= 2) return true;
  const vowels = letters.replace(/[^aeiou]/gu, "").length / letters.length;
  if (digits === 1) return vowels < 0.3 && /[bcdfghjklmnpqrstvwxyz]{5,}/u.test(letters);
  return target.length >= 20 && vowels <= 0.2
    && /[bcdfghjklmnpqrstvwxyz]{5,}/u.test(letters);
}

/** A package with widespread corrupted MT is unfit even if a few rows look normal. */
export function contaminatedMachineBatch(
  entries: readonly { readonly source: string; readonly target: string; readonly provenanceKind?: string }[],
): boolean {
  const suspicious = entries.filter((entry) => entry.provenanceKind === "th-automatic"
    && suspiciousMachineTarget(entry.source, entry.target)).length;
  return suspicious >= 3 && suspicious * 2 > entries.length;
}
