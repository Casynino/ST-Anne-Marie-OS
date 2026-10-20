"use server";

import { run, type ActionState } from "@/lib/action";
import { getSessionInfo } from "@/lib/auth/next";
import { changeOwnPassword } from "@/server/users";
import { homeFor } from "@/lib/auth/home";

export async function changePasswordAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run(
    form,
    async (ctx, input) => {
      const session = await getSessionInfo();
      await changeOwnPassword(ctx, input, session?.sessionId);
      return { redirectTo: homeFor(ctx.userType) };
    },
    { allowMustChangePassword: true },
  );
}
