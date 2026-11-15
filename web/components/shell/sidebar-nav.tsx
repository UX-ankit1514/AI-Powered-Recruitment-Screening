"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { IconDashboard, IconJob, IconPeople, IconPhone, IconSettings, IconStar } from "@/components/icons";

const ITEMS = [
  { href: "/dashboard", label: "Dashboard", Icon: IconDashboard, match: ["/dashboard"] },
  { href: "/jobs", label: "Job & rubric", Icon: IconJob, match: ["/jobs"] },
  { href: "/candidates", label: "Candidates", Icon: IconPeople, match: ["/candidates"] },
  { href: "/calls", label: "Calls", Icon: IconPhone, match: ["/calls"] },
  { href: "/talent-pool", label: "Hidden fits", Icon: IconStar, match: ["/talent-pool", "/hidden-fits"] },
  { href: "/settings", label: "Settings", Icon: IconSettings, match: ["/settings"] },
] as const;

/** Pathname is request data: stream the active state in, render plain links in the static shell. */
export function SidebarNav() {
  return (
    <Suspense fallback={<NavLinks pathname="" />}>
      <ActiveNav />
    </Suspense>
  );
}

function ActiveNav() {
  return <NavLinks pathname={usePathname() ?? ""} />;
}

function NavLinks({ pathname }: { pathname: string }) {
  return (
    <div className="nav">
      {ITEMS.map(({ href, label, Icon, match }) => {
        const active = match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined}>
            <Icon />
            {label}
          </Link>
        );
      })}
    </div>
  );
}
