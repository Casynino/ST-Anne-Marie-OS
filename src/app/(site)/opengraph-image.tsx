import { ImageResponse } from "next/og";
import { getPublicSchool } from "@/server/website";

export const alt = "School social sharing card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Fallback social-sharing card drawn from the school's real name in the brand colours (no stock imagery). */
export default async function OpengraphImage() {
  const school = await getPublicSchool();
  const name = school?.name ?? "School";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: 72, background: "#028051", color: "#fff", position: "relative" }}>
        <div style={{ position: "absolute", right: -120, top: -120, width: 520, height: 520, borderRadius: 999, background: "#026a43" }} />
        <div style={{ position: "absolute", right: 90, bottom: 0, width: 150, height: 230, borderTopLeftRadius: 999, borderTopRightRadius: 999, background: "#e8dc2e" }} />
        {school?.motto ? <div style={{ fontSize: 34, opacity: 0.9, marginBottom: 18 }}>{school.motto}</div> : null}
        <div style={{ fontSize: 84, fontWeight: 700, lineHeight: 1.05, maxWidth: 820 }}>{name}</div>
      </div>
    ),
    size,
  );
}
