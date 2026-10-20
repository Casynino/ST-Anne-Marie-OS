import { Cormorant_Garamond, Fira_Sans, Inter } from "next/font/google";

/*
 * Typefaces, chosen with the UI/UX design skill's pairings:
 *  - public site: cinematic serif display (Cormorant Garamond) + Inter for text, the same family as the owner's other premium sites
 *  - staff area and family portal: "Data-Dense Dashboard" (Fira Sans: precise, excellent numerals)
 * Each is loaded only by the layout that uses it, so a parent never downloads the site's fonts and the other way round.
 */
export const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["400", "500", "600", "700"], style: ["normal", "italic"], display: "swap", variable: "--font-cormorant" });
export const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
export const fira = Fira_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-fira" });
