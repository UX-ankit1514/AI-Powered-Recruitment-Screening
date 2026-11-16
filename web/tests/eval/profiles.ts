/** Role profiles + rubrics used by the golden calibration set (sales and SDE). */
import type { RoleProfile } from "../../lib/ai/role-profile-schema";
import { defaultQualityAnchors } from "../../lib/ai/role-profile";

const A = (one: string, two: string, three: string, four: string, five: string) => ({ "1": one, "2": two, "3": three, "4": four, "5": five });

export type JobFixture = {
  title: string;
  mustHaves: string[];
  niceToHaves: string[];
  cultureValues: { name: string; description: string }[];
  weights: Record<string, number>;
  openRoles: { id: string; title: string; summary: string }[];
  profile: RoleProfile;
};

export const SALES: JobFixture = {
  title: "Inside Sales Executive (B2B SaaS)",
  mustHaves: ["1+ year of B2B or phone sales", "Can join within 30 days"],
  niceToHaves: ["Speaks with customers in English and Hindi"],
  cultureValues: [
    { name: "Ownership", description: "We finish what we start" },
    { name: "Customer first", description: "We solve the customer's real problem" },
  ],
  weights: { skills: 30, experience: 30, culture_fit: 25, confidence: 15 },
  openRoles: [
    { id: "job-cs", title: "Customer Success Associate", summary: "Needs: onboarding customers; patient problem solving; renewals" },
    { id: "job-ops", title: "Operations Intern", summary: "Needs: Excel; process discipline; eagerness to learn" },
  ],
  profile: {
    version: 3,
    source: "edited",
    requirements: [
      {
        id: "s_phone_sales",
        text: "1+ year of B2B or phone sales",
        kind: "experience",
        importance: "must",
        evidence_hint: "Months/years selling by phone to businesses, what they sold, to whom",
        question: "Tell me about your sales work so far: what did you sell and to whom?",
        probe: "Roughly how many calls a day, and for how long?",
        quality: "experience",
        anchors: A(
          "Has never sold anything.",
          "Some retail or informal selling, not by phone or to businesses.",
          "About a year of phone or B2B selling with a clear product and buyer.",
          "1-3 years of B2B phone sales with volumes and a named product.",
          "3+ years of B2B SaaS phone sales with clear results.",
        ),
      },
      {
        id: "s_join_30",
        text: "Can join within 30 days",
        kind: "logistics",
        importance: "must",
        evidence_hint: "Notice period or joining date",
        question: "If this works out, how soon could you join?",
        probe: "Is that notice period fixed or can it be bought out?",
        quality: "experience",
        anchors: A("Cannot join for 3+ months.", "60-90 days.", "About 30 days.", "Two weeks or less.", "Immediately available."),
      },
      {
        id: "s_crm_pipeline",
        text: "Manages a sales pipeline and follow-ups in a CRM",
        kind: "skill",
        importance: "core",
        evidence_hint: "Names a CRM, describes stages, follow-up cadence",
        question: "How do you keep track of leads and follow-ups?",
        probe: "Which tool, and what does your follow-up routine look like?",
        quality: "skills",
        anchors: A(
          "No method for tracking leads.",
          "Notebook or memory, follow-ups ad hoc.",
          "Uses a CRM or sheet with stages and regular follow-ups.",
          "Clear pipeline stages, cadence and next steps logged for every lead.",
          "Builds and improves pipeline process; uses data to prioritise.",
        ),
      },
      {
        id: "s_objections",
        text: "Handles objections and rejection on calls",
        kind: "behaviour",
        importance: "core",
        evidence_hint: "A specific objection and how they handled it",
        question: "Tell me about a customer who said no at first. What did you do?",
        probe: "What exactly did you say to them?",
        quality: "skills",
        anchors: A(
          "Gives up at the first no or avoids difficult customers.",
          "Generic answer like 'I stay positive' with no example.",
          "One real objection handled with a sensible response.",
          "Several objections with clear technique and outcome.",
          "Turns objections into wins repeatedly and can teach the approach.",
        ),
      },
      {
        id: "s_targets",
        text: "Has worked to monthly sales targets",
        kind: "experience",
        importance: "core",
        evidence_hint: "Target numbers and how they did against them",
        question: "What targets did you work to, and how did you do?",
        probe: "What was your best month and why?",
        quality: "experience",
        anchors: A("Never had a target.", "Had targets but can't say how they did.", "Names targets and roughly met them.", "Consistently met or beat targets with numbers.", "Top performer with sustained over-achievement."),
      },
      {
        id: "s_languages",
        text: "Speaks with customers in English and Hindi",
        kind: "behaviour",
        importance: "nice",
        evidence_hint: "Says they handle calls in both",
        question: "",
        probe: "",
        quality: "confidence",
        anchors: A("Neither.", "One language only, unwilling to try.", "Handles calls in one, some of the other.", "Comfortable in both.", "Switches easily, has sold in both."),
      },
    ],
    must_have_checks: [
      { id: "mh_phone_sales", text: "1+ year of B2B or phone sales", check: "Ask how long they have sold by phone or to businesses" },
      { id: "mh_join_30", text: "Can join within 30 days", check: "Ask their notice period or joining date" },
    ],
    quality_anchors: defaultQualityAnchors([]),
  },
};

