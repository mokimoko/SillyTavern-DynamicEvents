import { getContext } from '../../../../../extensions.js';
import {
    getEventState,
    getEventStatus,
    getScriptStatus,
    isSetActive,
    resolveEventSubjectBinding,
    ScheduleType,
} from '../../eventEngine.js';
import { getSettings } from '../config/settings.js';
import { inspectPromptRouter } from '../routers/promptRouters.js';
import { renderSubjectText } from '../subjects/subjects.js';
import { activeSwipeId, cloneRuntimeState } from './branchState.js';
import { getBindingContext } from './bindingContext.js';
import { getChatState, saveChatState } from './chatState.js';
import { runActions } from './eventActions.js';
import { clearAllInjections, injectEventText, primeInjections } from './injectionManager.js';

export function forceFireEvent(eventName) {
    const settings = getSettings();
    const chatState = cloneRuntimeState(getChatState());
    const nameLower = eventName.toLowerCase();
    for (const set of settings.eventSets) {
        for (const event of set.events) {
            if (event.name.toLowerCase() !== nameLower) continue;
            const state = getEventState(chatState, event);
            const rawText = event.schedule.type === ScheduleType.PLOT_CHAIN
                ? event.phases?.[state.currentPhase]?.text || event.text
                : event.text;
            const bindingContext = getBindingContext();
            const chat = getContext().chat || [];
            const messageIndex = Math.max(0, chat.length - 1);
            const swipeId = activeSwipeId(chat[messageIndex]);
            const resolved = resolveEventSubjectBinding(event, { ...bindingContext, messageIndex, swipeId }, state);
            const textContext = {
                resolvedSubject: resolved.subject,
                resolvedCounterpart: resolved.counterpart,
                resolvedSubjectKey: resolved.key,
                resolvedSubjectState: resolved.value,
            };
            const text = renderSubjectText(rawText, resolved.subject, textContext);
            injectEventText(event.id, text, event.injection);
            runActions(event.actions, {
                ...bindingContext,
                messageIndex,
                swipeId,
                subject: resolved.subject,
                counterpart: resolved.counterpart,
                subjectState: resolved.value,
                source: `dynamic-event:${event.id}:manual`,
            });
            chatState.pendingEventInjections ||= {};
            chatState.pendingEventInjections[event.id] = {
                text,
                injection: { ...event.injection },
                manual: true,
            };
            saveChatState(chatState, { messageIndex, swipeId });
            return `Force-fired: ${event.name}`;
        }
    }
    return `Event not found: ${eventName}`;
}

export function resetEventState(name) {
    const settings = getSettings();
    const chatState = cloneRuntimeState(getChatState());
    for (const set of settings.eventSets) {
        for (const event of set.events) {
            if (event.name.toLowerCase() !== name.toLowerCase()) continue;
            delete chatState.eventStates[event.id];
            if (chatState.pendingEventInjections) delete chatState.pendingEventInjections[event.id];
            saveChatState(chatState);
            clearAllInjections(settings);
            primeInjections();
            return `Reset: ${event.name}`;
        }
    }
    return `Not found: ${name}`;
}

export function resetAllEventStates() {
    const chatState = cloneRuntimeState(getChatState());
    chatState.messageCount = 0;
    chatState.eventStates = {};
    chatState.scriptStates = {};
    chatState.pendingEventInjections = {};
    saveChatState(chatState);
    clearAllInjections(getSettings());
    primeInjections();
}

export function getStatusReport() {
    const settings = getSettings();
    const chatState = getChatState();
    const context = getBindingContext();
    const chat = getContext().chat || [];
    const chatLength = chat.length;
    const messageIndex = chatLength - 1;
    const swipeId = activeSwipeId(chat[messageIndex]);
    const drift = chatState.messageCount !== chatLength ? ` (sched tick ${chatState.messageCount})` : '';
    const lines = [`Dynamic Events — Message #${chatLength}${drift}`];
    for (const set of settings.eventSets) {
        const active = isSetActive(set, context);
        lines.push(`\n[${active ? '✓' : '✗'}] ${set.name} (${set.bindMode})`);
        for (const event of set.events) lines.push(`  ${event.enabled ? '●' : '○'} ${event.name}: ${getEventStatus(event, chatState)}`);
        for (const track of (set.stateTracks || [])) {
            const activeStateId = chatState.trackStates?.[track.id]?.activeStateId;
            const activeState = (track.states || []).find(state => state.id === activeStateId)?.name || 'no active state';
            lines.push(`  ${track.enabled ? '◆' : '◇'} ${track.name}: ${activeState}`);
        }
        for (const router of (set.promptRouters || [])) {
            const inspection = inspectPromptRouter(router, chatState, context, { messageIndex, swipeId });
            const activeLayers = (router.layers || [])
                .filter(layer => inspection.activeLayerIds.includes(layer.id))
                .map(layer => layer.name);
            lines.push(`  ${router.enabled ? '⇄' : '⇆'} ${router.name}: ${activeLayers.join(' + ') || 'no matching layers'}`);
        }
        for (const script of (set.scripts || [])) lines.push(`  ${script.enabled ? '▸' : '▹'} ${script.name}: ${getScriptStatus(script, chatState)}`);
    }
    return lines.join('\n');
}
