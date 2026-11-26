"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, ArrowUpRight, ArrowDownLeft } from "lucide-react";

const TABS = [
  {
    label: "All Transactions",
    href: "/user/transactions",
    icon: ClipboardList,
    exact: true,
  },
  {
    label: "Borrow",
    href: "/user/transactions/borrow",
    icon: ArrowUpRight,
    exact: false,
  },
  {
    label: "Return",
    href: "/user/transactions/return",
    icon: ArrowDownLeft,
    exact: false,
  },
] as const;

export default function TransactionSubnav() {
  const pathname = usePathname();

  return (
    <div className="mb-5 border-b border-slate-200 no-print">
      <nav
        aria-label="Transaction submenus"
        className="flex items-center gap-1 overflow-x-auto -mb-px"
      >
        {TABS.map((tab) => {
          const isActive = tab.exact
            ? pathname === tab.href
            : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                isActive
                  ? "border-emerald-700 text-emerald-800"
                  : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
