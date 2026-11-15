import { passcodeOk, score, readBody } from "./_lib.js";

// A realistic ~3-minute sample call: weak resume on paper, strong on the phone.
const SAMPLE_TRANSCRIPT = `assistant: Hi Rahul, this is Priya calling from the hiring team about the Sales Executive role for our B2B SaaS product. Is this a good time to talk for about three minutes?
user: Haan, yes, absolutely. Good time. Thank you for calling.
assistant: Wonderful. To start, could you tell me a little about your sales experience so far?
user: Sure. So for the last two and a half years I have been doing field sales for water purifiers, door to door, in Pune. Mostly residential societies, some small offices also. My target was 40 units a month and last year I averaged 52, and in Diwali month I closed 71.
assistant: That's impressive. Can you walk me through a time a customer pushed back and how you handled it?
user: Yes, one uncle in Kothrud, he said straight away, bhai, RO wastes so much water, I am not buying. So I did not argue. I asked him how much water he is buying in cans every month. It was around 900 rupees. Then I showed him our model saves the reject water into a tank for mopping, and the purifier pays for itself in eleven months. He bought it, and then he referred three neighbours from his building. Honestly that referral part taught me more than the sale.
assistant: Thank you so much. Anything else in the next 20 seconds, and then we'll move on?
user: Just that I always ask questions first, then I talk. That is my style.
assistant: Got it. This role is selling software to businesses, which is different from door to door. How do you feel about that shift?
user: I know I don't have SaaS experience, that is true. But I have already started. I did the free HubSpot sales course last month and I am watching demos of CRM tools on YouTube every night. Selling is selling, na, you find the pain and you show the value. Only the buyer changes.
assistant: What would you want to know about this role or the team?
user: Actually I have two questions. One, what is the typical sales cycle here, is it weeks or months? And two, after the deal is closed, does the sales person stay in touch with the customer? Because one thing I really enjoy is helping customers after the sale, making sure they are actually using the product. In my current job I go back and check the filter for my customers even when it is not my duty.
assistant: Great questions. The cycle is usually four to six weeks, and there is a separate customer success team, though sales stays involved. Last one: are you comfortable working in English with clients?
user: Yes, fully comfortable. With some customers I switch to Hindi or Marathi, thoda mix, but for business calls English is no problem at all.
assistant: Thank you, Rahul. That's everything from my side. The team will review and get back to you soon.
user: Thank you so much, Priya. Really enjoyed this conversation. Have a nice day.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }
  res.setHeader("Cache-Control", "no-store");

  const body = readBody(req);
  if (body === null) return res.status(400).json({ error: "invalid JSON" });

  if (!passcodeOk(body.passcode)) {
    return res.status(401).json({ error: "invalid passcode" });
  }

  const transcript = SAMPLE_TRANSCRIPT;
  try {
    const scored = await score(transcript);
    return res.status(200).json({
      status: "completed",
      done: true,
      result: { ...scored, transcript, recording_url: null, duration_s: 190, resume_only_score: 34 },
    });
  } catch (e) {
    console.error("sample scoring failed:", e?.message || "unknown error");
    return res.status(200).json({
      status: "completed",
      done: true,
      result: null,
      error: "scoring failed",
      transcript,
      recording_url: null,
    });
  }
}
