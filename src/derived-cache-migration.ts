export async function retireExpiredDerivedCache(input: {
  readonly clearAll: () => Promise<void>;
  readonly persistCurrentRevision: () => Promise<void>;
  readonly reportFailure: (error: unknown) => void;
}): Promise<boolean> {
  try {
    await input.clearAll();
    await input.persistCurrentRevision();
    return true;
  } catch (error) {
    input.reportFailure(error);
    return false;
  }
}
