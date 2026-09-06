export const DynamicActionType = Object.freeze({
    PHONE: 'superagents.phone',
    FEED: 'superagents.feed',
});

export const PhoneActionBehavior = Object.freeze({
    CONSIDER: 'consider',
    SEND: 'send',
});

export const FeedActionBehavior = Object.freeze({
    CONSIDER: 'consider',
    PUBLISH: 'publish',
});

export const ActionRecipientMode = Object.freeze({
    ACTIVE_CHARACTER: 'active-character',
    SUBJECT: 'subject',
    COUNTERPART: 'counterpart',
    // Imported settings from before Event subjects existed.
    TRACK_SUBJECT: 'track-subject',
    MANUAL: 'manual',
});

export function createDynamicAction(overrides = {}) {
    overrides = overrides && typeof overrides === 'object' ? overrides : {};
    const recipient = overrides.recipient && typeof overrides.recipient === 'object'
        ? overrides.recipient
        : {};
    return {
        type: DynamicActionType.PHONE,
        enabled: true,
        behavior: PhoneActionBehavior.CONSIDER,
        recipient: {
            mode: ActionRecipientMode.ACTIVE_CHARACTER,
            value: '',
            ...recipient,
        },
        reason: '',
        ...overrides,
        recipient: {
            mode: ActionRecipientMode.ACTIVE_CHARACTER,
            value: '',
            ...recipient,
        },
    };
}

export function normalizeDynamicActions(actions) {
    return Array.isArray(actions) ? actions.map(action => {
        const normalized = createDynamicAction(action);
        if (normalized.type === DynamicActionType.FEED) {
            normalized.behavior = normalized.behavior === FeedActionBehavior.PUBLISH
                ? FeedActionBehavior.PUBLISH
                : FeedActionBehavior.CONSIDER;
        } else if (normalized.type === DynamicActionType.PHONE) {
            normalized.behavior = normalized.behavior === PhoneActionBehavior.SEND
                ? PhoneActionBehavior.SEND
                : PhoneActionBehavior.CONSIDER;
        }
        if (normalized.recipient.mode === ActionRecipientMode.TRACK_SUBJECT) {
            normalized.recipient.mode = ActionRecipientMode.SUBJECT;
        }
        return normalized;
    }) : [];
}

export function resolveActionRecipient(action, context = {}) {
    switch (action?.recipient?.mode) {
        case ActionRecipientMode.SUBJECT:
        case ActionRecipientMode.TRACK_SUBJECT:
            return String(context.subject || '').trim();
        case ActionRecipientMode.COUNTERPART:
            return String(context.counterpart || '').trim();
        case ActionRecipientMode.MANUAL:
            return String(action.recipient.value || '').trim();
        case ActionRecipientMode.ACTIVE_CHARACTER:
        default:
            return String(context.charName || '').trim();
    }
}

export function renderActionReason(reason, context = {}, recipient = '') {
    return String(reason || '')
        .replace(/\{\{subject\}\}/g, () => String(context.subject || recipient))
        .replace(/\{\{counterpart\}\}/g, () => String(context.counterpart || ''))
        .replace(/\{\{char\}\}/g, () => String(context.charName || recipient));
}
