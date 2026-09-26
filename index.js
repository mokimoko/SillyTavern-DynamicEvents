/**
 * SillyTavern-DynamicEvents composition root.
 * Runtime behavior and UI live in focused modules under src/.
 */

import { eventSource, event_types } from '../../../../script.js';
import { getContext, renderExtensionTemplateAsync } from '../../../extensions.js';
import { ScriptTiming, isSetActive } from './eventEngine.js';
import { registerSlashCommands } from './src/commands/slashCommands.js';
import { debug, getSettings, migrateSettings } from './src/config/settings.js';
import { DYNAMIC_EVENTS_EVENTS, emitDynamicEvent } from './src/integration/events.js';
import { createPublicIntegrationApi } from './src/integration/publicApi.js';
import { activeSwipeId } from './src/runtime/branchState.js';
import { getBindingContext } from './src/runtime/bindingContext.js';
import { mirrorVisibleState, resolveRuntimeState } from './src/runtime/chatState.js';
import { onMessageReceived } from './src/runtime/eventLifecycle.js';
import {
    collectSuperAgentsContinuousSources,
    stateCommitAffectsSources,
} from './src/runtime/stateCommitDependencies.js';
import {
    anyMacroEventsConfigured,
    clearAllInjections,
    isMacroRegistered,
    primeInjections,
    registerMacro,
} from './src/runtime/injectionManager.js';
import { runScripts } from './src/runtime/scriptRunner.js';
import {
    clearTimeSkipReplyPrompt,
    reconcileTimeSkipReplyPrompt,
} from './src/runtime/timeSkipPlanner.js';
import { createChatUi } from './src/ui/chatUi.js';
import { createPopupController } from './src/ui/popupController.js';

