import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import "@/components/results/results.css";
import { canEdit, getMembership } from "@/components/server/session";
import { createClient } from "@/lib/supabase/server";
import { loadProfile } from "@/components/results/server/data";
import { roleIn } from "@/components/results/server/auth";
import { ProfileView } from "@/components/results/profile-view";
import { PageSkeleton } from "@/components/results/page-bits";

export const metadata = { title: "Candidate · Pingo" };

export default function CandidatePage({ params }: PageProps<"/candidates/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton title="Candidate" label="Loading candidate" />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: PageProps<"/candidates/[id]">["params"] }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const me = await getMembership();
  if (!me) notFound();
  const db = await createClient();
  const p = await loadProfile(db, id, me.userId);
  if (!p) notFound();
  const role = await roleIn(db, me.userId, p.candidate.company_id);
  if (!role) notFound();
  return <ProfileView key={p.candidate.id} p={p} canEdit={canEdit(role)} meIsHm={role === "hiring_manager"} />;
}
