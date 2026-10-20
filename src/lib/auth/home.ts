/** Where a signed-in user lands: staff in the staff area, parents and students in the family portal. */
export const homeFor = (userType: "STAFF" | "GUARDIAN" | "STUDENT"): string => (userType === "STAFF" ? "/dashboard" : "/family");
