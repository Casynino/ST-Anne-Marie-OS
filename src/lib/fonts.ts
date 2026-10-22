import { Inter, Montserrat } from "next/font/google";

/*
 * Typefaces, chosen with the UI/UX design skill's pairings:
 *  - public site: Montserrat headings (sturdy, friendly, easy to read on cheap phones) + Inter text
 *  - staff area and family portal: Inter (calm, neutral, very readable at small sizes, tabular numerals)
 * Each is loaded only by the layout that uses it, so a parent never downloads the site's fonts and the other way round.
 */
export const montserrat = Montserrat({ subsets: ["latin"], weight: ["500", "600", "700", "800"], display: "swap", variable: "--font-montserrat" });
export const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
