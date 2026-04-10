# GlassBox — Best Practices

Lessons learned building a behavioral AI customer support system.

---

## Context design

**Each ticket type needs its own context.**
Don't share a single flat context object across all ticket types. A billing dispute needs account and charge data; an order status query needs shipment and tracking data. If the context is wrong for the ticket type, the model asks the customer for information it should already have — which is the worst possible experience.

**Isolate context strictly — no cross-contamination between ticket types.**
A billing dispute context should contain no order or shipment data. An escalation context should contain prior interaction history. If the context bleeds across types, the model either asks irrelevant questions or reveals data that belongs to a different flow. Each ticket type should have a schema that only includes the fields that flow needs — nothing more.

**Context should come from your systems, not the conversation.**
The model cannot look up order dates, purchase history, or account details. That data must be injected into the context at request time from your CRM or order management system. If the context is empty, the model interrogates the customer instead of helping them.

**Make policy explicit and machine-readable in context.**
Don't bury policy in the system prompt as prose. Express it as structured data the model can reason against:
```json
{
  "cancellation_eligible": false,
  "cancellation_policy": "Orders can only be cancelled before shipping. This order has already shipped."
}
```
The model applies the policy correctly when it's unambiguous. Prose descriptions leave room for the model to interpret — structured fields don't.

---

## Conversation handling

**Pass the full conversation history on every turn.**
The model has no memory between requests. Without history, every message is treated as the first — the model asks for information the customer already gave, repeating itself and frustrating them. Send the full prior exchange as `conversation_history` on every request.

**The judge also needs the full conversation history.**
This is the less obvious half of the problem. If the judge only sees the latest customer message and the latest response, it evaluates in a vacuum. On turn 2, a customer may ask for a refund — and the AI may correctly skip re-stating the order status because it was already given in turn 1. Without history, the judge penalises that as a Resolution Matching failure. With history, it can correctly credit steps completed in prior turns. Send `conversation_history` to the judge on every turn, not just the model.

**Evaluate the response in the context of the full conversation, not the current turn alone.**
Resolution paths describe a sequence of steps across a conversation, not a checklist every single response must complete in full. A response that correctly handles refund eligibility on turn 2 — after order status was confirmed on turn 1 — is a good response. Scoring it against the full resolution path without conversation context produces false negatives, erodes trust in the scoring system, and causes unnecessary retries.

**Never surface internal routing to the customer — handle or hand off, never redirect.**
Ticket types are an internal routing mechanism. The customer doesn't know about them and shouldn't. If a customer asks something outside the current context, the AI has two valid options: answer it if the context supports it, or escalate naturally — "Let me get someone who can pull up your order details." It should never say "I can only help with billing questions here" or "contact our support team" — the customer is already talking to support. Telling them to go elsewhere is circular and erodes trust. The category boundary is invisible to the customer; only the resolution is visible.

---

## UI and UX

**Never make the customer feel the architecture.**

The customer has a problem. Every internal boundary — ticket types, routing logic, context schemas, model selection — is invisible to them and should stay that way. If they feel the seams, the system has failed. Design every customer-facing interaction as if there is no system behind it — just a person being helped.

---

**Don't add affordances that do the customer's thinking for them.**
Suggestion chips, pre-fill buttons, and quick replies feel helpful but they're patronising — they put words in the customer's mouth and break the natural flow of support. If the AI needs to ask a clarifying question, let it. If the context is rich enough, it shouldn't need to.

**Separate what the customer sees from what the operator sees — even in a demo.**
The system prompt, judge reasoning, conformance scores, and retry details are operator data. Customers don't need to see them and shouldn't. Even when showing both in a transparent demo like GlassBox, label the distinction clearly so readers understand the architectural boundary.

**Give each ticket type multiple named scenarios in the scenario picker.**
For demos and testing, a single happy-path example per ticket type is not enough. Each type should have several named scenarios that cover meaningfully different states — for example, under Order & Delivery: "In transit — no issues", "Delivered, outside return window", "Delivered, item missing". A visible scenario picker lets operators and demo viewers understand exactly what context the AI is working from, and lets them deliberately exercise edge cases and policy boundaries. Without named scenarios, demos only ever show the happy path, and the interesting behaviour — what happens at the edges of policy — stays invisible.

---

## Policy design

**Model the full state machine for each ticket type.**
For every ticket type, define every state the order or account can be in and what the policy is for each:

