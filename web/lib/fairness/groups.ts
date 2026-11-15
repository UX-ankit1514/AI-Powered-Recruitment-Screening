/**
 * Bias watch grouping (pure; safe on server and client).
 *
 * Groups are things that should NOT change how well someone can do the job, but could change how
 * an AI scores them: the language mix they spoke on the call, where they live, how they applied,
 * and the quality of the call itself. We never infer gender, caste, religion or age, and never use
 * names, photos or voices as a proxy for them.
 */
import { candidateText } from "@/lib/ai/text";

// ---------------------------------------------------------------------------
// Language mix (heuristic, from the candidate's own words in the transcript)
// ---------------------------------------------------------------------------

export type LanguageMix = "english" | "hinglish" | "other";

/** Common romanised Hindi function words. Chosen to rarely collide with English words. */
const HINDI_ROMAN = new Set(
  (
    "hai hain nahi nahin kya kyun kyunki mera meri mere mujhe mujhko humne maine aap aapka aapki apna apne apni aur bhi " +
    "kar karna karta karti karte kiya kiye raha rahi rahe haan accha acha achha theek thik toh tha thi kuch bahut bohot " +
    "yaar matlab abhi sab wala wali wale waala kaam jaise lekin phir fir ke ka ki ko mein hoon hun gaya gayi sakta sakti " +
    "sakte chahiye liye woh wo yeh ye isliye agar koi kaise kahan ji naukri padhai samajh pata bola bataya"
  ).split(" "),
);

const RE_WORD = new RegExp("[\\p{L}\\p{M}]+", "gu");
const RE_DEVANAGARI = new RegExp("\\p{Script=Devanagari}", "u");
const RE_OTHER_SCRIPT = new RegExp(
  "[\\p{Script=Bengali}\\p{Script=Gurmukhi}\\p{Script=Gujarati}\\p{Script=Oriya}\\p{Script=Tamil}\\p{Script=Telugu}" +
    "\\p{Script=Kannada}\\p{Script=Malayalam}\\p{Script=Arabic}]",
  "u",
);
const RE_LATIN = new RegExp("\\p{Script=Latin}", "u");

/** Fewer candidate words than this and we don't guess. */
export const LANGUAGE_MIN_WORDS = 8;

/**
 * english | hinglish | other, or null when there is too little candidate speech to tell.
 *  - other:    ≥20% of words in another Indian script (Kannada, Tamil, ...), or Hindi with almost no English (<10%).
 *  - hinglish: ≥10% of words are Hindi (Devanagari script or common romanised Hindi words) and ≥10% English.
 *  - english:  everything else in Latin script.
 */
export function languageMix(transcript: string | null | undefined): LanguageMix | null {
  if (!transcript || !transcript.trim()) return null;
  const words = candidateText(transcript).toLowerCase().match(RE_WORD) ?? [];
  if (words.length < LANGUAGE_MIN_WORDS) return null;
  let hindi = 0;
  let english = 0;
  let otherScript = 0;
  for (const w of words) {
    if (RE_DEVANAGARI.test(w)) hindi++;
    else if (RE_OTHER_SCRIPT.test(w)) otherScript++;
    else if (RE_LATIN.test(w)) {
      if (HINDI_ROMAN.has(w)) hindi++;
      else english++;
    }
  }
  const total = words.length;
  if (otherScript / total >= 0.2) return "other";
  if (hindi / total < 0.1) return english > 0 ? "english" : "other";
  if (english / total < 0.1) return "other";
  return "hinglish";
}

// ---------------------------------------------------------------------------
// Region (from the free-text location on the candidate profile)
// ---------------------------------------------------------------------------

const METROS: [label: string, aliases: string[]][] = [
  ["Delhi NCR", ["delhi", "new delhi", "ncr", "gurgaon", "gurugram", "noida", "greater noida", "ghaziabad", "faridabad"]],
  ["Mumbai", ["mumbai", "bombay", "navi mumbai", "thane"]],
  ["Bengaluru", ["bengaluru", "bangalore", "blr"]],
  ["Hyderabad", ["hyderabad", "secunderabad"]],
  ["Chennai", ["chennai", "madras"]],
  ["Pune", ["pune", "pimpri", "chinchwad"]],
  ["Kolkata", ["kolkata", "calcutta", "howrah"]],
  ["Ahmedabad", ["ahmedabad", "gandhinagar"]],
];

