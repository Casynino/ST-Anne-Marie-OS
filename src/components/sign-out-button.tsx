"use client";

import type { ReactNode } from "react";
import { clearDownloadedSheets } from "@/lib/offline/store";
import { clearOfflinePageCache } from "@/components/attendance/sw-register";

/** Sign-out that also removes downloaded class lists (personal data) from this device. Unsynced attendance stays queued. */
export function SignOutButton({ action, className, children }: { action: () => Promise<void>; className?: string; children: ReactNode }) {
  return (
    <form
      action={async () => {
        try {
          await clearDownloadedSheets();
          clearOfflinePageCache();
        } catch {
          /* IndexedDB unavailable: nothing to clear */
        }
        await action();
      }}
    >
      <button className={className}>{children}</button>
    </form>
  );
}