| State | Action |
|---|---|
| Not yet shipped | Can cancel → full refund immediately |
| Shipped / in transit | Cannot cancel → must receive, then return |
| Delivered, within return window | Can return → refund on receipt at warehouse |
| Delivered, outside return window | Cannot return → explain policy, offer alternatives |

If a state isn't modelled, the model improvises — and improvisation on policy is where trust breaks down.

**Give customers a concrete next step, not a process description.**
Don't say "a refund will be processed after the warehouse receives the return." Say: here is your return reference number, here is your prepaid shipping label, drop it at any FedEx location, your refund triggers automatically. One message, conversation closed.

---

## Conversation storage

**Store the full conversation thread with every run, not just the latest turn.**
The `runs` table captures each turn as an independent row with the latest customer message and response. That's enough to score a single turn, but it destroys the context needed to understand *why* a score is what it is. On turn 2, a 50% Resolution Matching score looks like a failure — unless you can see that turn 1 already covered order status. Without the full thread, the score is correct in isolation and meaningless in practice.

Store `conversation_history` as a JSON blob on the run row, alongside the existing `context` field. This is cheap (text storage), requires no schema changes to the verdict tables, and makes every run fully self-contained and replayable.

**Conversation history has two jobs — model memory and audit trail.**
Sending history to the model on every request is how multi-turn memory works (the model has no state between calls). Storing it in the database is how you build an audit trail. These are the same data serving different purposes. Don't conflate them: the model gets history so it can answer correctly; the database stores history so you can reconstruct the full context for drift re-scoring, debugging, and review.

**Without stored history, drift re-scoring is unreliable for multi-turn sessions.**
Test suite runs use single-turn examples, so they're fine. But if you ever want to replay a live chat session through a new model or a new judge, you need the full thread — not just the final turn. A run row that has only `customer_message` and `response` for turn 3 is not replayable. A run row that also has `conversation_history` containing turns 1 and 2 is.

**Keep conversation history scoped to the session, not the customer.**
History should be reset when the ticket type changes, when a new scenario is selected, or when the session ends. Carrying history across different support topics produces incorrect context — the model may reference a previous order when the customer is now asking about billing. Each support session gets its own thread; history does not accumulate across sessions.

**Model sessions explicitly — don't store conversation history as a JSON blob on each turn.**
Storing the full conversation history as a column on every run row is tempting because it's simple, but it has three structural problems: there is no shared identity across turns (you can't query "all turns from this conversation"), storage grows redundantly (turn 3 stores turns 1 and 2 in full, turn 4 stores turns 1, 2, and 3), and sessions don't survive a page refresh because there is no server-side anchor.

The right design is a `sessions` table — one row per conversation — with individual turns linked to it by foreign key:

```
sessions
  id            PK
  created_at
  ticket_type
  scenario_id
  context_json  ← the injected mock/live context for this session

runs
  id            PK
  session_id    FK → sessions.id
  turn_number
  customer_message
  response
  latency_ms
  total_tokens
  ...verdict columns via conformance_results...
```

With this structure, reconstructing a full conversation is a single `WHERE session_id = ?` query. Drift re-scoring replays a session in order by `turn_number`. Alerts link to sessions, not to isolated turns. And sessions survive page refresh because the session ID is a durable server-side record.

The JSON-blob-per-turn approach works for a prototype but breaks down the moment you need to do anything meaningful with conversation-level data — which is exactly what behavioral observability requires.

---

## Drift and observability

**Test suite drift and live chat drift are different signals — keep them separate.**
Test suite snapshots are controlled (same inputs every run), so deltas are meaningful. Live chat is uncontrolled input, so comparing scores across sessions is noisy. Use test suite snapshots for drift detection; use live chat verdicts for production monitoring.

**Live chat drift is a leading indicator, not a replacement for test suite drift.**
Test suite drift is statistically meaningful because the inputs are fixed — the same 36 examples run every time, so score deltas reflect real model behaviour change. Live chat is uncontrolled: different questions, different phrasing, different customers. However, if a live chat message is semantically similar to a corpus example and the conformance score diverges significantly, that is a signal worth capturing separately as a live drift indicator. Most production systems keep the two streams separate but surface both to operators. Don't conflate them; do use both.

**Store everything, always.**
Every request, response, judge verdict, and per-property score should be logged. Storage is cheap; debugging a behavioral regression without data is not.