/** State names, short codes, and a few big non-metro cities per state. */
const STATES: [label: string, aliases: string[]][] = [
  [
    "Uttar Pradesh",
    ["uttar pradesh", "up", "lucknow", "kanpur", "agra", "varanasi", "prayagraj", "allahabad", "meerut", "bareilly", "gorakhpur"],
  ],
  ["Maharashtra", ["maharashtra", "nagpur", "nashik", "aurangabad", "kolhapur", "solapur"]],
  ["Karnataka", ["karnataka", "mysuru", "mysore", "mangaluru", "mangalore", "hubli", "belgaum", "belagavi"]],
  ["Tamil Nadu", ["tamil nadu", "tn", "coimbatore", "madurai", "trichy", "tiruchirappalli", "salem"]],
  ["Telangana", ["telangana", "warangal"]],
  ["Andhra Pradesh", ["andhra pradesh", "ap", "visakhapatnam", "vizag", "vijayawada", "guntur", "tirupati"]],
  ["West Bengal", ["west bengal", "wb", "siliguri", "durgapur", "asansol"]],
  ["Gujarat", ["gujarat", "surat", "vadodara", "baroda", "rajkot"]],
  ["Rajasthan", ["rajasthan", "jaipur", "jodhpur", "udaipur", "kota", "ajmer"]],
  ["Madhya Pradesh", ["madhya pradesh", "mp", "indore", "bhopal", "gwalior", "jabalpur"]],
  ["Bihar", ["bihar", "patna", "gaya", "muzaffarpur"]],
  ["Jharkhand", ["jharkhand", "ranchi", "jamshedpur", "dhanbad"]],
  ["Odisha", ["odisha", "orissa", "bhubaneswar", "cuttack"]],
  ["Kerala", ["kerala", "kochi", "cochin", "thiruvananthapuram", "trivandrum", "kozhikode", "calicut"]],
  ["Punjab", ["punjab", "ludhiana", "amritsar", "jalandhar", "mohali"]],
  ["Haryana", ["haryana", "panipat", "ambala", "karnal", "hisar"]],
  ["Chandigarh", ["chandigarh"]],
  ["Uttarakhand", ["uttarakhand", "dehradun", "haridwar"]],
  ["Himachal Pradesh", ["himachal pradesh", "himachal", "shimla"]],
  ["Jammu and Kashmir", ["jammu and kashmir", "jammu", "kashmir", "srinagar"]],
  ["Assam", ["assam", "guwahati"]],
  ["Chhattisgarh", ["chhattisgarh", "raipur", "bilaspur"]],
  ["Goa", ["goa", "panaji"]],
];

const ABROAD = [
  "usa",
  "united states",
  "uk",
  "united kingdom",
  "london",
  "dubai",
  "uae",
  "singapore",
  "canada",
  "australia",
  "germany",
  "nepal",
];

export const REGION_UNKNOWN = "Not given";
export const REGION_ABROAD = "Outside India";

function hasAlias(text: string, alias: string): boolean {
  return new RegExp(`(^|[^a-z])${alias.replace(/ /g, "\\s+")}($|[^a-z])`).test(text);
}

/** Metro if it is one of India's big metros, else the state, else Outside India / Other / Not given. */
export function regionBucket(location: string | null | undefined): string {
  const t = String(location ?? "")
    .toLowerCase()
    .replace(/[^a-z ,/-]/g, " ")
    .trim();
  if (!t) return REGION_UNKNOWN;
  for (const [label, aliases] of METROS) if (aliases.some((a) => hasAlias(t, a))) return label;
  for (const [label, aliases] of STATES) if (aliases.some((a) => hasAlias(t, a))) return label;
  if (ABROAD.some((a) => hasAlias(t, a))) return REGION_ABROAD;
  return "Other places";
}

// ---------------------------------------------------------------------------
// Source (how the candidate reached us)
// ---------------------------------------------------------------------------

const SPREADSHEET = new Set([
  "csv",
  "xlsx",
  "xls",
  "sheet",
  "sheets",
  "spreadsheet",
  "paste",
  "pasted",
  "manual",
  "import",
  "employer_upload",
  "upload",
]);
const PORTAL = /portal|ats|naukri|linkedin|indeed|instahyre|foundit|monster|internshala|apna|workindia|shine|hirist|cutshort|wellfound/;

export function sourceBucket(source: string | null | undefined): string {
  const s = String(source ?? "")
    .toLowerCase()
    .trim();
  if (!s) return "Other";
  if (s === "form" || s === "apply" || s === "apply_form") return "Apply form";
  if (SPREADSHEET.has(s)) return "Spreadsheet";
  if (PORTAL.test(s)) return "Job portal";
  return "Other";
}

// ---------------------------------------------------------------------------
// Call quality
// ---------------------------------------------------------------------------

/** Calls shorter than this (that were not a planned short exit) count as cut short. */
export const SHORT_CALL_SECONDS = 180;

export const CALL_QUALITY = {
  normal: "Normal call",
  short: "Cut short (under 3 min)",
  dropped: "Dropped or unclear audio",
} as const;

export function callQualityBucket(r: {
  outcome?: string | null;
  duration_s?: number | null;
  hr_review?: string | null;
  short_exit?: boolean | null;
}): string {
  if (r.outcome === "dropped" || (r.hr_review && r.hr_review.trim())) return CALL_QUALITY.dropped;
  // A planned short exit is an outcome of the screening itself, not a call-quality problem.
  if (!r.short_exit && typeof r.duration_s === "number" && r.duration_s < SHORT_CALL_SECONDS) return CALL_QUALITY.short;
  return CALL_QUALITY.normal;
}

export const LANGUAGE_LABELS: Record<LanguageMix | "unknown", string> = {
  english: "English",
  hinglish: "Hinglish",
  other: "Other language",
  unknown: "Too little speech to tell",
};
