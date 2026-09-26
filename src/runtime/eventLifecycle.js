import { getContext } from '../../../../../extensions.js';
import { createChatState, evaluateEvents, ScriptTiming } from '../../eventEngine.js';
import { debug, getSettings } from '../config/settings.js';
import { evaluateStateTracks } from '../tracks/stateTracks.js';
import { evaluatePromptRouters } from '../routers/promptRouters.js';
import { activeSwipeId, cloneRuntimeState, hasStateSnapshot, resolveEvaluationBase } from './branchState.js';
import { getBindingContext } from './bindingContext.js';
import { appendCalendarReconciliationCues } from './calendarReconciliation.js';
import { METADATA_KEY, getMetadata, mirrorVisibleState, saveChatState } from './chatState.js';
import { processCaptureTags } from './captureTags.js';
import {
    dispatchFiredActions,
    dispatchTrackEntryActions,
    emitEventLifecycle,
    emitTrackLifecycle,
} from './eventActions.js';
import { applyInjectionTexts, clearAllInjections, primeInjections } from './injectionManager.js';
import { runScripts } from './scriptRunner.js';

/** Execute one assistant-message tick while preserving scheduler ordering. */
export async function onMessageReceived() {
    const settings = getSettings();
    if (!settings.enabled) {
        clearAllInjections(settings);
        return;
    }
    const chat = getContext().chat || [];
    const currentLength = chat.length;
    const messageIndex = currentLength - 1;
    const message = chat[messageIndex];
    if (!message || message.is_user || message.is_system) return;
    const swipeId = activeSwipeId(message);
    if (hasStateSnapshot(message, swipeId)) {
        mirrorVisibleState();
        primeInjections();
        return;
    }

    const inherited = resolveEvaluationBase(chat, messageIndex) || getMetadata()?.[METADATA_KEY];
    const chatState = cloneRuntimeState(inherited || createChatState());
    processCaptureTags(chatState);
    const beforeEventStates = cloneRuntimeState(chatState.eventStates || {});
    await runScripts(ScriptTiming.AFTER_AI, { chatState, persist: false });
    const bindingContext = getBindingContext();
    const evaluationContext = {
        messageIndex,
        swipeId,
        chatLength: currentLength,
        messages: chat,
        keywordCache: new Map(),
    };
    const { fired, texts } = evaluateEvents(
        settings.eventSets,
        chatState,
        bindingContext,
        settings.maxConcurrentEvents,
        currentLength,
        evaluationContext,
    );
    const trackResult = evaluateStateTracks(
        settings.eventSets,
        chatState,
        bindingContext,
        evaluationContext,
    );
    const routerResult = evaluatePromptRouters(
        settings.eventSets,
        chatState,
        bindingContext,
        evaluationContext,
    );
    appendCalendarReconciliationCues(
        fired,
        texts,
        chatState,
        globalThis.SuperAgents?.integration?.calendar,
        { messageIndex, swipeId },
    );
    clearAllInjections(settings);
    applyInjectionTexts(texts, trackResult.texts, routerResult.texts);
    if (fired.length) debug(`Fired ${fired.length}: ${fired.map(event => event.name).join(', ')}`);
    saveChatState(chatState, { messageIndex, swipeId });
    dispatchFiredActions(fired, bindingContext, { messageIndex, swipeId });
    dispatchTrackEntryActions(trackResult, bindingContext, { messageIndex, swipeId });
    emitEventLifecycle(fired, beforeEventStates, chatState, { messageIndex, swipeId });
    emitTrackLifecycle(trackResult.transitions, { messageIndex, swipeId });
}
