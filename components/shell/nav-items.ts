import { DatabaseIcon, LayoutGridIcon, type LucideIcon } from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

export const NAV_ITEMS: NavItem[] = [
  { href: "/apps", label: "Apps", icon: LayoutGridIcon },
  { href: "/connections", label: "Data Connections", icon: DatabaseIcon },
];
