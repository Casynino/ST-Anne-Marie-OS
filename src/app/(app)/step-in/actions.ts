"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { forbidden } from "@/lib/errors";
import { run, type ActionState } from "@/lib/action";
import { isOwnerOnly, STEP_IN_COOKIE, STEP_IN_MINUTES } from "@/lib/rbac/oversight";
import { actorOf, writeAudit } from "@/server/audit";
import { parse, text } from "@/lib/validation";

/**
 * The owner does not do the departments' daily work. When he truly must (a department is stuck and nobody can act), he steps in on purpose:
 * a stated reason, a fixed time, a banner on every page, and an audit entry when it starts and when it ends.
 */
export async function stepInAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    if (!isOwnerOnly(ctx)) throw forbidden();
    const { reason } = parse(z.object({ reason: text(300) }), i);
    if (reason.length < 10) throw (await import("@/lib/errors")).invalid("Please correct the highlighted fields.", { reason: "Say in a few words why you need to step in" });
    const until = Date.now() + STEP_IN_MINUTES * 60_000;
    await db.$transaction((tx) => writeAudit(tx, actorOf(ctx), { action: "owner.step_in", entityType: "User", entityId: ctx.userId, summary: `Stepped in for ${STEP_IN_MINUTES} minutes`, reason }));
    (await cookies()).set(STEP_IN_COOKIE, String(until), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: new Date(until) });
    return { redirectTo: "/dashboard" };
  });
}

export async function stepOutAction(form: FormData): Promise<void> {
  await run(form, async (ctx) => {
    const jar = await cookies();
    if (isOwnerOnly(ctx) && jar.get(STEP_IN_COOKIE)) await db.$transaction((tx) => writeAudit(tx, actorOf(ctx), { action: "owner.step_out", entityType: "User", entityId: ctx.userId, summary: "Stopped stepping in" }));
    jar.delete(STEP_IN_COOKIE);
    return { redirectTo: "/dashboard" };
  });
}
