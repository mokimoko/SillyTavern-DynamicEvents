import { executeDynamicActions } from '../actions/actionRuntime.js';
import { DYNAMIC_EVENTS_EVENTS, emitDynamicEvent } from '../integration/events.js';
import { resolveSubject } from '../subjects/subjects.js';

const LOG_PREFIX = '[DynEvents]';

export function runActions(actions, context) {
    void executeDynamicActions(actions, context).then(results => {
        for (const result of results) {
            if (result.status === 'rejected') console.warn(LOG_PREFIX, 'Action failed:', result.reason);
        }
    });
}

export function dispatchFiredActions(fired, bindingContext, location) {
    for (const event of fired) {
        const subject = event.resolvedSubject || resolveSubject(event.subject, bindingContext);
        runActions(event.actions, {
            ...bindingContext,
            ...location,
            subject,
            counterpart: event.resolvedCounterpart || '',
            subjectState: event.resolvedSubjectState || null,
            source: `dynamic-event:${event.id}`,
        });
    }
}

export function dispatchTrackEntryActions(trackResult, bindingContext, location) {
    for (const transition of trackResult.transitions || []) {
        const active = (trackResult.active || []).find(entry => entry.track.id === transition.trackId
            && entry.state.id === transition.stateId);
        if (!active) continue;
        runActions(active.state.onEnterActions, {
            ...bindingContext,
            ...location,
            subject: active.subject,
            source: `dynamic-track:${active.track.id}:${active.state.id}`,
        });
    }
}

export function emitTrackLifecycle(transitions, location) {
    for (const transition of transitions) {
        emitDynamicEvent(DYNAMIC_EVENTS_EVENTS.TRACK_CHANGED, { ...transition, ...location });
    }
}

export function emitEventLifecycle(fired, beforeEventStates, chatState, location) {
    for (const event of fired) {
        const before = beforeEventStates[event.id] || {};
        const after = chatState.eventStates?.[event.id] || {};
        const detail = {
            eventId: event.id,
            eventName: event.name,
            subject: event.resolvedSubject || resolveSubject(event.subject),
            counterpart: event.resolvedCounterpart || '',
            subjectKey: event.resolvedSubjectKey || event.resolvedSubject || '',
            scheduleType: event.schedule?.type ?? null,
            messageIndex: location.messageIndex,
            swipeId: location.swipeId,
        };
        emitDynamicEvent(DYNAMIC_EVENTS_EVENTS.EVENT_FIRED, detail);
        if (before.currentPhase !== undefined && after.currentPhase !== before.currentPhase) {
            emitDynamicEvent(DYNAMIC_EVENTS_EVENTS.PHASE_CHANGED, {
                ...detail,
                previousPhase: before.currentPhase,
                currentPhase: after.currentPhase,
            });
        }
        if (!before.spent && after.spent) emitDynamicEvent(DYNAMIC_EVENTS_EVENTS.EVENT_SPENT, detail);
    }
}
