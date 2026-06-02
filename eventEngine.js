/**
 * Dynamic Events — Event Engine
 * Pure logic for evaluating, scheduling, and tracking event state.
 * No ST dependencies here — all ST interaction happens in index.js.
 */

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

/** Event schedule types */
export const ScheduleType = {
    RECURRING: 'recurring',
    ONE_SHOT: 'one-shot',
    PLOT_CHAIN: 'plot-chain',
};

/** Event categories (for priority grouping) */
export const EventCategory = {
    PLOT: 'plot',
    FLAVOR: 'flavor',
    WORLD: 'world',
    CUSTOM: 'custom',
};

/** Category priority — higher number wins */
export const CATEGORY_PRIORITY = {
    [EventCategory.PLOT]: 300,
    [EventCategory.WORLD]: 200,
    [EventCategory.CUSTOM]: 100,
    [EventCategory.FLAVOR]: 50,
};

/** Bind modes for event sets */
export const BindMode = {
    MANUAL: 'manual',
    CHARACTER: 'character',
};

/** Set roles for organizational hierarchy */
export const SetRole = {
    PRIMARY: 'primary',
    SECONDARY: 'secondary',
};

/** Injection modes */
export const InjectionMode = {
    EXTENSION_PROMPT: 'extension-prompt',
    MACRO: 'macro',
};

/** Condition types for event/phase gating */
export const ConditionType = {
    NONE: 'none',
    PHASE_REACHED: 'phase-reached',
    HAS_FIRED: 'has-fired',
    FIRE_COUNT: 'fire-count',
    IS_SPENT: 'is-spent',
    NOT_SPENT: 'not-spent',
};

/** What to do when a phase condition fails */
export const ConditionBehavior = {
    STALL: 'stall',
    SKIP: 'skip',
};

// ST prompt position enums (mirrored from script.js)
export const PromptPosition = {
    IN_PROMPT: 0,
    IN_CHAT: 1,
    BEFORE_PROMPT: 2,
};

export const PromptRole = {
    SYSTEM: 0,
    USER: 1,
    ASSISTANT: 2,
};

// ═══════════════════════════════════════════════════════════════
// FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

let _idCounter = 0;
let _chatStateRef = null; // temporary ref during evaluation cycle

/** Generate a unique-ish ID */
export function generateId(prefix = 'evt') {
    return `${prefix}_${Date.now().toString(36)}_${(++_idCounter).toString(36)}`;
}

/** Create a new event set with defaults */
export function createEventSet(overrides = {}) {
    return {
        id: generateId('set'),
        name: 'New Event Set',
        enabled: true,
        role: SetRole.PRIMARY,
        parentSetId: null,
        bindMode: BindMode.MANUAL,
        characterBindings: [],
        events: [],
        ...overrides,
    };
}

/** Create a new event with defaults */
export function createEvent(overrides = {}) {
    return {
        id: generateId('evt'),
        name: 'New Event',
        enabled: true,
        category: EventCategory.FLAVOR,
        priority: 50,
        text: '',

        schedule: {
            type: ScheduleType.RECURRING,
            intervalMin: 20,
            intervalMax: 40,
            probability: 1.0,
            cooldown: 5,
            initialDelay: 0,
        },

        injection: {
            mode: InjectionMode.EXTENSION_PROMPT,
            position: PromptPosition.IN_CHAT,
            depth: 1,
            role: PromptRole.SYSTEM,
        },

        condition: createCondition(),

        capture: {
            enabled: false,
            varName: '',
        },

        // For plot-chain type
        phases: [],

        ...overrides,
    };
}

/** Create a new plot phase */
export function createPhase(overrides = {}) {
    return {
        id: generateId('ph'),
        name: 'New Phase',
        text: '',
        durationMin: 15,
        durationMax: 25,
        probability: 1.0,
        condition: createCondition(),
        ...overrides,
    };
}

