import { str } from "@/lib/action";

type Input = Record<string, string | string[] | undefined>;

/** Rows posted by the weeks editor (w0_topic, w0_objectives, ...) as a weeks array. Rows with no topic are dropped. */
export function weeksFrom(i: Input) {
  const rows = new Map<number, Record<string, string>>();
  for (const key of Object.keys(i)) {
    const m = /^w(\d+)_(topic|objectives|activities|resources|assessment)$/.exec(key);
    if (!m) continue;
    const n = Number(m[1]);
    rows.set(n, { ...(rows.get(n) ?? {}), [m[2]!]: str(i[key]) });
  }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r).filter((r) => r.topic).map((r, idx) => ({ weekNo: idx + 1, topic: r.topic, objectives: r.objectives || undefined, activities: r.activities || undefined, resources: r.resources || undefined, assessment: r.assessment || undefined }));
}

/** "classId|subjectId|streamId" from the unit picker. */
export function unitFrom(v: string) {
  const [classId, subjectId, streamId] = v.split("|");
  return { classId: classId ?? "", subjectId: subjectId ?? "", streamId: streamId ?? "" };
}
