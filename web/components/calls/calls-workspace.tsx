"use client";

import { useState } from "react";
import { SingleCall, type CallCandidate } from "./single-call";

/** Grid for the single call: form + side column, or the full-width call stage while a call runs. */
export function CallsWorkspace({
  job,
  candidates,
  canCall,
  callingPaused,
  side,
}: {
  job: { id: string; title: string };
  candidates: CallCandidate[];
  canCall: boolean;
  callingPaused: boolean;
  side: React.ReactNode;
}) {
  const [on, setOn] = useState(false);
  return (
    <div className="calls" data-stage={on ? "on" : "off"}>
      <SingleCall key={job.id} job={job} candidates={candidates} canCall={canCall} callingPaused={callingPaused} onStageChange={setOn} />
      <div className="callside">{side}</div>
    </div>
  );
}
