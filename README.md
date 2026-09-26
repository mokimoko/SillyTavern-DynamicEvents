# Dynamic Events

Dynamic Events combines a narrative scheduler with continuous, state-driven
prompt composition. Event sets can contain recurring events, one-shots, plot
chains, STScript actions, State Tracks, and stateless Prompt Routers bound to
characters or native tags.

## Runtime behavior

- Scheduler state is stored per message and swipe, so alternate branches keep
  independent cooldowns, phases, counters, and spent flags.
- Response-capture variables are stored in the same branch snapshot. Changing
  swipes restores that branch's values or the value that existed before DE first
  captured the variable.
- Existing chat-metadata state is used as a migration fallback and maintained as
  a compatibility mirror.
- A validated SuperAgents tracker can be used as an optional condition source.
  Dynamic Events still decides whether and when an eligible event fires.
- Optional Recent Chat keyword conditions match literal words or phrases in the
  latest user message, latest assistant message, or a bounded recent window.
  They are evaluated locally with no model or provider call, scan at most 40
  message records, and share a per-cycle cache across Events, State Tracks,
  Prompt Routers, and Scripts.
- SuperAgents Calendar can be used as a branch-aware condition source. Calendar
  consequences require an explicit status such as missed or cancelled; Dynamic
  Events never decides that a fictional date label means time has passed.
- A Calendar-driven Event can request a branch-scoped reconciliation grant for
  its exact record. If the resulting narration establishes a concrete replacement
  plan, SuperAgents creates a linked scheduled successor and keeps the missed or
  cancelled source record in history. Suggestions and malformed directives fail closed.
- State Tracks do not compete with scheduled events or consume event concurrency.
  Each track selects one current state while multiple tracks compose in parallel.
- Prompt Routers continuously evaluate reusable condition layers without owning
  scheduler state. A stacking router injects every matching layer in priority
  order; an exclusive router injects only the highest-priority match.
- Routers are intentionally preset-agnostic. A SuperAgents initializer can
  classify a chat once into validated state, then any router can compose the
  authored prompt fragments that correspond to that state.
- State transitions can be reversible, sticky, one-way, or latched. A state can
  inject a complete current-state capsule continuously and a separate on-entry
  instruction only when the transition occurs.
- Events can run optional actions when they fire, and State Tracks can run the
  same actions when a state is entered. Prompt text and actions are independent.

## Actions

Built-in actions can ask the active **SuperAgents private communication surface** for a message or the active
**SuperAgents social surface** for a shared artifact. Both can target the active character, an Event or State
Track subject, a paired Event counterpart, or a manually named character. **Consider** bypasses the ambient
gate but still lets the character preserve silence or privacy. The stable Phone **Send** and
Feed **Publish** behaviors require an artifact and retry once on malformed or empty output; presentation descriptors determine whether that means a text, recorded call, digital post, pinned notice, or another supported medium.
Actions feature-detect SuperAgents, so a missing or disabled surface is skipped
without breaking normal Event, State Track, or Prompt Router injection.

## Events, State Tracks, Prompt Routers, and subjects

State rules support nested **ALL**, **ANY**, and inverted groups. Validated
SuperAgents schemas populate source and field menus; the editor also shows each
rule's current value and pass/fail result.

Recent Chat rules accept up to 50 literal words or phrases, can require any or
all of them, and default to case-insensitive whole-word/phrase matching. A
recent-window rule can inspect 1–20 visible non-system messages. Set a
conditioned Event's interval and initial delay to zero when a fresh phrase
should prepare an Event for the immediately following response; cooldown and
probability still control repeats.

Portable paths use `characters.$subject.trust`, never a hardcoded card name.
Each Event, State Track, and Prompt Router decides what `$subject` means:

- **Active card / current group speaker** for ordinary character cards and groups.
- **Tracked narrative character** for scenario cards, multi-character cards, or
  a specific participant in a group.
- **Manual state key** for custom ledgers whose keys are not card names.
- **Eligible entry from a state source** for ensemble Events. The Event checks
  its condition separately for every record in the selected validated collection,
  then chooses the least recently used eligible entry. Optional endpoint fields
  let a relationship edge expose two narrative characters.

