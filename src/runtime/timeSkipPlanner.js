import { getContext } from '../../../../../extensions.js';
import {
    extension_prompt_types,
    generateQuietPrompt,
    setExtensionPrompt,
    systemUserName,
} from '../../../../../../script.js';

const LOG_PREFIX = '[DynEvents]';
const REPLY_PROMPT_KEY = 'dynevt_time_skip_reply';
let activeTransition = null;
export const DEFAULT_TIME_SKIP_REPLY_PROMPT = `Continue the roleplay after the time skip by opening a playable new scene at the time and place established by the narrator.

Move the story forward into a concrete situation happening now. Put the responding character or cast onstage in active circumstances and introduce a development already in motion, such as an encounter, task, interruption, discovery, problem, offer, conflict, or opportunity. Give the user character a clear way to engage without deciding how they respond. If the user character is offstage, do more than react to their absence: advance a goal, consequence, pursuit, contact, or event that makes the next interaction imminent while leaving the user's exact whereabouts and choices open. End with unresolved action or tension in progress rather than a blank scene the user must invent.

Do not merely recount the skipped interval or close out the previous scene. Do not end with the responder simply leaving, going to sleep, reflecting alone, cleaning up, or otherwise ending the beat. Do not repeat or summarize the narrator transition. Do not invent actions, thoughts, dialogue, decisions, or consent for the user character.`;

function clean(value, maxLength = 2000) {
    return String(value ?? '').trim().slice(0, maxLength);
}

function narrationText(value) {
    let text = clean(value, 2000);
    const wrapped = (text.startsWith('"') && text.endsWith('"'))
        || (text.startsWith('“') && text.endsWith('”'));
    if (wrapped) text = text.slice(1, -1).trim();
    return text;
}