/** Create a condition object */
export function createCondition(overrides = {}) {
    return {
        type: ConditionType.NONE,
        targetEventId: '',
        targetPhase: 0,
        targetCount: 1,
        invert: false,
        behavior: ConditionBehavior.STALL,
        ...overrides,
    };
}

// ═══════════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

/** Create fresh runtime state for an event */
export function createEventState(event) {
    const interval = randomInRange(event.schedule.intervalMin, event.schedule.intervalMax);
    return {
        lastFired: -Infinity,
        nextEligible: event.schedule.initialDelay + interval,
        fireCount: 0,
        // One-shot
        spent: false,
        // Plot-chain
        currentPhase: 0,
        phaseMessageCount: 0,
        phaseNextAdvance: event.phases?.length
            ? randomInRange(event.phases[0]?.durationMin ?? 15, event.phases[0]?.durationMax ?? 25)
            : 0,
    };
}

/** Get or initialize per-event state */
export function getEventState(chatState, event) {
    if (!chatState.eventStates[event.id]) {
        chatState.eventStates[event.id] = createEventState(event);
    }
    return chatState.eventStates[event.id];
}

/** Create fresh per-chat state */
export function createChatState() {
    return {
        messageCount: 0,
        eventStates: {},
    };
}

// ═══════════════════════════════════════════════════════════════
// CONDITION EVALUATION
// ═══════════════════════════════════════════════════════════════

/**
 * Check if a condition is met.
 * @param {object} condition - The condition object
 * @param {object} chatState - Per-chat runtime state
 * @returns {boolean} True if the condition is satisfied (or type is 'none')
 */
export function evaluateCondition(condition, chatState) {
    if (!condition || condition.type === ConditionType.NONE) return true;

    const targetState = chatState.eventStates[condition.targetEventId];
    let result = false;

    switch (condition.type) {
        case ConditionType.PHASE_REACHED:
            result = targetState ? targetState.currentPhase >= condition.targetPhase : false;
            break;
        case ConditionType.HAS_FIRED:
            result = targetState ? targetState.fireCount > 0 : false;
            break;
        case ConditionType.FIRE_COUNT:
            result = targetState ? targetState.fireCount >= condition.targetCount : false;
            break;
        case ConditionType.IS_SPENT:
            result = targetState ? targetState.spent === true : false;
            break;
        case ConditionType.NOT_SPENT:
            result = targetState ? targetState.spent !== true : true;
            break;
        default:
            result = true;
    }

    return condition.invert ? !result : result;
}

// ═══════════════════════════════════════════════════════════════
// EVALUATION ENGINE
// ═══════════════════════════════════════════════════════════════

/**
 * Evaluate all active events and return which ones should fire.
 * Call this once per message (on AI response).
 *
 * @param {object[]} eventSets - All event sets
 * @param {object} chatState - Per-chat runtime state (will be mutated)
 * @param {string} currentCharacter - Current character name (for binding resolution)
 * @param {number} maxConcurrent - Maximum events that can fire per message
 * @returns {{ fired: object[], texts: Map<string, {text: string, injection: object}> }}
 */
