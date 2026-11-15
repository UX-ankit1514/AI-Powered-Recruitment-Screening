/**
 * Idempotent seed: companies, test users, memberships, one job + rubric.
 * Run: npm run seed   (reads web/.env.local; uses the service-role key, never ship to the browser)
 *
 * Safe to re-run: fixed ids + upserts. Existing job/rubric rows are left untouched so
 * edits made in the app are not overwritten.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";

config({ path: new URL("../.env.local", import.meta.url).pathname, quiet: true });

export const SEED = {
  acme: { id: "00000000-0000-4000-8000-00000000a001", name: "Acme SaaS" },
  other: { id: "00000000-0000-4000-8000-00000000b001", name: "Other Co" },
  acmeJobId: "00000000-0000-4000-8000-00000000a101",
  otherJobId: "00000000-0000-4000-8000-00000000b101",
  users: {
    acmeAdmin: { email: "admin@acme.pingo.test", passwordEnv: "SEED_ACME_ADMIN_PASSWORD", company: "acme", role: "admin" },
    acmeHm: { email: "hm@acme.pingo.test", passwordEnv: "SEED_ACME_HM_PASSWORD", company: "acme", role: "hiring_manager" },
    otherAdmin: { email: "admin@other.pingo.test", passwordEnv: "SEED_OTHER_ADMIN_PASSWORD", company: "other", role: "admin" },
  },
} as const;

// ---- demo content (ported from /demo/index.html) ----
const JD = `Sales Executive, B2B SaaS (Bengaluru)

Acme SaaS sells workflow software to mid-market sales teams. You will own the full cycle for inbound and outbound leads: discovery, demos, negotiation and close, against a monthly quota.

You will do well here if you can run a sharp discovery call, handle objections calmly, keep a clean pipeline in the CRM and tell a customer story that sticks. 1 to 4 years in a customer-facing sales role. SaaS experience is a plus, not a requirement.`;

const CULTURE_VALUES = [
  { name: "Ownership", description: "Takes a problem end to end without waiting to be asked." },
  { name: "Curiosity", description: "Asks good questions and keeps learning about customers and the product." },
  { name: "Customer first", description: "Puts the customer's real outcome ahead of a quick win." },
];

const FAQ = [
  { question: "Is the role remote?", answer: "Hybrid: three days a week in our Indiranagar office." },
  { question: "How is pay structured?", answer: "Fixed salary plus monthly incentives on closed revenue, uncapped." },
];

const MUST_HAVES = [
  { text: "Fluent spoken English and Hindi" },
  { text: "Based in or relocating to Bengaluru" },
  { text: "At least 1 year in a customer-facing role" },
];

const BALANCED_WEIGHTS = { skills: 30, experience: 30, culture_fit: 25, confidence: 15 };

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name} (see web/.env.example)`);
  return v;
}

export function adminClient(): SupabaseClient<Database> {
  return createClient<Database>(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function findUserId(db: SupabaseClient<Database>, email: string): Promise<string | null> {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function ensureUser(db: SupabaseClient<Database>, email: string, password?: string): Promise<string> {
  const existing = await findUserId(db, email);
  if (existing) {
    if (password) {
      const { error } = await db.auth.admin.updateUserById(existing, { password, email_confirm: true });
      if (error) throw error;
    }
    return existing;
  }
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error(`could not create ${email}`);
  return data.user.id;
}

function check<T>(res: { error: unknown; data?: T }, what: string) {
  if (res.error) throw new Error(`${what}: ${JSON.stringify(res.error)}`);
  return res.data;
}

export async function seed() {
  const db = adminClient();

  check(
    await db.from("companies").upsert(
      [
        { id: SEED.acme.id, name: SEED.acme.name, culture_values: CULTURE_VALUES, faq: FAQ },
        { id: SEED.other.id, name: SEED.other.name },
      ],
      { onConflict: "id", ignoreDuplicates: true, defaultToNull: false },
    ),
    "companies",
  );

  const userIds: Record<string, string> = {};
  for (const [key, u] of Object.entries(SEED.users)) {
    userIds[key] = await ensureUser(db, u.email, env(u.passwordEnv));
    check(
      await db
        .from("members")
        .upsert({ user_id: userIds[key], company_id: SEED[u.company].id, role: u.role }, { onConflict: "user_id,company_id" }),
      `member ${u.email}`,
    );
  }

  const owner = process.env.SEED_OWNER_EMAIL?.trim();
  if (owner) {
    const ownerId = await ensureUser(db, owner);
    check(
      await db.from("members").upsert({ user_id: ownerId, company_id: SEED.acme.id, role: "admin" }, { onConflict: "user_id,company_id" }),
      "owner member",
    );
  }

  check(
    await db.from("jobs").upsert(
      [
        {
          id: SEED.acmeJobId,
          company_id: SEED.acme.id,
          title: "Sales Executive",
          jd_text: JD,
          culture_values: CULTURE_VALUES,
          faq: FAQ,
          created_by: userIds.acmeAdmin,
        },
        {
          id: SEED.otherJobId,
          company_id: SEED.other.id,
          title: "Support Associate",
          jd_text: "Answer customer tickets by chat and phone.",
          created_by: userIds.otherAdmin,
        },
      ],
      { onConflict: "id", ignoreDuplicates: true, defaultToNull: false },
    ),
    "jobs",
  );

  check(
    await db.from("rubrics").upsert(
      [
        {
          job_id: SEED.acmeJobId,
          company_id: SEED.acme.id,
          version: 1,
          must_haves: MUST_HAVES,
          weights: BALANCED_WEIGHTS,
          is_current: true,
          created_by: userIds.acmeAdmin,
        },
        {
          job_id: SEED.otherJobId,
          company_id: SEED.other.id,
          version: 1,
          must_haves: [{ text: "Fluent written English" }],
          weights: BALANCED_WEIGHTS,
          is_current: true,
          created_by: userIds.otherAdmin,
        },
      ],
      { onConflict: "job_id,version", ignoreDuplicates: true, defaultToNull: false },
    ),
    "rubrics",
  );

  return userIds;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then((ids) => console.log(`Seed OK: ${Object.keys(ids).length} test users, 2 companies, 2 jobs, 2 rubrics.`))
    .catch((e) => {
      console.error("Seed failed:", e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
