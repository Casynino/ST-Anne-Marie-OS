import { redirect } from "next/navigation";

/**
 * There is no list of applications waiting for their fee in Admissions: an application exists for the office only once its fee is paid. The
 * form filled in at the office stays with Finance (Finance > Application fees) until the family pays; this old address goes to the applications.
 */
export default function DraftsRedirect() {
  redirect("/admissions");
}
