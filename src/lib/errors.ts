/** Errors that are safe to show to the user. Anything else is logged and shown as a generic failure. */
export class AppError extends Error {
  constructor(
    public readonly code: "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "UNAUTHENTICATED" | "RATE_LIMITED",
    message: string,
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

export const forbidden = (msg = "You do not have permission to do this.") => new AppError("FORBIDDEN", msg);
export const notFound = (what = "Record") => new AppError("NOT_FOUND", `${what} not found.`);
export const conflict = (msg: string) => new AppError("CONFLICT", msg);
export const invalid = (msg: string, fieldErrors?: Record<string, string>) =>
  new AppError("VALIDATION", msg, fieldErrors);
export const unauthenticated = () => new AppError("UNAUTHENTICATED", "Please sign in.");
