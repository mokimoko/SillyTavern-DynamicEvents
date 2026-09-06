import {
    chat_metadata,
    saveChatDebounced,
} from '../../../../../../script.js';
import {
    getContext,
    saveMetadataDebounced,
} from '../../../../../extensions.js';
import { createChatState } from '../../eventEngine.js';
import {
    activeSwipeId,
    cloneRuntimeState,
    resolveBranchStateDetailed,
    storeStateSnapshot,
} from './branchState.js';
import { restoreCapturedVariables } from './captureState.js';

export const METADATA_KEY = 'dynamicEventsState';
const LOG_PREFIX = '[DynEvents]';

export function getMetadata() {
    const context = getContext();
    return chat_metadata || context.chatMetadata || null;
}

export function resolveRuntimeState(options = {}) {
    const chat = getContext().chat || [];
    const requestedIndex = Number(options.messageIndex);
    const messageIndex = Number.isInteger(requestedIndex)
        ? Math.max(0, Math.min(requestedIndex, Math.max(0, chat.length - 1)))
        : chat.length - 1;
    const swipeId = options.swipeId ?? activeSwipeId(chat[messageIndex]);
    const trace = chat.length
        ? resolveBranchStateDetailed(chat, messageIndex, swipeId)
        : { state: null, sourceMessageIndex: -1, sourceSwipeId: 0, distance: Infinity };
    const legacyState = getMetadata()?.[METADATA_KEY] ?? null;

    return {
        found: Boolean(trace.state || legacyState),
        messageIndex,
        swipeId,
        sourceMessageIndex: trace.sourceMessageIndex,
        sourceSwipeId: trace.sourceSwipeId,
        distance: trace.distance,
        legacyFallback: !trace.state && Boolean(legacyState),
        state: trace.state || legacyState || createChatState(),
    };
}

export function getChatState() {
    return resolveRuntimeState().state;
}

export function saveChatState(state = getChatState(), options = {}) {
    const chat = getContext().chat || [];
    const requestedIndex = Number(options.messageIndex);
    const messageIndex = Number.isInteger(requestedIndex)
        ? Math.max(0, Math.min(requestedIndex, Math.max(0, chat.length - 1)))
        : chat.length - 1;
    const message = chat[messageIndex];
    const swipeId = options.swipeId ?? activeSwipeId(message);
    const metadata = getMetadata();
    if (!metadata) return;

    try {
        JSON.stringify(state);
        if (message) storeStateSnapshot(message, state, swipeId);
        metadata[METADATA_KEY] = cloneRuntimeState(state);
        if (message) saveChatDebounced();
        saveMetadataDebounced();
    } catch (error) {
        console.error(LOG_PREFIX, 'Chat state serialization failed — save skipped:', error);
        toastr.error('Dynamic Events: chat state save failed. Check console.');
    }
}

export function mirrorVisibleState() {
    const resolved = resolveRuntimeState();
    const metadata = getMetadata();
    if (!metadata || !resolved.state) return;
    metadata[METADATA_KEY] = cloneRuntimeState(resolved.state);
    restoreCapturedVariables(metadata, resolved.state);
    saveMetadataDebounced();
}
