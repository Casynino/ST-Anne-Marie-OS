"use client";

/** Prints the page the way it looks (the menu and the buttons marked `no-print` are left out). */
export function PrintButton({ label }: { label: string }) {
  return <button type="button" onClick={() => window.print()} className="no-print btn-secondary btn-sm">{label}</button>;
}