In group chats, a character-bound set is active when its bound card is an
enabled group member. A tag-bound set can match tags on the group or any enabled
member. Set bindings control where the set runs; each component still chooses
its own narrative subject. In a character-bound group set with one matching
member, the Active Card subject resolves to that member.

`{{subject}}` in Event, State Track, or Prompt Router text resolves to that narrative subject.
Paired Events also provide `{{counterpart}}`; `{{subjectState.field}}` reads a
field from the selected state record. Provider `$subject` paths continue to use
the selected record key, so one binding can inspect an edge, name both endpoints,
and target an action at either endpoint. Existing SillyTavern macros such as `{{user}}` remain available.
Dynamic selection keeps the Event's interval, probability, cooldown, and
one-shot status global; it rotates the character when that Event fires rather
than creating an independent scheduler for every NPC.
For record-driven consequences, **Fire once per resolved subject** lets a
recurring Event handle each stable collection key once without repeatedly
reacting to the same unchanged record.

Component-list controls are deliberately separate: the square checkbox selects
an Event, State Track, Prompt Router, or Script for bulk actions; the pill switch enables or
disables it; and clicking the row opens or closes its editor. The header's
icon-only controls select/deselect all components, enable/disable all components,
or delete the checked components. Each component section has its own Add button.
Hover an icon for its label.
No Ctrl-click or Shift-click is required.

Each Event Set can also own named **Shared Instructions**. Attach any number of
these blocks beneath an Event's unique text; when several linked Events fire in
the same generation, each block is inserted only once per injection destination.
Use the layered-text button in the Set toolbar to create, edit, or delete blocks
and see how many Events use each one. Shared blocks are exported with their Set,
and preset installation brings along only the blocks required by the selected
Events. Keep subject-specific directions in Event Text; Shared Instructions are
best for reusable continuity, tone, agency, safety, and formatting guidance.

Each State Track has the same injection controls as an Event: Extension Prompt
or `{{dynamicEvents}}` macro mode, prompt position, depth, and message role. New
tracks default to **System → In Chat → depth 1**.