function currentRoster(context = getContext()) {
    const characters = Array.isArray(context?.characters) ? context.characters : [];
    const group = context?.groupId
        ? context.groups?.find(item => String(item.id) === String(context.groupId))
        : null;
    const muted = new Set(group?.disabled_members || []);
    const selected = group
        ? (group.members || [])
            .filter(avatar => !muted.has(avatar))
            .map(avatar => characters.find(character => character?.avatar === avatar))
        : [characters[context?.characterId]];
    const seen = new Set();
    const responders = selected.map(character => clean(character?.name ?? character?.data?.name, 160))
        .filter(name => {
            const key = name.toLocaleLowerCase();
            if (!name || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    return { responders, isGroup: Boolean(group) };
}

function extractJsonObject(text) {
    const source = String(text ?? '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/i, '').trim();
    for (let start = source.indexOf('{'); start >= 0; start = source.indexOf('{', start + 1)) {
        let depth = 0;
        let quoted = false;
        let escaped = false;
        for (let index = start; index < source.length; index += 1) {
            const character = source[index];
            if (quoted) {
                if (escaped) escaped = false;
                else if (character === '\\') escaped = true;
                else if (character === '"') quoted = false;
                continue;
            }
            if (character === '"') quoted = true;
            else if (character === '{') depth += 1;
            else if (character === '}' && --depth === 0) return JSON.parse(source.slice(start, index + 1));
        }
    }
    throw new Error('The planner did not return a JSON object.');
}

function resolveResponder(candidate, responders) {
    const requested = clean(candidate, 160).toLocaleLowerCase();
    return responders.find(name => name.toLocaleLowerCase() === requested) || responders[0] || '';
}

function recentStoryProse(chat) {
    const excerpts = [];
    for (let index = chat.length - 1; index >= 0 && excerpts.length < 3 && index >= chat.length - 20; index -= 1) {
        const message = chat[index];
        if (message?.is_system || message?.is_hidden) continue;
        const prose = String(message?.mes ?? '').trim().slice(-450);
        if (prose) excerpts.push(prose);
    }
    return excerpts.reverse();
}

function slashValue(value) {
    return `"${String(value ?? '')
        .replaceAll('"', '\\"')
        .replaceAll('|', '\\|')
        .replaceAll('{{', '\\{\\{')
        .replaceAll('{:', '\\{:')
        .replaceAll(':}', '\\:}')}"`;
}

function strictQuotedValue(value) {
    return `"${String(value ?? '')
        .replaceAll('\\', '\\\\')
        .replaceAll('"', '\\"')
        .replaceAll('{{', '\\{\\{')}\"`;
}

async function execute(command) {
    const context = getContext();
    if (typeof context.executeSlashCommandsWithOptions === 'function') {
        return context.executeSlashCommandsWithOptions(command, {
            handleParserErrors: true,
            source: 'dynamicEvents',
        });
    }
    if (typeof context.executeSlashCommands === 'function') return context.executeSlashCommands(command, true);
    throw new Error('SillyTavern slash commands are unavailable.');
}

export function getTimeSkipRoster() {
    return currentRoster();
}

export async function planTimeSkip({ request, worldBaseline = '' }) {
    const { responders } = currentRoster();
    if (!responders.length) throw new Error('No available character was found in this chat.');
    const recentProse = recentStoryProse(getContext().chat || []);
    const prompt = [
        'Plan a seamless roleplay time skip using the current conversation as context.',
        `Requested transition: ${clean(request, 1200)}`,
        worldBaseline ? `Current tracked world time: ${clean(worldBaseline, 500)}` : '',
        recentProse.length ? `Recent story prose for narrative tense and voice only: ${JSON.stringify(recentProse)}` : '',
        `Allowed responders (copy one name exactly): ${JSON.stringify(responders)}`,
        'Return only one valid JSON object with exactly these string fields:',
        '{"transition":"A concise neutral-narrator bridge of 1-3 sentences that opens at the requested time without deciding actions, thoughts, dialogue, or consent for the user character.","responder":"One exact name from the allowed responders list."}',
        'Match the established narrative tense and person in recent descriptive prose, including narration around dialogue. If the prose mixes tenses, follow the most recent scene narration. Preserve established commitments, locations, relationships, injuries, and calendar continuity. Only summarize events during the gap when the request explicitly supplies them. Write the transition as plain prose and do not enclose it in quotation marks. Do not include markdown or commentary.',
    ].filter(Boolean).join('\n\n');
    const raw = await generateQuietPrompt({
        quietPrompt: prompt,
        quietName: 'Time Skip Planner',
        skipWIAN: true,
        responseLength: 350,
    });
    const parsed = extractJsonObject(raw);
    const transition = narrationText(parsed?.transition);
    if (!transition) throw new Error('The planner returned an empty transition.');
    return {
        transition,
        responder: resolveResponder(parsed?.responder ?? parsed?.speaker, responders),
    };
}

export async function insertTimeSkipTransition(transition, narratorName = 'Narrator') {
    const text = narrationText(transition);
    const displayName = clean(narratorName, 80) || 'Narrator';
    if (!text) throw new Error('The narrator transition is empty.');
    const previousName = clean(systemUserName, 80) || 'System';
    const changedName = displayName !== previousName;
    if (changedName) await execute(`/sysname ${slashValue(displayName)}`);
    try {
        await execute(`/parser-flag STRICT_ESCAPING | /sys raw=false ${strictQuotedValue(text)}`);
        const chat = getContext().chat || [];
        activeTransition = { messageIndex: chat.length - 1, text };
    } finally {
        if (changedName) {
            try {
                await execute(`/sysname ${slashValue(previousName)}`);
            } catch (error) {
                console.error(LOG_PREFIX, 'Could not restore the system narrator name:', error);
            }
        }
    }
}

export function clearTimeSkipReplyPrompt() {
    setExtensionPrompt(REPLY_PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 0);
    activeTransition = null;
}

export function reconcileTimeSkipReplyPrompt() {
    if (!activeTransition) {
        clearTimeSkipReplyPrompt();
        return false;
    }
    const chat = getContext().chat || [];
    const atIndex = chat[activeTransition.messageIndex];
    if (atIndex?.mes === activeTransition.text && atIndex?.is_system !== false) return true;
    const survivingIndex = chat.findIndex(message => message?.mes === activeTransition.text && message?.is_system !== false);
    if (survivingIndex >= 0) {
        activeTransition.messageIndex = survivingIndex;
        return true;
    }
    clearTimeSkipReplyPrompt();
    return false;
}

export async function triggerTimeSkipReply(responder, isGroup, prompt = DEFAULT_TIME_SKIP_REPLY_PROMPT) {
    const name = clean(responder, 160);
    if (isGroup && !name) throw new Error('Choose a responder for this group chat.');
    const instruction = clean(prompt, 4000) || DEFAULT_TIME_SKIP_REPLY_PROMPT;
    setExtensionPrompt(REPLY_PROMPT_KEY, instruction, extension_prompt_types.IN_CHAT, 0, false, 0);
    try {
        await execute(isGroup ? `/trigger ${slashValue(name)}` : '/trigger');
    } catch (error) {
        clearTimeSkipReplyPrompt();
        console.error(LOG_PREFIX, 'Could not start the time-skip reply:', error);
        throw error;
    }
}
