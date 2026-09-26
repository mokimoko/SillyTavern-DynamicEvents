/**
 * Dynamic Events — Event Engine
 * Pure logic for evaluating, scheduling, and tracking event state.
 * No ST dependencies here — all ST interaction happens in index.js.
 */

import {
    evaluateProviderCondition,
    inspectProviderCondition,
    listConditionSubjectEntries,
    ProviderOperator,
} from './src/conditions/providers.js';
import {
    createSubject,
    renderSubjectText,
    resolveSubject,
    SubjectMode,
} from './src/subjects/subjects.js';
import {
    inspectKeywordCondition,
    KeywordMode,
    KeywordScope,
} from './src/conditions/keywordMatch.js';
import {
    appendSharedInstructions,
    resolveEventSharedInstructions,
} from './src/runtime/sharedInstructions.js';

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
    TAG: 'tag',
};

/** Set roles for organizational hierarchy */
export const SetRole = {
    PRIMARY: 'primary',
    SECONDARY: 'secondary',
};

/**
 * Script trigger timings.
 *
 * A round only has two hookable moments: right after the user's message lands
 * (before the AI generates) and right after the AI's reply lands. "after_user"
 * and "before_ai" are the same instant, so we name them honestly by what the
 * Script cares about — the generation:
 *   BEFORE_AI  — user just sent; runs before the upcoming prompt is assembled.
 *   AFTER_AI   — AI just replied.
 *   CHAT_CHANGED / CHAT_CREATED — lifecycle, fire once on that event.
 *   MANUAL     — only runs from its send-bar button.
 */
export const ScriptTiming = {
    BEFORE_AI: 'before_ai',
    AFTER_AI: 'after_ai',
    CHAT_CHANGED: 'chat_changed',
    CHAT_CREATED: 'chat_created',
    MANUAL: 'manual',
};

/** Timings whose interval/cooldown count message ticks (vs. lifecycle/manual). */
export function isCountingTiming(timing) {
    return timing === ScriptTiming.BEFORE_AI || timing === ScriptTiming.AFTER_AI;
}

/** Injection modes */
export const InjectionMode = {
    EXTENSION_PROMPT: 'extension-prompt',
    MACRO: 'macro',
};

/** Condition types for event/phase gating */
export const ConditionType = {
    NONE: 'none',
    GROUP: 'group',
    PHASE_REACHED: 'phase-reached',
    HAS_FIRED: 'has-fired',
    FIRE_COUNT: 'fire-count',
    IS_SPENT: 'is-spent',
    NOT_SPENT: 'not-spent',
    KEYWORD: 'keyword',
    PROVIDER_STATE: 'provider-state',
};

export { KeywordMode, KeywordScope };

export const ConditionGroupOperator = {
    ALL: 'all',
    ANY: 'any',
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
let _conditionContextRef = {};

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
        characterBindings: [], // stores unique avatar filenames (legacy: names)
        tagBindings: [],       // stores ST native tag IDs
        sharedInstructions: [], // reusable prompt guidance referenced by Events
        events: [],
        scripts: [],           // sibling to events: run STScript on a trigger
        stateTracks: [],       // state-derived prompt layers; do not consume event slots
        promptRouters: [],     // deterministic stacking/exclusive prompt fragments
        ...overrides,
    };
}

/** Create reusable guidance that Events in one set can reference. */
export function createSharedInstruction(overrides = {}) {
    return {
        id: generateId('shared'),
        name: 'New Shared Instruction',
        text: '',
        ...overrides,
    };
}

/**
 * Create a new Script. Sibling to an Event: instead of injecting text, a Script
 * runs an STScript body on a lifecycle trigger. STScript only — never raw JS.
 * Reuses the same condition engine events use. Scripts run in list order, and
 * (per the dispatch layer) all fired Scripts for a hook run before Events on
 * that same hook.
 */
