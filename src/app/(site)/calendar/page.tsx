import { redirect } from "next/navigation";

// The calendar now lives with news at /events; this keeps old links working.
export default function CalendarRedirect() {
  redirect("/events");
}