export function evaluateEvents(eventSets, chatState, currentCharacter, maxConcurrent = 2, chatLength = null) {
    // Advance the scheduling clock. When a real chat length is supplied, sync to
    // it (taking the max so we never run backwards on a swipe/regen) — this keeps
    // the internal tick from drifting away from the visible message number across
    // chat switches. Without it, fall back to a simple increment.
    if (typeof chatLength === 'number' && chatLength > 0) {
        chatState.messageCount = Math.max(chatState.messageCount + 1, chatLength);
    } else {
        chatState.messageCount++;
    }
    const msgCount = chatState.messageCount;
    _chatStateRef = chatState; // make available to sub-evaluators

    // Collect all candidate events from active sets
    const candidates = [];

    for (const set of eventSets) {
        if (!isSetActive(set, currentCharacter)) continue;

        for (const event of set.events) {
            if (!event.enabled) continue;

            // Check event-level condition first
            if (!evaluateCondition(event.condition, chatState)) continue;

            const state = getEventState(chatState, event);
            const result = evaluateSingleEvent(event, state, msgCount);

            if (result.shouldFire) {
                candidates.push({
                    event,
                    state,
                    text: result.text,
                    effectivePriority: CATEGORY_PRIORITY[event.category] + event.priority,
                });
            }
        }
    }

    // Sort by effective priority (descending)
    candidates.sort((a, b) => b.effectivePriority - a.effectivePriority);

    // Take top N
    const fired = candidates.slice(0, maxConcurrent);

    // Update state for fired events
    const texts = new Map();
    for (const { event, state, text } of fired) {
        state.lastFired = msgCount;
        state.fireCount++;

        // Schedule next eligible time
        if (event.schedule.type === ScheduleType.RECURRING) {
            const interval = randomInRange(event.schedule.intervalMin, event.schedule.intervalMax);
            state.nextEligible = msgCount + Math.max(event.schedule.cooldown, interval);
        } else if (event.schedule.type === ScheduleType.ONE_SHOT) {
            state.spent = true;
        } else if (event.schedule.type === ScheduleType.PLOT_CHAIN) {
            // Advance phase counter
            state.phaseMessageCount++;
            // Check if phase should advance
            if (state.phaseMessageCount >= state.phaseNextAdvance && state.currentPhase < event.phases.length - 1) {
                state.currentPhase++;
                state.phaseMessageCount = 0;
                const nextPhase = event.phases[state.currentPhase];
                state.phaseNextAdvance = randomInRange(nextPhase.durationMin, nextPhase.durationMax);
            }
        }

        texts.set(event.id, { text, injection: event.injection });
    }

    _chatStateRef = null; // cleanup
    return { fired: fired.map(c => c.event), texts };
}

/**
 * Evaluate a single event against its schedule.
 * @returns {{ shouldFire: boolean, text: string }}
 */
function evaluateSingleEvent(event, state, msgCount) {
    const schedule = event.schedule;

    switch (schedule.type) {
        case ScheduleType.RECURRING:
            return evaluateRecurring(event, state, msgCount);
        case ScheduleType.ONE_SHOT:
            return evaluateOneShot(event, state, msgCount);
        case ScheduleType.PLOT_CHAIN:
            return evaluatePlotChain(event, state, msgCount);
        default:
            return { shouldFire: false, text: '' };
    }
}

function evaluateRecurring(event, state, msgCount) {
    // Not yet eligible
    if (msgCount < state.nextEligible) {
        return { shouldFire: false, text: '' };
    }

    // Cooldown check
    if (msgCount - state.lastFired < event.schedule.cooldown) {
        return { shouldFire: false, text: '' };
    }

    // Probability roll
    if (Math.random() > event.schedule.probability) {
        // Failed the roll — push eligibility out by a fresh interval so the
        // interval governs cadence (not just the first fire). Otherwise a
        // recurring event re-rolls every single message once eligible, and
        // only `cooldown` throttles it.
        const interval = randomInRange(event.schedule.intervalMin, event.schedule.intervalMax);
        state.nextEligible = msgCount + Math.max(1, interval);
        return { shouldFire: false, text: '' };
    }

    return { shouldFire: true, text: event.text };
}

function evaluateOneShot(event, state, msgCount) {
    if (state.spent) return { shouldFire: false, text: '' };

    // Eligibility. nextEligible is seeded as (initialDelay + interval) in
    // createEventState, so that single check already covers the initial delay —
    // no separate initialDelay gate needed here.
    if (msgCount < state.nextEligible) {
        return { shouldFire: false, text: '' };
    }

    // Probability roll
    if (Math.random() > event.schedule.probability) {
        return { shouldFire: false, text: '' };
    }

    return { shouldFire: true, text: event.text };
}

