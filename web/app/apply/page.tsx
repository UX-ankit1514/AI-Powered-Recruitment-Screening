import { ApplyUnavailable } from "./unavailable";

export const metadata = { title: "Apply · Pingo", robots: { index: false } };

/** /apply without a job: same friendly message as an unknown job. */
export default function ApplyIndex() {
  return <ApplyUnavailable />;
}
