"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Keeps server-rendered numbers live: when a call, score or candidate row of this company changes
 * (Supabase Realtime, RLS-filtered), re-render the current route. Debounced so a burst of webhook
 * updates causes one refresh.
 */
export function LiveRefresh({ companyId }: { companyId: string }) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 800);
    };
    const filter = `company_id=eq.${companyId}`;
    const channel = supabase
      .channel(`live:${companyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "calls", filter }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "scores", filter }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "candidates", filter }, bump)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [companyId, router]);
  return null;
}
