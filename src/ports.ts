/**
 * What privacy needs from the platform and the modules. In-process the
 * platform wires the real functions; over HTTP see `server/remote-ports.ts`.
 */

export type AccountRow = { id: string; authUid: string; status: string; platformRole: string };
export type AuthDeleteResult = "deleted" | "missing" | "failed";

export type AuditEntry = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  diff?: unknown;
  ip?: string | null;
};

export type PrivacyPorts = {
  /** auth: the account row and its login (Supabase Auth). */
  account: {
    find: (userId: string) => Promise<AccountRow | null>;
    /**
     * Marks the account deleted and clears its personal fields; false when it
     * already was. Runs inside the deletion transaction (`tx` in-process).
     */
    markDeleted: (userId: string, now: Date, tx?: unknown) => Promise<boolean>;
    /** Deleted accounts in the retry window (their login may still exist). */
    recentlyDeleted: (since: Date) => Promise<{ userId: string; authUid: string }[]>;
    loginEmail: (authUid: string) => Promise<string | null>;
    deleteLogin: (authUid: string) => Promise<AuthDeleteResult>;
  };
  /** platform: audit log and rate limits (throws a 429 HttpError). */
  audit: (entry: AuditEntry) => Promise<void>;
  rateLimit: (bucket: string, subject: string, now: Date) => Promise<void>;
};

let ports: PrivacyPorts | null = null;

export function setPrivacyPorts(next: PrivacyPorts): void {
  ports = next;
}

export function privacyPorts(): PrivacyPorts {
  if (!ports) throw new Error("privacy ports are not configured");
  return ports;
}