export function createScript(overrides = {}) {
    return {
        id: generateId('scr'),
        name: 'New Script',
        enabled: true,
        buttonActivated: false, // show a manual-trigger button in the send bar
        body: '',               // STScript, e.g. /setvar key=mood value=tense

        trigger: {
            timing: ScriptTiming.AFTER_AI,
            interval: 1,        // every N hook fires (counting timings only)
            probability: 1.0,
            cooldown: 0,        // min hook ticks between runs
            initialDelay: 0,
        },

        condition: createCondition(),

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
        sharedInstructionIds: [],
        subject: createSubject(),
        buttonActivated: false, // show a manual-trigger button in the send bar
        oncePerSubject: false,

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

        actions: [],

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
        providerId: 'superagents',
        source: '',
        path: '',
        operator: ProviderOperator.EXISTS,
        value: '',
        subject: null,
        keywords: [],
        keywordScope: KeywordScope.LAST_USER,
        keywordMode: KeywordMode.ANY,
        keywordLookback: 4,
        keywordCaseSensitive: false,
        keywordWholeWords: true,
        ...overrides,
    };
}

export function createConditionGroup(overrides = {}) {
    return {
        type: ConditionType.GROUP,
        operator: ConditionGroupOperator.ALL,
        conditions: [],
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
    const hasCondition = event.condition && event.condition.type !== ConditionType.NONE;
    const interval = randomInRange(event.schedule.intervalMin, event.schedule.intervalMax);
    return {
        lastFired: -Infinity,
        // For unconditioned events, anchor the first window from chat start.
        // For conditioned events, nextEligible is re-anchored when the condition
        // first becomes true (see evaluateEvents), so this initial value is just
        // a placeholder that will be overwritten.
        nextEligible: hasCondition ? Infinity : event.schedule.initialDelay + interval,
        fireCount: 0,
        // Tracks whether a conditioned event's gate has opened at least once.
        // When it first opens, nextEligible is re-anchored from that moment.
        conditionActivated: false,
        // One-shot
        spent: false,
        // Plot-chain
        currentPhase: 0,
        phaseMessageCount: 0,
        phaseNextAdvance: event.phases?.length
            ? randomInRange(event.phases[0]?.durationMin ?? 15, event.phases[0]?.durationMax ?? 25)
            : 0,
        subjectHistory: {},
    };
}

/** Get or initialize per-event state */
export function getEventState(chatState, event) {
    if (!chatState.eventStates[event.id]) {
        chatState.eventStates[event.id] = createEventState(event);
    }
    return chatState.eventStates[event.id];
}

/** Create fresh runtime state for a script. Counters are hook-local. */
export function createScriptState(script) {
    const interval = Math.max(1, script.trigger?.interval || 1);
    return {
        lastRun: -Infinity,
        nextEligible: (script.trigger?.initialDelay || 0) + interval,
        runCount: 0,
        hookTick: 0, // advances each time this script's counting hook fires
    };
}

/** Get or initialize per-script state */
export function getScriptState(chatState, script) {
    if (!chatState.scriptStates) chatState.scriptStates = {};
    if (!chatState.scriptStates[script.id]) {
        chatState.scriptStates[script.id] = createScriptState(script);
    }
    return chatState.scriptStates[script.id];
}

/** Create fresh per-chat state */
export function createChatState() {
    return {
        messageCount: 0,
        eventStates: {},
        scriptStates: {},
        trackStates: {},
        capturedVariables: {},
        // Exact event prompts belonging to this branch's pending generation.
        // Keeping the rendered text avoids re-rolling schedules/probability when
        // the chat is reopened or the same assistant turn is swiped.
        pendingEventInjections: {},
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
export function evaluateCondition(condition, chatState, context = {}) {
    if (!condition || condition.type === ConditionType.NONE) return true;

    if (condition.type === ConditionType.GROUP) {
        const children = Array.isArray(condition.conditions) ? condition.conditions : [];
        const result = children.length > 0 && (condition.operator === ConditionGroupOperator.ANY
            ? children.some(child => evaluateCondition(child, chatState, context))
            : children.every(child => evaluateCondition(child, chatState, context)));
        return condition.invert ? !result : result;
    }

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
        case ConditionType.KEYWORD:
            result = inspectKeywordCondition(condition, context).result;
            break;
        case ConditionType.PROVIDER_STATE:
            result = evaluateProviderCondition(condition, context);
            break;
        default:
            result = true;
    }

    return condition.invert ? !result : result;
}

export function evaluateConditionDetailed(condition, chatState, context = {}) {
    if (!condition || condition.type === ConditionType.NONE) {
        return { result: true, type: ConditionType.NONE, children: [] };
    }
    if (condition.type === ConditionType.GROUP) {
        const children = (condition.conditions || []).map(child => evaluateConditionDetailed(child, chatState, context));
        const raw = children.length > 0 && (condition.operator === ConditionGroupOperator.ANY
            ? children.some(child => child.result)
            : children.every(child => child.result));
        return {
            result: condition.invert ? !raw : raw,
            type: ConditionType.GROUP,
            operator: condition.operator,
            invert: Boolean(condition.invert),
            children,
        };
    }
    if (condition.type === ConditionType.PROVIDER_STATE) {
        const detail = inspectProviderCondition(condition, context);
        return {
            ...detail,
            result: condition.invert ? !detail.result : detail.result,
            type: condition.type,
            invert: Boolean(condition.invert),
        };
    }
    if (condition.type === ConditionType.KEYWORD) {
        const detail = inspectKeywordCondition(condition, context);
        return {
            ...detail,
            result: condition.invert ? !detail.result : detail.result,
            type: condition.type,
            invert: Boolean(condition.invert),
            children: [],
        };
    }
    return {
        result: evaluateCondition(condition, chatState, context),
        type: condition.type,
        children: [],
    };
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
 * @param {object} bindingContext - { charName, avatar, tagIds } for binding resolution
 * @param {number} maxConcurrent - Maximum events that can fire per message
 * @returns {{ fired: object[], texts: Map<string, {text: string, injection: object}> }}
 */
export function evaluateEvents(eventSets, chatState, bindingContext, maxConcurrent = 2, chatLength = null, evaluationContext = {}) {
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
    _conditionContextRef = { ...bindingContext, ...evaluationContext };

    // Collect all candidate events from active sets
    const candidates = [];

    for (const set of eventSets) {
        if (!isSetActive(set, bindingContext)) continue;
        const baseConditionContext = { ...resolveSetBindingContext(set, bindingContext), ...evaluationContext };

        for (const event of set.events) {
            if (!event.enabled) continue;

            const eventSubject = createSubject(event.subject);
            const state = getEventState(chatState, event);
            const eventEligibleSubjects = resolveEventSubjectCandidates(eventSubject, baseConditionContext)
                .filter(subject => {
                    if (event.oncePerSubject && state.subjectHistory?.[subject.key]) return false;
                    const context = createResolvedSubjectContext(eventSubject, subject, baseConditionContext);
                    return evaluateCondition(event.condition, chatState, context);
                });
            const eligibleSubjects = narrowSubjectsForCurrentPhase(
                event,
                state,
                eventSubject,
                eventEligibleSubjects,
                chatState,
                baseConditionContext,
            );
            if (!eligibleSubjects.length) continue;

            const selectedSubject = selectEventSubject(eligibleSubjects, state);
            const eventContext = createResolvedSubjectContext(eventSubject, selectedSubject, baseConditionContext);
            _conditionContextRef = eventContext;

            // Condition-activation anchor: the first time a conditioned event's
            // gate opens, re-seed nextEligible from NOW so the interval counts
            // from the moment the dependency was satisfied, not from chat start.
            // The fireCount check also handles migration: old saved states lack
            // conditionActivated, so without it we'd re-anchor events that
            // already fired under the old semantics.
            const hasCondition = event.condition && event.condition.type !== ConditionType.NONE;
            if (hasCondition && !state.conditionActivated && state.fireCount === 0) {
                state.conditionActivated = true;
                const interval = randomInRange(event.schedule.intervalMin, event.schedule.intervalMax);
                state.nextEligible = msgCount + event.schedule.initialDelay + interval;
            }

            const result = evaluateSingleEvent(event, state, msgCount);

            if (result.shouldFire) {
                candidates.push({
                    event,
                    set,
                    state,
                    subject: selectedSubject.subject,
                    counterpart: selectedSubject.counterpart,
                    subjectKey: selectedSubject.key,
                    subjectState: selectedSubject.value,
                    text: renderSubjectText(result.text, selectedSubject.subject, eventContext),
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
    for (const { event, set, state, subject, subjectKey, text } of fired) {
        state.lastFired = msgCount;
        state.fireCount++;
        state.subjectHistory ||= {};
        state.subjectHistory[subjectKey] = {
            lastSelected: msgCount,
            selectionCount: (state.subjectHistory[subjectKey]?.selectionCount || 0) + 1,
        };

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

        const sharedInstructions = resolveEventSharedInstructions(set, event);
        // Action-only events do not need an empty prompt slot unless they carry shared guidance.
        if (String(text || '').trim() || sharedInstructions.length) {
            texts.set(event.id, {
                text,
                injection: event.injection,
                sharedInstructions,
            });
        }
    }
    appendSharedInstructions(texts);

    // Replace, rather than merge, so a real evaluation also expires prompts
    // from the preceding turn. This serializable copy is the source of truth
    // used by primeInjections() on chat load and swipe navigation.
    chatState.pendingEventInjections = Object.fromEntries(
        [...texts].map(([eventId, payload]) => [eventId, {
            text: payload.text,
            baseText: payload.baseText ?? payload.text,
            injection: { ...payload.injection },
            sharedInstructionIds: (payload.sharedInstructions || []).map(block => block.id),
            manual: false,
        }]),
    );

    _chatStateRef = null; // cleanup
    _conditionContextRef = {};
    return {
        fired: fired.map(candidate => ({
            ...candidate.event,
            resolvedSubject: candidate.subject,
            resolvedCounterpart: candidate.counterpart,
            resolvedSubjectKey: candidate.subjectKey,
            resolvedSubjectState: candidate.subjectState,
        })),
        texts,
    };
}

function resolveEventSubjectCandidates(subject, context = {}) {
    const binding = createSubject(subject);
    if (binding.mode === SubjectMode.STATE_VALUE) {
        const inspected = inspectProviderCondition({
            providerId: binding.providerId || 'superagents',
            source: binding.source,
            path: binding.subjectPath,
            operator: ProviderOperator.EXISTS,
        }, context);
        const resolved = inspected.found ? String(inspected.actual ?? '').trim() : '';
        return resolved ? [{ key: resolved, subject: resolved, counterpart: '', value: inspected.actual }] : [];
    }
    if (binding.mode !== SubjectMode.STATE_SOURCE) {
        const resolved = resolveSubject(binding, context);
        return resolved ? [{ key: resolved, subject: resolved, counterpart: '', value: null }] : [];
    }
    return listConditionSubjectEntries(
        binding.providerId || 'superagents',
        binding.source,
        binding.collectionPath,
        context,
    ).map(entry => ({
        key: String(entry.key || '').trim(),
        subject: String(readSubjectEntryPath(entry.value, binding.subjectPath) ?? entry.key ?? '').trim(),
        counterpart: String(readSubjectEntryPath(entry.value, binding.counterpartPath) ?? '').trim(),
        value: entry.value,
    })).filter(entry => entry.key && entry.subject);
}

function createResolvedSubjectContext(binding, candidate, context) {
    return {
        ...context,
        resolvedSubject: candidate.subject,
        resolvedCounterpart: candidate.counterpart,
        resolvedSubjectKey: candidate.key,
        resolvedSubjectState: candidate.value,
        subject: binding,
    };
}

const BLOCKED_SUBJECT_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor']);

function readSubjectEntryPath(value, path) {
    if (!path) return undefined;
    let current = value;
    for (const part of String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)) {
        if (BLOCKED_SUBJECT_PATH_PARTS.has(part) || current === null || current === undefined) return undefined;
        current = current[part];
    }
    return current;
}

function narrowSubjectsForCurrentPhase(event, state, binding, subjects, chatState, context) {
    if (event.schedule?.type !== ScheduleType.PLOT_CHAIN || !subjects.length) return subjects;
    const phase = event.phases?.[state.currentPhase];
    if (!phase?.condition || phase.condition.type === ConditionType.NONE) return subjects;
    const passing = subjects.filter(subject => evaluateCondition(
        phase.condition,
        chatState,
        createResolvedSubjectContext(binding, subject, context),
    ));
    return passing.length || phase.condition.behavior !== ConditionBehavior.SKIP
        ? passing
        : subjects;
}

function selectEventSubject(subjects, state = {}) {
    const history = state.subjectHistory || {};
    return [...subjects].sort((left, right) => {
        const leftEntry = history[left.key] || {};
        const rightEntry = history[right.key] || {};
        const leftCount = leftEntry.selectionCount || 0;
        const rightCount = rightEntry.selectionCount || 0;
        if (leftCount !== rightCount) return leftCount - rightCount;
        const leftLast = Number.isFinite(leftEntry.lastSelected) ? leftEntry.lastSelected : -1;
        const rightLast = Number.isFinite(rightEntry.lastSelected) ? rightEntry.lastSelected : -1;
        if (leftLast !== rightLast) return leftLast - rightLast;
        return left.key.localeCompare(right.key);
    })[0] || null;
}

export function resolveEventSubject(event, context = {}, state = {}) {
    return resolveEventSubjectBinding(event, context, state).subject;
}

export function resolveEventSubjectBinding(event, context = {}, state = {}) {
    const binding = createSubject(event?.subject);
    const candidates = resolveEventSubjectCandidates(binding, context);
    if (candidates.length) return selectEventSubject(candidates, state);
    const fallback = resolveSubject(binding, context);
    return { key: fallback, subject: fallback, counterpart: '', value: null };
}

/**
 * Decide which Scripts should run for a given trigger timing, and advance their
 * runtime state. Returns the scripts to run, in explicit order (set order, then
 * each set's script array order — which is what drag-reorder controls).
 *
 * MANUAL scripts are never returned here — they run only from their button.
 * Counting timings (before_ai/after_ai) advance a hook-local tick every time the
 * hook fires (even when the script doesn't run) so interval/cooldown stay honest.
 *
 * @param {object[]} eventSets
 * @param {object} chatState - mutated (script states advance)
 * @param {object} bindingContext - { charName, avatar, tagIds }
 * @param {string} timing - a ScriptTiming value
 * @returns {object[]} scripts to execute, in order
 */
export function evaluateScripts(eventSets, chatState, bindingContext, timing, evaluationContext = {}) {
    if (timing === ScriptTiming.MANUAL) return [];
    const toRun = [];

    for (const set of eventSets) {
        if (!isSetActive(set, bindingContext)) continue;
        const conditionContext = { ...resolveSetBindingContext(set, bindingContext), ...evaluationContext };

        for (const script of (set.scripts || [])) {
            if (!script.enabled) continue;
            if (script.builtInAction === 'time-skip') continue;
            if ((script.trigger?.timing || ScriptTiming.AFTER_AI) !== timing) continue;

            const state = getScriptState(chatState, script);
            const counting = isCountingTiming(timing);
            if (counting) state.hookTick++;

            // Condition gate (may reference event states)
            if (!evaluateCondition(script.condition, chatState, conditionContext)) continue;

            let shouldRun;
            if (counting) {
                shouldRun = decideCountingRun(script, state);
            } else {
                // Lifecycle timings: fire whenever the hook fires (+ probability).
                shouldRun = Math.random() <= (script.trigger?.probability ?? 1);
            }

            if (shouldRun) {
                state.lastRun = counting ? state.hookTick : state.lastRun;
                state.runCount++;
                if (counting) {
                    const interval = Math.max(1, script.trigger?.interval || 1);
                    state.nextEligible = state.hookTick + interval;
                }
                toRun.push(script);
            }
        }
    }

    return toRun;
}

/** Interval/cooldown/probability decision for a counting-timing script. */
function decideCountingRun(script, state) {
    const t = script.trigger || {};
    if (state.hookTick < state.nextEligible) return false;
    const cooldown = t.cooldown || 0;
    if (state.hookTick - state.lastRun < cooldown) return false;
    if (Math.random() > (t.probability ?? 1)) {
        // Missed the roll — push eligibility out a full interval so cadence holds.
        const interval = Math.max(1, t.interval || 1);
        state.nextEligible = state.hookTick + interval;
        return false;
    }
    return true;
}

/** Human-readable status string for a script (mirrors getEventStatus). */
export function getScriptStatus(script, chatState) {
    if (!chatState) return 'No active chat';
    const timing = script.trigger?.timing || ScriptTiming.AFTER_AI;
    if (timing === ScriptTiming.MANUAL) return 'Manual only';
    const state = chatState.scriptStates?.[script.id];
    if (!state) return isCountingTiming(timing) ? 'Not initialized' : 'Ready';
    if (!isCountingTiming(timing)) {
        return state.runCount > 0 ? `Ran ${state.runCount}x` : 'Ready';
    }
    const untilNext = state.nextEligible - state.hookTick;
    if (state.runCount === 0) {
        return untilNext > 0 ? `First run in ~${untilNext}` : 'Ready to run';
    }
    return untilNext > 0 ? `Ran ${state.runCount}x — next in ~${untilNext}` : `Ran ${state.runCount}x — eligible`;
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
        if (!evaluateCondition(phase.condition, _chatStateRef, _conditionContextRef)) {
            if (phase.condition.behavior === ConditionBehavior.SKIP) {
                // Skip forward through phases until we find one that passes or run out
                while (state.currentPhase < event.phases.length - 1) {
                    state.currentPhase++;
                    state.phaseMessageCount = 0;
                    phase = event.phases[state.currentPhase];
                    const nextDur = phase;
                    state.phaseNextAdvance = randomInRange(nextDur.durationMin, nextDur.durationMax);
                    if (!phase.condition || phase.condition.type === ConditionType.NONE || evaluateCondition(phase.condition, _chatStateRef, _conditionContextRef)) {
                        break; // Found a phase that passes
                    }
                    if (phase.condition.behavior !== ConditionBehavior.SKIP) {
                        // Hit a stall phase — stop here
                        return { shouldFire: false, text: '' };
                    }
                }
                // Re-check the phase we landed on
                if (phase.condition && phase.condition.type !== ConditionType.NONE && !evaluateCondition(phase.condition, _chatStateRef, _conditionContextRef)) {
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

/**
 * Normalize a binding context. Accepts a legacy character-name string or
 * the active card and group-member context from SillyTavern.
 */
function normalizeBindingContext(ctx) {
    if (!ctx) return { charName: '', avatar: '', groupId: '', groupMembers: [], tagIds: [] };
    if (typeof ctx === 'string') return { charName: ctx, avatar: '', groupId: '', groupMembers: [], tagIds: [] };
    return {
        charName: ctx.charName || '',
        avatar: ctx.avatar || '',
        groupId: ctx.groupId || '',
        groupMembers: Array.isArray(ctx.groupMembers) ? ctx.groupMembers : [],
        tagIds: Array.isArray(ctx.tagIds) ? ctx.tagIds : [],
    };
}

/**
 * Match a single character binding against a card. New bindings store the
 * unique avatar filename; legacy bindings store the character name.
 */
function matchesCharacterBinding(binding, ctx) {
    const b = String(binding || '').trim().toLowerCase();
    if (!b) return false;
    return b === (ctx.avatar || '').toLowerCase() || b === (ctx.charName || '').toLowerCase();
}

/** Resolve a single character-bound group member as the set's active card. */
export function resolveSetBindingContext(set, bindingContext) {
    const ctx = normalizeBindingContext(bindingContext);
    if (!ctx.groupId || set.bindMode !== BindMode.CHARACTER || !set.characterBindings?.length) {
        return bindingContext;
    }
    const matches = ctx.groupMembers.filter(member =>
        set.characterBindings.some(binding => matchesCharacterBinding(binding, member)));
    if (matches.length !== 1) return bindingContext;
    return { ...bindingContext, charName: matches[0].charName, avatar: matches[0].avatar };
}

/**
 * Check if an event set should be active given the current binding context.
 * @param {object} set - The event set
 * @param {object|string} bindingContext - active card or group-member context
 *   (or a bare character-name string for backward compatibility)
 */
export function isSetActive(set, bindingContext) {
    if (!set.enabled) return false;
    const ctx = normalizeBindingContext(bindingContext);

    switch (set.bindMode) {
        case BindMode.CHARACTER:
            if (!set.characterBindings?.length) return true;
            if (ctx.groupId) {
                return set.characterBindings.some(binding =>
                    ctx.groupMembers.some(member => matchesCharacterBinding(binding, member)));
            }
            return set.characterBindings.some(binding => matchesCharacterBinding(binding, ctx));
        case BindMode.TAG:
            if (!set.tagBindings?.length) return true;
            return set.tagBindings.some(id => ctx.tagIds.includes(id));
        case BindMode.MANUAL:
        default:
            return true;
    }
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
        // Conditioned events that haven't activated yet — condition gate not open
        const hasCondition = event.condition && event.condition.type !== ConditionType.NONE;
        if (hasCondition && !state.conditionActivated) {
            return 'Waiting on condition';
        }
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
