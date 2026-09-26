import {
    ConditionType,
    InjectionMode,
    PromptPosition,
    PromptRole,
    createCondition,
    evaluateCondition,
    evaluateConditionDetailed,
    generateId,
    isSetActive,
    resolveSetBindingContext,
} from '../../eventEngine.js';
import {
    SubjectMode,
    createSubject,
    renderSubjectText,
    resolveSubject,
} from '../subjects/subjects.js';

export const TrackTransitionMode = Object.freeze({
    REVERSIBLE: 'reversible',
    STICKY: 'sticky',
    ONE_WAY: 'one-way',
    LATCHED: 'latched',
});

export function createTrackSubject(overrides = {}) {
    return createSubject(overrides);
}

export function createTrackState(overrides = {}) {
    return {
        id: generateId('state'),
        name: 'New State',
        enabled: true,
        priority: 0,
        isFallback: false,
        minDuration: 0,
        text: '',
        entryText: '',
        onEnterActions: [],
        condition: createCondition(),
        exitCondition: createCondition(),
        ...overrides,
    };
}

export function createStateTrack(overrides = {}) {
    return {
        id: generateId('track'),
        name: 'New State Track',
        enabled: true,
        transitionMode: TrackTransitionMode.REVERSIBLE,
        subject: createTrackSubject(),
        states: [],
        injection: {
            mode: InjectionMode.EXTENSION_PROMPT,
            position: PromptPosition.IN_CHAT,
            depth: 1,
            role: PromptRole.SYSTEM,
        },
        ...overrides,
    };
}

function getTrackRuntime(chatState, track) {
    if (!chatState.trackStates) chatState.trackStates = {};
    if (!chatState.trackStates[track.id]) {
        chatState.trackStates[track.id] = {
            activeStateId: null,
            enteredAt: -1,
            visitedStateIds: [],
        };
    }
    return chatState.trackStates[track.id];
}

function subjectValue(subject, context) {
    return resolveSubject(subject, context);
}

function conditionIsConfigured(condition) {
    return condition && condition.type !== ConditionType.NONE;
}

function chooseMatchingState(track, runtime, chatState, context, excludedStateId = null) {
    const enabled = (track.states || []).filter(state => state.enabled !== false);
    const fallback = enabled.find(state => state.isFallback) || null;
    let matching = enabled.filter(state => state.id !== excludedStateId
        && !state.isFallback
        && evaluateCondition(state.condition, chatState, context));

    if (track.transitionMode === TrackTransitionMode.ONE_WAY && runtime.activeStateId) {
        const currentIndex = enabled.findIndex(state => state.id === runtime.activeStateId);
        if (currentIndex >= 0) {
            matching = matching.filter(state => enabled.indexOf(state) >= currentIndex);
            if (!matching.length) return enabled[currentIndex];
        }
    }

    matching.sort((a, b) => (b.priority || 0) - (a.priority || 0)
        || enabled.indexOf(a) - enabled.indexOf(b));
    return matching[0] || fallback;
}

function shouldRetainCurrent(track, current, runtime, chatState, context, messageCount) {
    if (!current) return false;
    const age = Math.max(0, messageCount - (runtime.enteredAt ?? messageCount));
    if (age < Math.max(0, current.minDuration || 0)) return true;

    if (track.transitionMode === TrackTransitionMode.LATCHED) {
        return !conditionIsConfigured(current.exitCondition)
            || !evaluateCondition(current.exitCondition, chatState, context);
    }
    if (track.transitionMode === TrackTransitionMode.STICKY) {
        if (conditionIsConfigured(current.exitCondition)) {
            return !evaluateCondition(current.exitCondition, chatState, context);
        }
        return !current.isFallback
            && conditionIsConfigured(current.condition)
            && evaluateCondition(current.condition, chatState, context);
    }
    return false;
}

function renderText(text, subject) {
    return renderSubjectText(text, subject);
}

export function evaluateStateTracks(eventSets, chatState, bindingContext, evaluationContext = {}) {
    const active = [];
    const transitions = [];
    const texts = new Map();
    const messageCount = Number(chatState.messageCount || evaluationContext.chatLength || 0);

    for (const set of eventSets) {
        if (!isSetActive(set, bindingContext)) continue;
        const setContext = resolveSetBindingContext(set, bindingContext);
        for (const track of (set.stateTracks || [])) {
            if (!track.enabled) continue;
            const runtime = getTrackRuntime(chatState, track);
            const context = {
                ...setContext,
                ...evaluationContext,
                subject: track.subject,
            };
            const current = (track.states || []).find(state => state.id === runtime.activeStateId) || null;
            const retainCurrent = shouldRetainCurrent(
                track,
                current,
                runtime,
                chatState,
                context,
                messageCount,
            );
            const explicitlyExiting = current
                && !retainCurrent
                && conditionIsConfigured(current.exitCondition)
                && evaluateCondition(current.exitCondition, chatState, context);
            const selected = retainCurrent
                ? current
                : chooseMatchingState(
                    track,
                    runtime,
                    chatState,
                    context,
                    explicitlyExiting ? current.id : null,
                );

            if (!selected) {
                runtime.activeStateId = null;
                continue;
            }

            const changed = selected.id !== runtime.activeStateId;
            const previousStateId = runtime.activeStateId;
            if (changed) {
                runtime.activeStateId = selected.id;
                runtime.enteredAt = messageCount;
                if (!runtime.visitedStateIds.includes(selected.id)) runtime.visitedStateIds.push(selected.id);
                transitions.push({
                    setId: set.id,
                    trackId: track.id,
                    trackName: track.name,
                    previousStateId,
                    stateId: selected.id,
                    stateName: selected.name,
                });
            }

            const subject = subjectValue(track.subject, context);
            const parts = [];
            if (changed && selected.entryText) parts.push(renderText(selected.entryText, subject));
            if (selected.text) parts.push(renderText(selected.text, subject));
            const text = parts.filter(Boolean).join('\n');
            if (text) {
                texts.set(track.id, { text, injection: track.injection, setId: set.id });
            }
            active.push({ set, track, state: selected, runtime, subject });
        }
    }

    return { active, transitions, texts };
}

export function inspectStateTrack(track, chatState, bindingContext, evaluationContext = {}) {
    const clonedState = structuredClone(chatState);
    const clonedTrack = structuredClone(track);
    const context = {
        ...bindingContext,
        ...evaluationContext,
        subject: clonedTrack.subject,
    };
    const conditionResults = Object.fromEntries((clonedTrack.states || []).map(state => [
        state.id,
        state.isFallback ? null : evaluateCondition(state.condition, clonedState, context),
    ]));
    const conditionDetails = Object.fromEntries((clonedTrack.states || []).map(state => [
        state.id,
        state.isFallback ? null : evaluateConditionDetailed(state.condition, clonedState, context),
    ]));
    const result = evaluateStateTracks([{
        id: 'inspection-set',
        name: 'Inspection',
        enabled: true,
        bindMode: 'manual',
        events: [],
        scripts: [],
        stateTracks: [clonedTrack],
    }], clonedState, bindingContext, evaluationContext);
    return {
        activeStateId: result.active[0]?.state?.id || null,
        subject: result.active[0]?.subject || subjectValue(clonedTrack.subject, context),
        conditionResults,
        conditionDetails,
    };
}
