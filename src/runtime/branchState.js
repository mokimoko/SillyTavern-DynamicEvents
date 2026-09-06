/** Per-message storage for branch/swipe-aware Dynamic Events runtime state. */

export const MESSAGE_STATE_KEY = 'dynamicEventsStateSwipes';

export function cloneRuntimeState(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

export function activeSwipeId(message) {
    return Number(message?.swipe_id) || 0;
}

export function readStateSnapshot(message, swipeId = activeSwipeId(message)) {
    const records = message?.[MESSAGE_STATE_KEY];
    if (!records || !Object.prototype.hasOwnProperty.call(records, swipeId)) return null;
    return records[swipeId] ?? null;
}

export function hasStateSnapshot(message, swipeId = activeSwipeId(message)) {
    return Boolean(message?.[MESSAGE_STATE_KEY]
        && Object.prototype.hasOwnProperty.call(message[MESSAGE_STATE_KEY], swipeId));
}

export function storeStateSnapshot(message, state, swipeId = activeSwipeId(message)) {
    if (!message || !state) return null;
    if (!message[MESSAGE_STATE_KEY]) message[MESSAGE_STATE_KEY] = {};
    const snapshot = cloneRuntimeState(state);
    message[MESSAGE_STATE_KEY][swipeId] = snapshot;
    return snapshot;
}

/**
 * Resolve the scheduler state on the visible branch by walking backward. Each
 * older message is read through its own active swipe, matching SillyTavern's
 * visible-branch model.
 */
export function resolveBranchStateDetailed(chat, startIndex, startSwipeId) {
    const miss = { state: null, sourceMessageIndex: -1, sourceSwipeId: 0, distance: Infinity };
    if (!Array.isArray(chat) || chat.length === 0) return miss;

    const requested = Number(startIndex);
    const firstIndex = Number.isInteger(requested)
        ? Math.max(0, Math.min(requested, chat.length - 1))
        : chat.length - 1;
    let index = firstIndex;
    let swipeId = startSwipeId === undefined || startSwipeId === null
        ? activeSwipeId(chat[index])
        : Number(startSwipeId) || 0;
    let remaining = chat.length + 1;

    while (index >= 0 && remaining-- > 0) {
        const message = chat[index];
        if (!message) break;
        const state = readStateSnapshot(message, swipeId);
        if (state) {
            return {
                state,
                sourceMessageIndex: index,
                sourceSwipeId: swipeId,
                distance: firstIndex - index,
            };
        }
        index -= 1;
        swipeId = index >= 0 ? activeSwipeId(chat[index]) : 0;
    }

    return miss;
}

export function resolveBranchState(chat, startIndex, startSwipeId) {
    return resolveBranchStateDetailed(chat, startIndex, startSwipeId).state;
}

/** A new assistant swipe must inherit from the preceding visible turn. */
export function resolveEvaluationBase(chat, assistantMessageIndex) {
    const previousIndex = Number(assistantMessageIndex) - 1;
    if (!Array.isArray(chat) || previousIndex < 0) return null;
    return resolveBranchState(chat, previousIndex, activeSwipeId(chat[previousIndex]));
}
