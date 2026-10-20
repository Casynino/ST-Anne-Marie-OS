import { Bell, BookOpen, ClipboardCheck, Globe, GraduationCap, Inbox, LayoutDashboard, ScrollText, Settings, ShieldCheck, UserCog, UserPlus, Users } from "lucide-react";

export const NAV_ICONS = {
  dashboard: LayoutDashboard, attendance: ClipboardCheck, admissions: UserPlus, notifications: Bell, students: GraduationCap, guardians: Users,
  academics: BookOpen, users: UserCog, roles: ShieldCheck, settings: Settings, audit: ScrollText, website: Globe, enquiries: Inbox,
} as const;

export type NavIcon = keyof typeof NAV_ICONS;
export type NavItem = { href: string; label: string; icon: NavIcon; badge?: number };
export type NavGroup = { label: string; items: NavItem[] };
