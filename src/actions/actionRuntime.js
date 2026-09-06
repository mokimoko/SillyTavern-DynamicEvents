import {
    DynamicActionType,
    renderActionReason,
    resolveActionRecipient,
} from './actionTypes.js';

const handlers = new Map();

export function registerActionHandler(type, handler) {
    if (!type || typeof handler?.execute !== 'function') {
        throw new TypeError('Action handlers require a type and execute() function.');
    }
    handlers.set(type, Object.freeze({ ...handler, type }));
}

export function listActionHandlers() {
    return [...handlers.values()].map(handler => ({
        type: handler.type,
        label: (typeof handler.label === 'function' ? handler.label() : handler.label) || handler.type,
        available: handler.available?.() ?? true,
    }));
}

export async function executeDynamicActions(actions, context = {}) {
    const tasks = [];
    for (const action of (actions || [])) {
        if (action?.enabled === false) continue;
        const handler = handlers.get(action?.type);
        if (!handler || handler.available?.() === false) continue;
        tasks.push(Promise.resolve().then(() => handler.execute(action, context)));
    }
    return Promise.allSettled(tasks);
}

registerActionHandler(DynamicActionType.PHONE, {
    label: () => `SuperAgents ${globalThis.SuperAgents?.integration?.presentation?.getSurface?.('phone')?.label || 'Phone'}`,
    available: () => Boolean(globalThis.SuperAgents?.integration?.phone?.isEnabled?.()),
    execute: (action, context) => {
        const character = resolveActionRecipient(action, context);
        if (!character) return { accepted: false, textsGenerated: 0, error: 'recipient is unavailable' };
        return globalThis.SuperAgents.integration.phone.requestText({
            character,
            behavior: action.behavior,
            reason: renderActionReason(action.reason, context, character),
            messageIndex: context.messageIndex,
            swipeId: context.swipeId,
            source: context.source || 'dynamic-events',
        });
    },
});

registerActionHandler(DynamicActionType.FEED, {
    label: () => `SuperAgents ${globalThis.SuperAgents?.integration?.presentation?.getSurface?.('feed')?.label || 'Feed'}`,
    available: () => Boolean(globalThis.SuperAgents?.integration?.feed?.isEnabled?.()),
    execute: (action, context) => {
        const author = resolveActionRecipient(action, context);
        if (!author) return { accepted: false, postsGenerated: 0, error: 'author is unavailable' };
        return globalThis.SuperAgents.integration.feed.requestPost({
            author,
            behavior: action.behavior,
            reason: renderActionReason(action.reason, context, author),
            messageIndex: context.messageIndex,
            swipeId: context.swipeId,
            source: context.source || 'dynamic-events',
        });
    },
});
