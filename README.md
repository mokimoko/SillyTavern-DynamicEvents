# Dynamic Events

Want a story complication to show up at the right time instead of immediately? Dynamic Events lets you set up events that wait for a turn, a condition, or a bit of luck before nudging the next reply. You can make one-off surprises, recurring events, or chains where one event sets up another.

It also has **State Tracks** for prompt text that changes with the story, **Prompt Routers** for choosing between different instructions, and **Scripts** for actions you can run at a particular point. You can build your own or start with an editable preset.

## Installation

In SillyTavern, open **Extensions → Install Extension** and paste:

```text
https://github.com/mokimoko/SillyTavern-DynamicEvents
```

Install it and reload if prompted.

## Getting started

1. Open **Extensions → Dynamic Events** and turn on **Enable Dynamic Events**.
2. Click **Manage Events**. Open **Presets** if you want something to start from, or add an Event Set of your own.
3. Presets install as disabled copies, so look through the pieces you want and enable them. You can edit their text and conditions like anything else you create.

Events can be scoped to a character or tag. Their timing and cooldowns are kept per chat branch, so swiping to another branch doesn't carry over the old one's event progress.

## SuperAgents

[SuperAgents](https://github.com/mokimoko/SillyTavern-SuperAgents) is optional. Its trackers can give Dynamic Events validated story state to check, such as World State or Relationship Ledger values. Some presets use those trackers; the manager shows their requirements. Dynamic Events also has events and presets you can use without SuperAgents.

## More detail

The [reference guide](documentation/REFERENCE.md) covers conditions, State Tracks, Prompt Routers, actions, presets, and the integration API.

See the [changelog](CHANGELOG.md) and [license](LICENSE).