/** Loose input shapes accepted by the AI services (DB rows or plain strings), plus normalisers. Pure. */

export type TextItem = string | { text?: string | null; name?: string | null; description?: string | null };
export type RoleItem = string | { id?: string | null; title: string };
export type TraitInput = { key: string; name: string; description?: string | null };
export type RubricInput = {
  must_haves?: TextItem[] | null;
  nice_to_haves?: TextItem[] | null;
  custom_traits?: TraitInput[] | null;
};

export function textList(items: readonly TextItem[] | null | undefined): string[] {
  return (items ?? [])
    .map((i) => (typeof i === "string" ? i : (i?.text ?? i?.name ?? "")))
    .map((s) => String(s ?? "").trim())
    .filter(Boolean);
}

/** Culture values as "Name: description" lines. */
export function valueList(items: readonly TextItem[] | null | undefined): string[] {
  return (items ?? [])
    .map((i) => {
      if (typeof i === "string") return i.trim();
      const name = String(i?.name ?? i?.text ?? "").trim();
      const desc = String(i?.description ?? "").trim();
      return name && desc ? `${name}: ${desc}` : name || desc;
    })
    .filter(Boolean);
}

export function roleList(items: readonly RoleItem[] | null | undefined): { id: string | null; title: string }[] {
  return (items ?? [])
    .map((r) => (typeof r === "string" ? { id: null, title: r.trim() } : { id: r?.id ?? null, title: String(r?.title ?? "").trim() }))
    .filter((r) => r.title);
}

export function toSnakeKey(s: string): string {
  const k = String(s ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "");
  return k.slice(0, 40);
}

/** Date → ISO 8601 in Asia/Kolkata with explicit +05:30 offset (India has no DST). */
export function toIstIso(d: Date): string {
  const shifted = new Date(d.getTime() + 330 * 60_000);
  return shifted.toISOString().slice(0, 19) + "+05:30";
}

export function describeIst(d: Date): string {
  const human = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return `${human} (${toIstIso(d)})`;
}
