import { getMembership } from "@/components/server/session";
import { createClient } from "@/lib/supabase/server";
import { loadRecentMessages, messagingStatus } from "@/lib/messaging/admin";

const KIND: Record<string, string> = { heads_up: "Heads-up", otp: "Phone code", other: "Message" };
const STATUS: Record<string, { label: string; cls: string }> = {
  sent: { label: "Sent", cls: "state-ok" },
  logged: { label: "Logged only", cls: "state-off" },
  queued: { label: "Sending", cls: "state-off" },
  failed: { label: "Failed", cls: "state-bad" },
};
const when = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(iso));

/** Settings → Candidate messages. Status for every member; the message log for admins only. */
export async function MessagingSection() {
  const me = await getMembership();
  if (!me) return null;
  const status = messagingStatus();
  const isAdmin = me.role === "admin";
  const messages = isAdmin ? await loadRecentMessages(await createClient(), me.companyId, 20) : [];

  const verification =
    status.otp === "on"
      ? { label: "On", cls: "state-ok", note: "Applicants confirm their mobile number with a 6-digit code." }
      : status.otp === "dev"
        ? { label: "Test mode", cls: "state-off", note: "No SMS provider: the code is shown on screen (development only)." }
        : { label: "Off", cls: "state-off", note: "Phone verification off: no SMS provider. Applications still go through, with rate limits." };

  return (
    <section className="card full" aria-labelledby="s-messages">
      <div className="s-head">
        <h2 id="s-messages">Candidate messages</h2>
        <p>Heads-up text before each call, with a link to pick another time, and the phone code on the apply form.</p>
      </div>
      {status.notices.length ? (
        <ul className="mx-[22px] mt-3 mb-1 rounded-md bg-peach-bg px-4 py-3 text-[13px] text-peach-ink">
          {status.notices.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      <div className="srow">
        <div>
          <b>Text provider</b>
          <p>{status.live ? `Messages go out by ${status.channel === "whatsapp" ? "WhatsApp" : "SMS"}.` : "Messages are written to the log below; nothing reaches candidates yet."}</p>
        </div>
        <span className={`val ${status.live ? "state-ok" : "state-off"}`}>
          <i className="dot" aria-hidden="true" />
          {status.live ? status.selected_label : "Not connected"}
        </span>
      </div>
      <div className="srow">
        <div>
          <b>Phone verification</b>
          <p>{verification.note}</p>
        </div>
        <span className={`val ${verification.cls}`}>
          <i className="dot" aria-hidden="true" />
          {verification.label}
        </span>
      </div>

      {isAdmin ? (
        messages.length ? (
          <div className="tablewrap">
            <table className="s-table" style={{ marginTop: 6 }}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th>To</th>
                  <th>Message</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((m) => {
                  const st = STATUS[m.status] ?? { label: m.status, cls: "" };
                  return (
                    <tr key={m.id}>
                      <td className="num" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>
                        {when(m.created_at)}
                      </td>
                      <td>{KIND[m.kind] ?? m.kind}</td>
                      <td className="num" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>
                        {m.to}
                      </td>
                      <td className="text-text-2" style={{ maxWidth: 420 }}>
                        <span className="line-clamp-2">{m.body}</span>
                      </td>
                      <td className={st.cls} style={{ whiteSpace: "nowrap" }}>
                        {st.label}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="hint" style={{ padding: "8px 22px 18px" }}>
            No messages yet. They appear here when calls are queued or applicants ask for a code.
          </p>
        )
      ) : (
        <p className="hint" style={{ padding: "8px 22px 18px" }}>
          Only admins can see the message log.
        </p>
      )}
    </section>
  );
}