const LOG_PREFIX = '[DynEvents]';
const EXTENSION_FOLDER = (() => {
    try {
        const match = import.meta.url.match(/\/extensions\/(?:third-party\/)?([^/]+)\//);
        if (match) return match[1];
    } catch {
        // Fall back to the repository folder name.
    }
    return 'SillyTavern-DynamicEvents';
})();
const TEMPLATE_NAMESPACE = `third-party/${EXTENSION_FOLDER}`;

let popupController;
let stateCommitPrimeTimer = null;

function getActiveContinuousPromptDependencies() {
    const settings = getSettings();
    if (!settings.enabled) return { hasContinuous: false, sources: new Set() };
    const bindingContext = getBindingContext();
    const activeSets = (settings.eventSets || []).filter(set => isSetActive(set, bindingContext));
    const hasContinuous = activeSets.some(set =>
        (set.stateTracks || []).some(track => track.enabled)
        || (set.promptRouters || []).some(router => router.enabled));
    return {
        hasContinuous,
        sources: hasContinuous ? collectSuperAgentsContinuousSources(activeSets) : new Set(),
    };
}

function scheduleStateCommitPrime(event) {
    const dependencies = getActiveContinuousPromptDependencies();
    if (!dependencies.hasContinuous || !stateCommitAffectsSources(event, dependencies.sources)) return;
    // Pre-gen classifiers commit while SillyTavern is still assembling the
    // upcoming request. Refresh synchronously so the newly selected router
    // layers reach that same main generation. Ordinary post-gen tracker commits
    // remain coalesced to avoid repeated paints/injection churn.
    if (event?.detail?.source === 'pre_gen_sidecar'
        || event?.detail?.source === 'cadence_snapshot_reuse') {
        cancelStateCommitPrime();
        primeInjections({ preferLiveSuperAgentsState: true });
        return;
    }
    if (stateCommitPrimeTimer) clearTimeout(stateCommitPrimeTimer);
    stateCommitPrimeTimer = setTimeout(() => {
        stateCommitPrimeTimer = null;
        const latest = getActiveContinuousPromptDependencies();
        if (latest.hasContinuous && stateCommitAffectsSources(event, latest.sources)) primeInjections();
    }, 60);
}

function cancelStateCommitPrime() {
    if (!stateCommitPrimeTimer) return;
    clearTimeout(stateCommitPrimeTimer);
    stateCommitPrimeTimer = null;
}

const chatUi = createChatUi({
    openPopup: () => popupController.openPopup(),
    renderExtensionTemplateAsync,
    templateNamespace: TEMPLATE_NAMESPACE,
});
popupController = createPopupController({
    updateDrawerStatus: chatUi.updateDrawerStatus,
    updateEventButtons: chatUi.updateEventButtons,
});

jQuery(async () => {
    getSettings();
    migrateSettings();
    globalThis.DynamicEvents = Object.freeze({
        version: '0.28.0',
        ui: Object.freeze({
            openPopup: () => popupController.openPopup(),
        }),
        integration: createPublicIntegrationApi({
            getSettings,
            resolveRuntimeState,
            getBindingContext,
        }),
    });

    await chatUi.loadDrawerUI();
    chatUi.addWandMenuItem();

    eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
        await onMessageReceived();
        chatUi.updateDrawerStatus();
    });
    globalThis.addEventListener?.('superagents:state-committed', scheduleStateCommitPrime);
    globalThis.addEventListener?.('superagents:snapshot-reused', scheduleStateCommitPrime);
    globalThis.addEventListener?.('superagents:presentation-changed', () => {
        if (popupController.isOpen()) popupController.renderRightPanel();
    });

    eventSource.on(event_types.CHAT_CHANGED, async () => {
        // There is no new AI message on chat load, so capture/scrub does not run.
        // Restore exact pending prompts after chat-changed Scripts execute.
        cancelStateCommitPrime();
        clearTimeSkipReplyPrompt();
        mirrorVisibleState();
        await runScripts(ScriptTiming.CHAT_CHANGED);
        primeInjections();
        chatUi.updateDrawerStatus();
        chatUi.updateEventButtons();
    });

    if (event_types.MESSAGE_SWIPED) {
        eventSource.on(event_types.MESSAGE_SWIPED, messageIndex => {
            mirrorVisibleState();
            clearAllInjections(getSettings());
            primeInjections();
            chatUi.updateDrawerStatus();
            if (popupController.isOpen()) popupController.renderRightPanel();
            emitDynamicEvent(DYNAMIC_EVENTS_EVENTS.STATE_RESTORED, {
                messageIndex: Number(messageIndex),
                swipeId: activeSwipeId(getContext().chat?.[Number(messageIndex)]),
            });
        });
    }

    if (event_types.MESSAGE_DELETED) {
        eventSource.on(event_types.MESSAGE_DELETED, () => {
            reconcileTimeSkipReplyPrompt();
            mirrorVisibleState();
            clearAllInjections(getSettings());
            primeInjections();
            chatUi.updateDrawerStatus();
        });
    }

    if (event_types.USER_MESSAGE_RENDERED) {
        eventSource.on(event_types.USER_MESSAGE_RENDERED, () => {
            clearTimeSkipReplyPrompt();
            runScripts(ScriptTiming.BEFORE_AI);
        });
    }
    if (event_types.CHAT_CREATED) {
        eventSource.on(event_types.CHAT_CREATED, () => {
            clearTimeSkipReplyPrompt();
            runScripts(ScriptTiming.CHAT_CREATED);
        });
    }

    registerMacro();
    registerSlashCommands({
        onMutation: () => {
            chatUi.updateDrawerStatus();
            chatUi.updateEventButtons();
        },
    });
    chatUi.updateEventButtons();
    setTimeout(chatUi.updateEventButtons, 1500);

    if (!isMacroRegistered() && anyMacroEventsConfigured()) {
        console.warn(LOG_PREFIX, 'Macro {{dynamicEvents}} could not register, but macro-mode events exist — they will not inject.');
        toastr.warning(
            'Dynamic Events: {{dynamicEvents}} macro unavailable in this ST version. Macro-mode events won\'t inject — switch them to Extension Prompt mode.',
            '',
            { timeOut: 12000 },
        );
    }

    debug('Extension loaded');
});