export const SDE: JobFixture = {
  title: "Backend Engineer (Node.js)",
  mustHaves: ["2+ years building backend services", "Comfortable with SQL databases"],
  niceToHaves: ["Writes automated tests"],
  cultureValues: [{ name: "Ownership", description: "You build it, you run it" }],
  weights: { skills: 40, experience: 40, confidence: 10, culture_fit: 10 },
  openRoles: [{ id: "job-data", title: "Data Engineer", summary: "Needs: SQL; data pipelines; Python" }],
  profile: {
    version: 2,
    source: "generated",
    requirements: [
      {
        id: "d_backend_2y",
        text: "2+ years building backend services",
        kind: "experience",
        importance: "must",
        evidence_hint: "Services built, stack, years, scale",
        question: "Tell me about the backend services you have built.",
        probe: "What was your part, and how much traffic did it handle?",
        quality: "experience",
        anchors: A("No backend work.", "Coursework or tutorials only.", "About 2 years on real backend services.", "2-5 years with owned services in production.", "Senior-level ownership of critical services at scale."),
      },
      {
        id: "d_sql",
        text: "Comfortable with SQL databases",
        kind: "skill",
        importance: "must",
        evidence_hint: "Schema design, indexes, query tuning in Postgres/MySQL",
        question: "How have you used SQL databases in your work?",
        probe: "Tell me about a slow query you fixed.",
        quality: "skills",
        anchors: A("Has not used SQL.", "Basic CRUD through an ORM only.", "Writes queries and designs simple schemas.", "Indexes, query plans and migrations in production.", "Deep tuning and data modelling at scale."),
      },
      {
        id: "d_api_design",
        text: "Designs clean REST APIs",
        kind: "skill",
        importance: "core",
        evidence_hint: "Resource design, versioning, errors, pagination",
        question: "Walk me through an API you designed.",
        probe: "How did you handle errors and versioning?",
        quality: "skills",
        anchors: A("Has not designed an API.", "Used APIs but not designed one.", "Designed a working API with sensible endpoints.", "Thought through errors, pagination, versioning.", "Designs APIs others adopt; clear trade-offs."),
      },
      {
        id: "d_debugging",
        text: "Debugs production issues methodically",
        kind: "skill",
        importance: "core",
        evidence_hint: "Logs, metrics, reproduction, root cause",
        question: "Tell me about a production bug you tracked down.",
        probe: "How did you find the root cause?",
        quality: "skills",
        anchors: A("No debugging story.", "Vague 'I checked logs'.", "One real bug with a sensible path to the cause.", "Methodical: reproduce, measure, root cause, prevent.", "Leads incident response; builds tooling to prevent repeats."),
      },
      {
        id: "d_ownership",
        text: "Owns features end to end, including running them",
        kind: "behaviour",
        importance: "core",
        evidence_hint: "On-call, monitoring, follow-through after release",
        question: "What happens after you ship something?",
        probe: "Have you been on call for it?",
        quality: "culture_fit",
        anchors: A("Ships and forgets.", "Someone else runs it.", "Monitors and fixes their own features.", "On call and improves reliability.", "Drives reliability for the team."),
      },
      {
        id: "d_testing",
        text: "Writes automated tests",
        kind: "skill",
        importance: "nice",
        evidence_hint: "Unit/integration tests, CI",
        question: "",
        probe: "",
        quality: "skills",
        anchors: A("No tests.", "Manual testing only.", "Writes some unit tests.", "Unit + integration tests in CI.", "Drives test strategy."),
      },
    ],
    must_have_checks: [
      { id: "mh_backend", text: "2+ years building backend services", check: "Ask for years and services built" },
      { id: "mh_sql", text: "Comfortable with SQL databases", check: "Ask how they have used SQL" },
    ],
    quality_anchors: defaultQualityAnchors([]),
  },
};
