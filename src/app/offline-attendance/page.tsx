import type { Metadata } from "next";
import { OfflineHub } from "@/components/attendance/offline-hub";

export const metadata: Metadata = { title: "Offline attendance" };

/**
 * Deliberately has no server data and no auth redirect: it is cached by the service worker and everything it
 * shows (class lists, unsynced changes) is read from IndexedDB on this device. Saving still goes through the
 * authenticated sync endpoint.
 */
export default function OfflineAttendancePage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-3 py-5 sm:px-6">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">St Anne Marie Schools</h1>
      <OfflineHub />
    </main>
  );
}
