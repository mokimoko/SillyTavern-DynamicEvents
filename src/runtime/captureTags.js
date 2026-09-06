import { chat_metadata } from '../../../../../../script.js';
import { getContext, saveMetadataDebounced } from '../../../../../extensions.js';
import { debug } from '../config/settings.js';
import { recordCapturedVariables, restoreCapturedVariables } from './captureState.js';

const CAPTURE_TAG_RE = /<!--DE:(\w+):(.+?)-->/g;
const CAPTURE_STRIP_RE = /<!--DE:\w+:.+?-->/g;

function stripTagsFromMessage(message) {
    if (!message) return false;
    let changed = false;
    if (typeof message.mes === 'string') {
        const clean = message.mes.replace(CAPTURE_STRIP_RE, '').replace(/\n{3,}/g, '\n\n').trimEnd();
        if (clean !== message.mes) { message.mes = clean; changed = true; }
    }
    if (Array.isArray(message.swipes)) {
        for (let index = 0; index < message.swipes.length; index++) {
            if (typeof message.swipes[index] !== 'string') continue;
            const clean = message.swipes[index].replace(CAPTURE_STRIP_RE, '').replace(/\n{3,}/g, '\n\n').trimEnd();
            if (clean !== message.swipes[index]) { message.swipes[index] = clean; changed = true; }
        }
    }
    return changed;
}

/** Capture and strip tags from the latest assistant response only. */
export function processCaptureTags(chatState) {
    const context = getContext();
    const chat = context.chat;
    if (!chat?.length) return;
    const messageIndex = chat.length - 1;
    const message = chat[messageIndex];
    if (!message || message.is_user || typeof message.mes !== 'string') return;

    const matches = [...message.mes.matchAll(CAPTURE_TAG_RE)];
    const capturedValues = {};
    for (const match of matches) {
        Object.defineProperty(capturedValues, match[1], {
            value: match[2].trim(),
            writable: true,
            enumerable: true,
            configurable: true,
        });
        debug(`Capture: {{${match[1]}}} = "${match[2].trim()}"`);
    }
    const metadataChanged = matches.length
        ? recordCapturedVariables(chat_metadata, chatState, capturedValues)
        : restoreCapturedVariables(chat_metadata, chatState);
    if (metadataChanged) {
        saveMetadataDebounced();
    }

    if (stripTagsFromMessage(message)) {
        requestAnimationFrame(() => {
            try {
                const html = context.messageFormatting(message.mes, message.name, message.is_system, message.is_user, messageIndex);
                $(`#chat .mes[mesid="${messageIndex}"] .mes_text`).html(html);
            } catch (error) { debug('DOM strip skipped:', error?.message); }
        });
        context.saveChat();
    }
}

/** Explicit full-history cleanup used by `/dynevt-scrub`. */
export function scrubAllCaptureTags() {
    const context = getContext();
    const chat = context.chat;
    if (!chat?.length) return 0;
    let changedCount = 0;
    for (const message of chat) {
        if (stripTagsFromMessage(message)) changedCount++;
    }
    if (changedCount > 0) {
        context.saveChat();
        requestAnimationFrame(() => {
            for (let index = 0; index < chat.length; index++) {
                const message = chat[index];
                if (!message || typeof message.mes !== 'string') continue;
                try {
                    const html = context.messageFormatting(message.mes, message.name, message.is_system, message.is_user, index);
                    $(`#chat .mes[mesid="${index}"] .mes_text`).html(html);
                } catch { /* data is already clean even if the node is not painted */ }
            }
        });
    }
    return changedCount;
}
