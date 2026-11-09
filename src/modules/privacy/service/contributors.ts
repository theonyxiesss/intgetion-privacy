/**
 * Section 17 across modules: every module that keeps personal data adds its
 * slice of the export, the account deletion and the retention here. Privacy
 * runs them; it never reads or writes another module's tables itself.
 */

export type DeletionContext = {
  now: Date;
  /**
   * The deletion transaction for in-process contributors: the account row and
   * every in-process slice commit together, as on the platform (D28).
   */
  tx: unknown;
};

export type PrivacyContributor = {
  /** Module name, unique, for logs and the retry. */
  name: string;
  /**
   * In-process contributors run inside the deletion transaction. Remote ones
   * (another service) run after it commits and are retried by retention for
   * recently deleted accounts, so their deletion must be idempotent.
   */
  mode: "in-process" | "remote";
  /** Keys merged into the export document (section 17 format, D165). */
  exportFor?: (userId: string) => Promise<Record<string, unknown>>;
  /** Removes or anonymises the person's data; counts go to the audit row. */
  anonymize?: (userId: string, ctx: DeletionContext) => Promise<Record<string, number> | void>;
  /** Retention; each count is the number of rows removed or wiped. */
  purge?: (now: Date) => Promise<Record<string, number>>;
};

let contributors: PrivacyContributor[] = [];

/** The platform registers the module slices at start. Names must be unique. */
export function registerPrivacyContributors(list: readonly PrivacyContributor[]): void {
  const names = new Set(contributors.map((c) => c.name));
  for (const c of list) {
    if (names.has(c.name)) throw new Error(`privacy contributor ${c.name} is already registered`);
    names.add(c.name);
  }
  contributors = [...contributors, ...list];
}

export function privacyContributors(): readonly PrivacyContributor[] {
  return contributors;
}

/** For tests. */
export function resetPrivacyContributorsForTests(): void {
  contributors = [];
}
