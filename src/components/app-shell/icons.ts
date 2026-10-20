import { Bell, BookOpen, CalendarClock, ClipboardList, FolderOpen, HeartHandshake, NotebookPen, CalendarDays, ClipboardCheck, FileCheck, MessageSquare, FileText, Globe, GraduationCap, Inbox, LayoutDashboard, PencilLine, ScrollText, Settings, ShieldCheck, SlidersHorizontal, Table2, Wallet, UserCog, UserPlus, Users } from "lucide-react";

export const NAV_ICONS = {
  dashboard: LayoutDashboard, attendance: ClipboardCheck, admissions: UserPlus, notifications: Bell, students: GraduationCap, guardians: Users,
  academics: BookOpen, users: UserCog, roles: ShieldCheck, settings: Settings, audit: ScrollText, website: Globe, enquiries: Inbox, exams: FileText, marks: PencilLine, results: Table2, grading: SlidersHorizontal, reportcards: FileCheck, finance: Wallet, communication: MessageSquare, calendar: CalendarDays, timetable: CalendarClock, planning: NotebookPen, assignments: ClipboardList, portfolio: FolderOpen, behaviour: HeartHandshake,
} as const;

export type NavIcon = keyof typeof NAV_ICONS;
export type NavItem = { href: string; label: string; icon: NavIcon; badge?: number };
export type NavGroup = { label: string; items: NavItem[] };
