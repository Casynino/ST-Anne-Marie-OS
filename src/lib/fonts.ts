import { Atkinson_Hyperlegible, Crimson_Pro, Fira_Sans } from "next/font/google";

/*
 * Typefaces, chosen with the UI/UX design skill's pairings:
 *  - public site: "Academic/Research" (Crimson Pro headings + Atkinson Hyperlegible body: scholarly, and built for legibility on cheap screens)
 *  - staff area and family portal: "Data-Dense Dashboard" (Fira Sans: precise, excellent numerals)
 * Each is loaded only by the layout that uses it, so a parent never downloads the site's fonts and the other way round.
 */
export const crimson = Crimson_Pro({ subsets: ["latin"], weight: ["400", "500", "600", "700"], style: ["normal", "italic"], display: "swap", variable: "--font-crimson" });
export const atkinson = Atkinson_Hyperlegible({ subsets: ["latin"], weight: ["400", "700"], display: "swap", variable: "--font-atkinson" });
export const fira = Fira_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-fira" });