Prompt Routers use those same injection controls. Each layer has an authored
prompt fragment, a priority, and a nested **ALL**/**ANY** condition tree backed
by validated SuperAgents state. Routers re-evaluate on chat/branch changes and
immediately after a SuperAgents state commit; they do not consume Event slots,
cooldowns, probabilities, or one-shot flags.
Macro-mode routers may use the shared `{{dynamicEvents}}` outlet or an optional
named outlet. Entering `scene_mode`, for example, registers `{{de_scene_mode}}`.
Each named outlet contains only the matching text from routers assigned to that
name, so several dynamic sections can be placed independently throughout an
ordinary SillyTavern prompt preset. An unmatched outlet resolves to an empty
string.
With SuperAgents integration API version 10, a pre-gen classifier commit uses
the newly validated live value and refreshes synchronously, so matching layers
are present in that same upcoming main generation rather than one turn later.

## Presets

Open **Manage Events → Presets** and choose the Events, Prompt Routers, State
Tracks, or Scripts tab to install a disabled, editable copy of:

The installer initially selects the components from the tab you opened, plus
anything they require. Use the icon beside **Choose components** to change the
selection.

- Time Skip (a manual Script button that privately plans a neutral narrator
  transition, offers an editable preview, narrator name, and exact responder
  choice, then starts a normal swipeable character reply with a temporary
  direction to establish a playable new scene. The direction remains available
  for swipes and clears after the user's next message. It uses SuperAgents World
  State as a time baseline when active, while still working without SuperAgents.)
- Story Complications
- Chekhov Setup → Payoff
- Event Spark
- Erotic Sparks (nine independent, safe-disabled adult story openings: direct
  invitations, loaded challenges, Scene State arousal, privacy plus arousal,
  attraction becoming initiative, jealousy pressure, two tracker-free scheduled
  wildcards, and a manual send-bar wildcard; every component preserves player
  authorship and explicitly avoids treating sex as romance)
- They Make the First Move (seven safe-disabled, tracker-free initiative beats:
  breaking a self-imposed rule, a thin excuse, terrible timing, a challenge,
  admitting a selfish want, returning to unfinished tension, and a manual button;
  each asks an adult NPC to take one concrete action while leaving the player's
  response open)
- Bad Ideas (eight independent, safe-disabled darker adult sexual beats:
  affairs, revenge, secrets as leverage, unequal power, possessive jealousy,
  deliberate temptation, mutual ruin, and a manual wildcard; automatic beats
  use Relationship Ledger desire, jealousy, or sexual history and optional Scene
  State arousal to decide when to run; the manual button needs no tracker)
- Sexual Complications (ten independent, safe-disabled texture beats for scenes
  already underway: rhythm, physical limits, mess, changing control, specific
  wants, awkward reality, practical risk, group geometry, near-discovery, and a
  manual wildcard; eligibility accepts local sexual language or optional Prompt
  Base, After Dark, and Scene State signals without requiring any of them)
- Aftermath & Echoes (ten safe-disabled adult cooldown components: first
  reactions, physical residue, first words, lingering appetite, group dynamics,
  control residue, returning to ordinary business, a captured evidence-and-echo
  pair, and a manual wildcard; bounded local transition cues work independently,
  while Prompt Base, After Dark, and Scene State can optionally confirm them)
- Dirty Messages (six presentation-aware, safe-disabled private communication
  opportunities for off-screen adults: a blunt invitation, unfinished business,
  a loaded follow-up, a practical question, terrible timing, and almost saying
  too much; every component uses Phone's `consider` behavior so the active story
  surface and character may communicate appropriately or withhold)
- Adaptive Prompt Kit (thirteen independently placeable Prompt Routers backed by
  the optional staged SuperAgents Prompt Base + Prompt NSFW classifiers)
- World Conditions (four safe-disabled examples that consume validated
  SuperAgents World State: nighttime consequences, severe-weather effects,
  outdoor temperature exposure, and vehicle/travel constraints; the pack reacts
  to established conditions but never changes the weather or treats inferred
  time as deadline authority)
- Phone Story Beats (three independent examples: Off-Screen Check-In,
  Unfinished Conversation, and Urgent Practical Message)
- Lives Beyond the Scene (five examples that automatically choose among eligible
  characters in validated Parallel Off-Screen state: initiative, obligations,
  consequences, approaching intersections, and optional own-life Phone updates)
- Social Ripples (two privacy-aware Feed examples that rotate through eligible
  Parallel Off-Screen characters and let the Feed decide whether to publish)
- Social Web Ripples (four pressure-driven NPC-to-NPC beats for obligations,
  private friction, fault lines, and alliance consequences)
- Knowledge Pressure (five capability-gated beats for suspicion, investigation,
  guarded behavior, strained cover stories, and evidence opportunities; it uses
  a redacted SuperAgents projection and never schedules automatic disclosure)
- Commitment Consequences (four once-per-commitment beats for explicit
  postponed, missed, cancelled, and completed Calendar statuses; authored time
  expressions are preserved but never interpreted as proof that time elapsed;
  an explicitly established replacement plan can safely flow back into Calendar)
- Relationship Progression (five independently selectable models: Romantic
  Awakening; Love Under Constraint with continuous modes plus three pressure
  beats; Slow Trust, where verified safety unlocks specific access while
  affection can remain high behind intact boundaries; and After Betrayal, which
  separates consequences, accountability, restitution, forgiveness, and the
  relationship's eventual new terms; plus Devotion vs Duty, where two sincere
  commitments can align, conflict, produce either costly choice, acquire new
  terms, or reconcile without retroactively making either commitment false.
  After Betrayal and Devotion vs Duty each include five optional story beats)
- Layered Social Bond (two composable, non-romance tracks for relational safety,
  rupture/repair, and the everyday texture of closeness)

The installer lets you choose individual components and add them to an existing
set or a newly named set. Subject-aware packs can use a fixed narrative character
or runtime selection from a validated collection, including paired relationship
edges, and apply that binding
to every selected component. Compatible validated
sources are selected automatically when available. Review subject and source fields
before enabling; attraction, trust, and milestones may
come from different SuperAgents without duplicating fields. Installs generate
fresh IDs and remap dependencies within a pack, so multiple copies can coexist safely. Every added
component starts disabled.

### Bodies & Pairings

**Bodies & Pairings** is a router-only adult preset for prompt presets that want
conditional physical guidance without carrying every variation all the time.
Install and enable Prompt Base and Prompt NSFW in SuperAgents, then add the pack
from Dynamic Events → Presets. Its four components are independently selectable
and install disabled:

- `{{de_nsfw_physical}}` — shared physical continuity, pacing, limits, and
  player-authorship boundaries.
- `{{de_nsfw_focus_body}}` — male, female, nonbinary, intersex, genderless, or
  unknown focus-character guidance without treating identity as a complete
  anatomy chart.
- `{{de_nsfw_pairing_context}}` — m/m, m/f, f/f, or other/unclear physical
  configuration guidance.
- `{{de_nsfw_participant_context}}` — solo, paired, group, or unclear active
  participation, with group positioning and attention kept legible.

Place the outlets in the sexuality/physical-writing area of an ordinary prompt
preset. Prompt NSFW runs only behind a fresh Prompt Base `nsfw=true` gate, and
unknown anatomy, history, or participation remains unknown instead of being
invented. These outlet names deliberately differ from the older Adaptive Prompt
Kit equivalents so both presets can coexist without producing duplicate text.

### Adaptive Prompt Kit

This is an editable example of the engine, not a required master prompt:

1. In SuperAgents Library, add **Prompt Base** and **Prompt NSFW**, choose their
   connection profiles, and enable both. Base runs every turn. Prompt NSFW waits
   for Base to store a fresh `nsfw=true` result, so non-NSFW turns do not make the
   specialized call or ask its questions. Neither raw result enters the writer
   prompt.
2. In Dynamic Events Presets, add **Adaptive Prompt Kit**. Enable the new set and
   whichever Prompt Routers you want.
3. Keep your normal instructions in your SillyTavern preset and place the named
   outlets at the exact locations where their authored fragments belong. For
   example:

```text
<turn_style>
{{de_author}}
{{de_focus_character}}
</turn_style>

...character, world, examples, and chat history...

<current_response>
Your normal next-response rules stay here.
{{de_character_mood}}
{{de_character_impaired}}
{{de_character_injured}}
{{de_violence}}
</current_response>

<sexuality>
{{de_nsfw_core}}
{{de_nsfw_character_sex}}
{{de_nsfw_pairing}}
{{de_nsfw_virginity}}
{{de_nsfw_first_time}}
{{de_nsfw_close_friends}}
{{de_nsfw_family}}
</sexuality>
```

The kit’s prose is concise and editable. Its `other_or_unclear` pairing route
and `unknown` character-sex value avoid inventing anatomy when m/f, m/m, or f/f
does not accurately fit. The reusable part is the Base classifier → fresh-state
gate → optional specialist → authored routers → named outlets pipeline.

## Integration API

Feature-detect `window.DynamicEvents.integration` and check `apiVersion` before
using it. API version 5 provides event, State Track, and Prompt Router discovery, current track
state, schema-backed condition-source descriptions, branch runtime state,
lifecycle event names, and subject-filtered active State Track capsules for
consumers such as SuperAgents Phone and Feed. It also exposes an action-handler registry
so future extensions can add action types without coupling to Dynamic Events internals.
UI shells can separately feature-detect `window.DynamicEvents.ui.openPopup()`
to open the manager without clicking or importing its internal wand-menu control.

When SuperAgents presentation API version 1 is available, Dynamic Events keeps
its stable action/provider IDs but presents the active chat's surface names,
delivery vocabulary, readiness labels, and Calendar source label. An open editor
refreshes on `superagents:presentation-changed`; older SuperAgents versions retain
the Modern Phone/Feed/Calendar fallback copy. This same bridge supports the
Grounded Historical Correspondence, Society Pages, Notices, and Engagement Book
profile without adding historical-only action IDs or migrating existing Events.

Lifecycle events are:

- `dynamicevents:event-fired`
- `dynamicevents:phase-changed`
- `dynamicevents:event-spent`
- `dynamicevents:state-restored`
- `dynamicevents:track-changed`

The events contain metadata only. Read state through the API.
