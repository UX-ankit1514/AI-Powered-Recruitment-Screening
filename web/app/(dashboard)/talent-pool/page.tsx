import { redirect } from "next/navigation";

/** The sidebar and dashboard link here (build-spec §7 name); the page lives at /hidden. */
export default function TalentPoolRedirect() {
  redirect("/hidden");
}
