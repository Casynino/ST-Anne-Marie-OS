import type { ReactNode } from "react";

/**
 * Panels sit in a wrapping row. A panel that has nothing to show renders nothing, and the others grow to fill the row, so there are no empty
 * columns. W = a wide panel, N = a narrow one, H = a half, T = a third.
 */
export const Row = ({ children }: { children: ReactNode }) => <div className="mt-4 flex flex-wrap items-stretch gap-4">{children}</div>;
export const W = "flex-[2_1_34rem]";
export const N = "flex-[1_1_20rem]";
export const H = "flex-[1_1_26rem]";
export const T = "flex-[1_1_19rem]";
