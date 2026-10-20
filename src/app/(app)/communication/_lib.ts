import { str, list } from "@/lib/action";
import { zonedToUtc } from "@/lib/dates";
import { parseAmount } from "@/lib/finance/money";
import { invalid } from "@/lib/errors";

type Input = Record<string, string | string[] | undefined>;

export function audienceFrom(i: Input) {
  switch (str(i.audienceType)) {
    case "CLASS": return { type: "CLASS", classIds: list(i.classIds), streamId: str(i.streamId) || undefined };
    case "LEVEL": return { type: "LEVEL", levelId: str(i.levelId) };
    case "ARREARS": {
      const min = str(i.minOutstanding) ? parseAmount(str(i.minOutstanding)) : 1;
      if (min === null || min < 1) throw invalid("Please correct the highlighted fields.", { minOutstanding: "Enter an amount such as 50000" });
      return { type: "ARREARS", classId: str(i.classId) || undefined, overdueOnly: str(i.overdueOnly) === "on", minOutstanding: min };
    }
    default: return { type: "ALL" };
  }
}

export function broadcastInput(i: Input, timezone: string) {
  const at = str(i.sendAt) ? zonedToUtc(str(i.sendAt), timezone) : null;
  if (str(i.sendAt) && !at) throw invalid("Please correct the highlighted fields.", { sendAt: "Enter a valid date and time" });
  return {
    kind: str(i.kind), title: str(i.title), bodyEn: str(i.bodyEn), bodySw: str(i.bodySw) || undefined, audience: audienceFrom(i),
    sendSms: str(i.sendSms) === "on", sendInApp: str(i.sendInApp) === "on", sendAt: at?.toISOString(),
  };
}