function evaluatePlotChain(event, state, msgCount) {
    if (!event.phases?.length) return { shouldFire: false, text: '' };
    if (state.currentPhase >= event.phases.length) return { shouldFire: false, text: '' };

    // Check initial delay (only for first activation)
    if (state.fireCount === 0 && msgCount < event.schedule.initialDelay) {
        return { shouldFire: false, text: '' };
    }

    // Cooldown
    if (state.lastFired > 0 && msgCount - state.lastFired < event.schedule.cooldown) {
        return { shouldFire: false, text: '' };
    }

    // Phase condition check — may skip phases if behavior is 'skip'
    // We use _chatStateRef set by evaluateEvents before calling this
    let phase = event.phases[state.currentPhase];
    if (phase.condition && phase.condition.type !== ConditionType.NONE && _chatStateRef) {
        if (!evaluateCondition(phase.condition, _chatStateRef)) {
            if (phase.condition.behavior === ConditionBehavior.SKIP) {
                // Skip forward through phases until we find one that passes or run out
                while (state.currentPhase < event.phases.length - 1) {
                    state.currentPhase++;
                    state.phaseMessageCount = 0;
                    phase = event.phases[state.currentPhase];
                    const nextDur = phase;
                    state.phaseNextAdvance = randomInRange(nextDur.durationMin, nextDur.durationMax);
                    if (!phase.condition || phase.condition.type === ConditionType.NONE || evaluateCondition(phase.condition, _chatStateRef)) {
                        break; // Found a phase that passes
                    }
                    if (phase.condition.behavior !== ConditionBehavior.SKIP) {
                        // Hit a stall phase — stop here
                        return { shouldFire: false, text: '' };
                    }
                }
                // Re-check the phase we landed on
                if (phase.condition && phase.condition.type !== ConditionType.NONE && !evaluateCondition(phase.condition, _chatStateRef)) {
                    return { shouldFire: false, text: '' };
                }
            } else {
                // Stall — condition not met, don't fire
                return { shouldFire: false, text: '' };
            }
        }
    }

    // Phase probability
    if (Math.random() > phase.probability) {
        return { shouldFire: false, text: '' };
    }

    return { shouldFire: true, text: phase.text };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

/** Check if an event set should be active given the current character */
export function isSetActive(set, currentCharacter) {
    if (!set.enabled) return false;
    if (set.bindMode === BindMode.MANUAL) return true;
    if (set.bindMode === BindMode.CHARACTER) {
        if (!set.characterBindings?.length) return true;
        // Case-insensitive match against character name
        const charLower = (currentCharacter || '').toLowerCase();
        return set.characterBindings.some(b => b.toLowerCase() === charLower);
    }
    return true;
}

/** Random integer in [min, max] inclusive. Swaps if given backwards. */
export function randomInRange(min, max) {
    min = Math.floor(min);
    max = Math.floor(max);
    if (Number.isNaN(min)) min = 0;
    if (Number.isNaN(max)) max = min;
    if (min > max) { const t = min; min = max; max = t; }
    if (min === max) return min;
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Get a human-readable status string for an event.
 */
export function getEventStatus(event, chatState) {
    if (!chatState) return 'No active chat';
    const state = chatState.eventStates[event.id];
    if (!state) return 'Not initialized';

    const msgCount = chatState.messageCount;

    if (event.schedule.type === ScheduleType.ONE_SHOT && state.spent) {
        return `Fired (message #${state.lastFired})`;
    }

    if (event.schedule.type === ScheduleType.PLOT_CHAIN) {
        const phaseName = event.phases?.[state.currentPhase]?.name || `Phase ${state.currentPhase + 1}`;
        return `${phaseName} — fired ${state.fireCount}x`;
    }

    if (state.lastFired <= 0) {
        const remaining = state.nextEligible - msgCount;
        return remaining > 0 ? `First eligible in ~${remaining} msgs` : 'Ready to fire';
    }

    const sinceLast = msgCount - state.lastFired;
    const untilNext = state.nextEligible - msgCount;
    if (untilNext > 0) {
        return `Last: ${sinceLast} ago — next in ~${untilNext} msgs`;
    }
    return `Last: ${sinceLast} ago — eligible now`;
}
