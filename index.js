/**
 * SillyTavern-DynamicEvents
 * Schedule-and-probability-triggered event injection system.
 *
 * Replaces complex lorebook event hacks with a proper extension that manages
 * recurring, one-shot, and plot-chain events via configurable schedules.
 */

import {
    eventSource, event_types,
    saveSettingsDebounced,
    setExtensionPrompt,
    extension_prompt_types,
    extension_prompt_roles,
    chat_metadata,
    this_chid,
    characters,
} from '../../../../script.js';

import {
    getContext,
    extension_settings,
    renderExtensionTemplateAsync,
    saveMetadataDebounced,
} from '../../../extensions.js';

import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from '../../../slash-commands/SlashCommandArgument.js';

import {
    evaluateEvents,
    createEventSet, createEvent, createPhase, createChatState, createCondition,
    getEventState, getEventStatus, isSetActive, generateId,
    evaluateCondition,
    ScheduleType, EventCategory, BindMode, InjectionMode, SetRole,
    ConditionType, ConditionBehavior,
    PromptPosition, PromptRole, CATEGORY_PRIORITY,
} from './eventEngine.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const EXTENSION_NAME = 'Dynamic Events';
const LOG_PREFIX = '[DynEvents]';
const SETTINGS_KEY = 'dynamicEvents';
const PROMPT_KEY_PREFIX = 'dynevt_';
const METADATA_KEY = 'dynamicEventsState';

const EXTENSION_FOLDER = (() => {
    try {
        const url = import.meta.url;
        // Match the folder name whether served as .../extensions/third-party/<name>/
        // or .../extensions/<name>/ (per-user installs under data/<user>/extensions).
        const match = url.match(/\/extensions\/(?:third-party\/)?([^/]+)\//);
        if (match) return match[1];
    } catch { /* ignore */ }
    return 'SillyTavern-DynamicEvents';
})();
const TEMPLATE_NAMESPACE = `third-party/${EXTENSION_FOLDER}`;

const MODAL_ID = 'dynevt-modal';
const OVERLAY_ID = 'dynevt-overlay';

const DEFAULT_SETTINGS = {
    enabled: true,
    maxConcurrentEvents: 2,
    eventSets: [],
    debugLog: false,
};

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let macroBuffer = '';
let isPopupOpen = false;
let selectedSetId = null;
let selectedEventId = null;
let collapsedPhases = new Set(); // track collapsed phase IDs (UI-only, not persisted)
let lastChatLength = 0; // swipe detection: tracks actual chat length between evaluations

// ═══════════════════════════════════════════════════════════════
// SETTINGS ACCESS
// ═══════════════════════════════════════════════════════════════

function getSettings() {
    if (!extension_settings[SETTINGS_KEY]) {
        extension_settings[SETTINGS_KEY] = structuredClone(DEFAULT_SETTINGS);
    }
    return extension_settings[SETTINGS_KEY];
}

/** One-time migration for sets missing role/parentSetId (added in v0.1.0) */
let _migrated = false;
function migrateSettings() {
    if (_migrated) return;
    _migrated = true;
    const settings = getSettings();
    let changed = false;
    settings.eventSets?.forEach(s => {
        if (!s.role) { s.role = SetRole.PRIMARY; changed = true; }
        if (s.parentSetId === undefined) { s.parentSetId = null; changed = true; }
    });
    if (changed) saveSettingsDebounced();
}

function saveSettings() {
    try {
        // Sanity check: ensure settings are JSON-serializable before handing to ST
        JSON.stringify(extension_settings[SETTINGS_KEY]);
        saveSettingsDebounced();
    } catch (err) {
        console.error(LOG_PREFIX, 'Settings serialization failed — save skipped:', err);
        toastr.error('Dynamic Events: settings save failed. Check console.');
    }
}

function getChatState() {
    // chat_metadata can briefly be undefined very early in load; guard so a
    // fresh-chat read doesn't throw and the created state actually sticks.
    const ctx = getContext();
    const meta = chat_metadata || ctx.chatMetadata;
    if (!meta) {
        // No metadata object yet — return a throwaway so callers don't crash.
        // It will be re-created and persisted once metadata is available.
        return createChatState();
    }
    if (!meta[METADATA_KEY]) {
        meta[METADATA_KEY] = createChatState();
    }
    return meta[METADATA_KEY];
}

function saveChatState() {
    try {
        JSON.stringify(getChatState());
        saveMetadataDebounced();
    } catch (err) {
        console.error(LOG_PREFIX, 'Chat state serialization failed — save skipped:', err);
        toastr.error('Dynamic Events: chat state save failed. Check console.');
    }
}

function getCurrentCharacterName() {
    const ctx = getContext();
    if (ctx.groupId) return '';
    if (this_chid !== undefined && characters[this_chid]) {
        return characters[this_chid].name || '';
    }
    return '';
}

// ═══════════════════════════════════════════════════════════════
// CORE: EVENT EVALUATION & INJECTION
// ═══════════════════════════════════════════════════════════════

function onMessageReceived() {
    const settings = getSettings();
    if (!settings.enabled) {
        clearAllInjections(settings);
        return;
    }

    // Swipe detection: if chat length hasn't grown, this is a regeneration/swipe
    const currentLength = getContext().chat?.length || 0;
    if (currentLength <= lastChatLength) {
        debug('Swipe detected — skipping event evaluation');
        return;
    }
    lastChatLength = currentLength;

    // Process any capture tags from the AI's response before evaluating events
    processCaptureTags();

    const chatState = getChatState();
    const charName = getCurrentCharacterName();

    const { fired, texts } = evaluateEvents(
        settings.eventSets, chatState, charName, settings.maxConcurrentEvents, currentLength,
    );

    clearAllInjections(settings);
    macroBuffer = '';

    for (const [eventId, { text, injection }] of texts) {
        if (injection.mode === InjectionMode.EXTENSION_PROMPT) {
            const key = `${PROMPT_KEY_PREFIX}${eventId}`;
            setExtensionPrompt(key, text, injection.position, injection.depth, false, injection.role);
            debug(`Injected: ${eventId}`);
        } else if (injection.mode === InjectionMode.MACRO) {
            macroBuffer += (macroBuffer ? '\n' : '') + text;
            debug(`Macro queued: ${eventId}`);
        }
    }

    if (fired.length > 0) {
        debug(`Fired ${fired.length}: ${fired.map(e => e.name).join(', ')}`);
    }

    saveChatState();
    updateDrawerStatus();
}

function clearAllInjections(settings) {
    for (const set of settings.eventSets) {
        for (const event of set.events) {
            // Clear using the event's own position/depth so cleanup matches how it
            // was set (some ST versions key prompt slots by position, not just name).
            const pos = event.injection?.position ?? extension_prompt_types.IN_CHAT;
            const depth = event.injection?.depth ?? 0;
            setExtensionPrompt(`${PROMPT_KEY_PREFIX}${event.id}`, '', pos, depth);
        }
    }
    macroBuffer = '';
}

const CAPTURE_TAG_RE = /<!--DE:(\w+):(.+?)-->/g;
const CAPTURE_STRIP_RE = /<!--DE:\w+:.+?-->/g;

/**
 * Strip capture tags from a single message object (its .mes and every swipe).
 * Returns true if anything changed. Pure data mutation — no DOM, no save.
 */
function stripTagsFromMessage(msg) {
    if (!msg) return false;
    let changed = false;

    if (typeof msg.mes === 'string') {
        const clean = msg.mes.replace(CAPTURE_STRIP_RE, '').replace(/\n{3,}/g, '\n\n').trimEnd();
        if (clean !== msg.mes) { msg.mes = clean; changed = true; }
    }

    if (Array.isArray(msg.swipes)) {
        for (let s = 0; s < msg.swipes.length; s++) {
            if (typeof msg.swipes[s] !== 'string') continue;
            const clean = msg.swipes[s].replace(CAPTURE_STRIP_RE, '').replace(/\n{3,}/g, '\n\n').trimEnd();
            if (clean !== msg.swipes[s]) { msg.swipes[s] = clean; changed = true; }
        }
    }

    return changed;
}

/**
 * Capture <!--DE:varName:value--> tags from the LATEST AI message and strip
 * them from that message only. Runs after each AI response.
 *
 * Deliberately scoped to the last message: it's the only place a tag can have
 * just appeared. We do NOT sweep or re-save the whole history here — that was
 * a per-load full re-serialize that risked clobbering chat files. For a
 * one-time cleanup of old leaked tags, use /dynevt-scrub.
 */
function processCaptureTags() {
    const context = getContext();
    const chat = context.chat;
    if (!chat?.length) return;

    const idx = chat.length - 1;
    const lastMsg = chat[idx];
    if (!lastMsg || lastMsg.is_user || typeof lastMsg.mes !== 'string') return;

    // --- Capture values ---
    const matches = [...lastMsg.mes.matchAll(CAPTURE_TAG_RE)];
    if (matches.length) {
        if (!chat_metadata.variables) chat_metadata.variables = {};
        for (const match of matches) {
            chat_metadata.variables[match[1]] = match[2].trim();
            debug(`Capture: {{${match[1]}}} = "${match[2].trim()}"`);
        }
        saveMetadataDebounced();
    }

    // --- Strip from this message only (data + DOM) ---
    if (stripTagsFromMessage(lastMsg)) {
        // Defer the DOM update so the message node is painted before we touch it.
        requestAnimationFrame(() => {
            try {
                const html = context.messageFormatting(lastMsg.mes, lastMsg.name, lastMsg.is_system, lastMsg.is_user, idx);
                $(`#chat .mes[mesid="${idx}"] .mes_text`).html(html);
            } catch (e) { debug('DOM strip skipped:', e?.message); }
        });
        context.saveChat();
    }
}

/**
 * Manual, opt-in full-history scrub. Walks every message + swipe, removes any
 * leftover capture tags, and saves once. This is the heavy operation that used
 * to run on every chat load; now it only runs when the user asks for it.
 */
function scrubAllCaptureTags() {
    const context = getContext();
    const chat = context.chat;
    if (!chat?.length) return 0;

    let changedCount = 0;
    for (const msg of chat) {
        if (stripTagsFromMessage(msg)) changedCount++;
    }

    if (changedCount > 0) {
        context.saveChat();
        // Re-render visible messages whose text we touched
        requestAnimationFrame(() => {
            for (let i = 0; i < chat.length; i++) {
                const msg = chat[i];
                if (!msg || typeof msg.mes !== 'string') continue;
                try {
                    const html = context.messageFormatting(msg.mes, msg.name, msg.is_system, msg.is_user, i);
                    $(`#chat .mes[mesid="${i}"] .mes_text`).html(html);
                } catch { /* node may not be painted; data is already clean */ }
            }
        });
    }
    return changedCount;
}

/**
 * Prime injections on chat load (CHAT_CHANGED) so they're ready for the first
 * generation — including swipes before any MESSAGE_RECEIVED has fired.
 *
 * Runs evaluateEvents against a CLONED chatState so message counters and event
 * states aren't advanced. Only the injection side-effects (setExtensionPrompt,
 * macroBuffer) are kept.
 */
function primeInjections() {
    const settings = getSettings();
    if (!settings.enabled) {
        clearAllInjections(settings);
        return;
    }

    try {
        const realState = getChatState();
        const clonedState = structuredClone(realState);
        const charName = getCurrentCharacterName();

        const { texts } = evaluateEvents(
            settings.eventSets, clonedState, charName, settings.maxConcurrentEvents,
        );

        clearAllInjections(settings);
        macroBuffer = '';

        for (const [eventId, { text, injection }] of texts) {
            if (injection.mode === InjectionMode.EXTENSION_PROMPT) {
                const key = `${PROMPT_KEY_PREFIX}${eventId}`;
                setExtensionPrompt(key, text, injection.position, injection.depth, false, injection.role);
                debug(`Primed injection: ${eventId}`);
            } else if (injection.mode === InjectionMode.MACRO) {
                macroBuffer += (macroBuffer ? '\n' : '') + text;
                debug(`Primed macro: ${eventId}`);
            }
        }

        // clonedState is discarded — real chatState untouched
        debug('Primed injections on chat load');
    } catch (e) {
        console.warn(LOG_PREFIX, 'Failed to prime injections:', e);
    }
}

// ═══════════════════════════════════════════════════════════════
// MACRO
// ═══════════════════════════════════════════════════════════════

let _macroRegistered = false;
function registerMacro() {
    try {
        const macroSystem = window?.SillyTavern?.macros;
        if (macroSystem?.register) {
            macroSystem.register({
                name: 'dynamicEvents',
                description: 'Inserts active dynamic event text.',
                returns: 'Active event text or empty string.',
                handler: () => macroBuffer,
            });
            _macroRegistered = true;
            debug('Registered {{dynamicEvents}} macro');
        }
    } catch (e) {
        debug('Macro system unavailable');
    }
    return _macroRegistered;
}

/** True if any enabled event in any set uses MACRO injection mode. */
function anyMacroEventsConfigured() {
    return getSettings().eventSets.some(set =>
        set.events.some(e => e.enabled && e.injection?.mode === InjectionMode.MACRO),
    );
}

// ═══════════════════════════════════════════════════════════════
// SLASH COMMANDS
// ═══════════════════════════════════════════════════════════════

function registerSlashCommands() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'dynevt-fire',
        callback: (_, value) => {
            const name = value?.trim();
            if (!name) { toastr.warning('Usage: /dynevt-fire [event name]'); return ''; }
            const result = forceFireEvent(name);
            toastr.info(result, 'Dynamic Events');
            return result;
        },
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({ description: 'Event name', typeList: [ARGUMENT_TYPE.STRING], isRequired: true }),
        ],
        helpString: 'Force-fire a dynamic event by name.',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'dynevt-reset',
        callback: (_, value) => {
            const target = value?.trim();
            if (!target) {
                resetAllEventStates();
                toastr.info('Reset all event states.', 'Dynamic Events');
                return 'Reset all event states.';
            }
            const result = resetEventState(target);
            toastr.info(result, 'Dynamic Events');
            return result;
        },
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({ description: 'Event name (omit for all)', typeList: [ARGUMENT_TYPE.STRING], isRequired: false }),
        ],
        helpString: 'Reset event counters. Omit name to reset all.',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'dynevt-status',
        callback: () => {
            const report = getStatusReport();
            toastr.info(report.replace(/\n/g, '<br>'), 'Dynamic Events', { escapeHtml: false, timeOut: 10000 });
            return report;
        },
        helpString: 'Show dynamic events status.',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'dynevt-scrub',
        callback: () => {
            const n = scrubAllCaptureTags();
            const msg = n > 0 ? `Scrubbed capture tags from ${n} message(s).` : 'No capture tags found.';
            toastr.info(msg, 'Dynamic Events');
            return msg;
        },
        helpString: 'Remove any leftover <!--DE:...--> capture tags from the entire chat history.',
    }));
}

function forceFireEvent(eventName) {
    // Note: a force-fired injection deliberately persists across swipes of the
    // pending turn (a swipe is "regenerate this turn", and the user wants the
    // event present for it). It is cleared automatically by clearAllInjections()
    // on the next *real* message, so it never leaks past one turn.
    const settings = getSettings();
    const chatState = getChatState();
    const nameLower = eventName.toLowerCase();
    for (const set of settings.eventSets) {
        for (const event of set.events) {
            if (event.name.toLowerCase() === nameLower) {
                const text = event.schedule.type === ScheduleType.PLOT_CHAIN
                    ? event.phases?.[getEventState(chatState, event).currentPhase]?.text || event.text
                    : event.text;
                if (event.injection.mode === InjectionMode.EXTENSION_PROMPT) {
                    setExtensionPrompt(`${PROMPT_KEY_PREFIX}${event.id}`, text, event.injection.position, event.injection.depth, false, event.injection.role);
                } else { macroBuffer += (macroBuffer ? '\n' : '') + text; }
                return `Force-fired: ${event.name}`;
            }
        }
    }
    return `Event not found: ${eventName}`;
}

function resetEventState(name) {
    const settings = getSettings();
    const chatState = getChatState();
    for (const set of settings.eventSets) {
        for (const event of set.events) {
            if (event.name.toLowerCase() === name.toLowerCase()) {
                delete chatState.eventStates[event.id];
                saveChatState();
                clearAllInjections(settings);
                primeInjections();
                updateDrawerStatus();
                return `Reset: ${event.name}`;
            }
        }
    }
    return `Not found: ${name}`;
}

function resetAllEventStates() {
    const cs = getChatState();
    cs.messageCount = 0;
    cs.eventStates = {};
    saveChatState();
    clearAllInjections(getSettings());
    primeInjections();
    updateDrawerStatus();
}

function getStatusReport() {
    const s = getSettings(), cs = getChatState(), ch = getCurrentCharacterName();
    const chatLength = getContext().chat?.length || 0;
    const drift = cs.messageCount !== chatLength ? ` (sched tick ${cs.messageCount})` : '';
    const lines = [`Dynamic Events — Message #${chatLength}${drift}`];
    for (const set of s.eventSets) {
        const active = isSetActive(set, ch);
        lines.push(`\n[${active ? '✓' : '✗'}] ${set.name} (${set.bindMode})`);
        for (const evt of set.events) lines.push(`  ${evt.enabled ? '●' : '○'} ${evt.name}: ${getEventStatus(evt, cs)}`);
    }
    return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// DRAWER UI (minimal — just toggle + open button)
// ═══════════════════════════════════════════════════════════════

async function loadDrawerUI() {
    const html = await renderExtensionTemplateAsync(TEMPLATE_NAMESPACE, 'settings');
    $('#extensions_settings2').append(html);

    $('#dynevt-enabled').on('change', function () {
        getSettings().enabled = this.checked;
        saveSettings();
        if (!this.checked) {
            clearAllInjections(getSettings());
        } else {
            primeInjections();
        }
        updateDrawerStatus();
    }).prop('checked', getSettings().enabled);

    $('#dynevt-open-popup').on('click', openPopup);

    updateDrawerStatus();
}

function updateDrawerStatus() {
    const s = getSettings();
    const charName = getCurrentCharacterName();
    const activeSets = s.eventSets.filter(set => isSetActive(set, charName));
    const totalEvents = activeSets.reduce((n, set) => n + set.events.filter(e => e.enabled).length, 0);
    const msgCount = getContext().chat?.length || 0;
    $('#dynevt-drawer-status').text(
        s.enabled ? `${activeSets.length} set(s), ${totalEvents} event(s) — msg #${msgCount}` : 'Disabled',
    );
}

// ═══════════════════════════════════════════════════════════════
// WAND MENU (Extensions menu in chat input area)
// ═══════════════════════════════════════════════════════════════

function addWandMenuItem() {
    const menuItem = $(`
        <div id="dynevt_wand_button" class="list-group-item flex-container flexGap5">
            <div class="fa-solid fa-bolt extensionsMenuExtensionButton"></div>
            <span>Dynamic Events</span>
        </div>
    `);
    $('#extensionsMenu').append(menuItem);
    menuItem.on('click', openPopup);
}

// ═══════════════════════════════════════════════════════════════
// POPUP — DOM creation, open/close
// ═══════════════════════════════════════════════════════════════

function ensurePopupDOM() {
    if (document.getElementById(MODAL_ID)) return;

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'dynevt-overlay';
    overlay.addEventListener('click', closePopup);
    document.body.appendChild(overlay);

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'dynevt-modal';
    modal.innerHTML = `
        <div class="dynevt-modal-header">
            <div class="dynevt-modal-title">
                <i class="fa-solid fa-bolt"></i> Dynamic Events
            </div>
            <div class="dynevt-modal-header-controls">
                <label class="dynevt-header-toggle" title="Max concurrent events per message">
                    <span>Max:</span>
                    <input type="number" id="dynevt-max-concurrent" class="dynevt-input dynevt-input-xs" value="2" min="1" max="10" />
                </label>
                <label class="dynevt-header-toggle" title="Log to console">
                    <input type="checkbox" id="dynevt-debug" />
                    <span>Debug</span>
                </label>
                <button id="dynevt-export" class="dynevt-btn" title="Export all sets">
                    <i class="fa-solid fa-file-export"></i> Export
                </button>
                <button id="dynevt-import-btn" class="dynevt-btn" title="Import sets">
                    <i class="fa-solid fa-file-import"></i> Import
                </button>
                <input type="file" id="dynevt-import-file" accept=".json" style="display:none" />
                <div class="dynevt-modal-close" id="dynevt-close">✕</div>
            </div>
        </div>
        <div class="dynevt-modal-body">
            <div class="dynevt-panel-left" id="dynevt-panel-left"></div>
            <div class="dynevt-panel-right" id="dynevt-panel-right"></div>
        </div>
    `;
    document.body.appendChild(modal);

    // Permanent event wiring
    modal.querySelector('#dynevt-close').addEventListener('click', closePopup);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isPopupOpen) closePopup(); });

    $('#dynevt-max-concurrent').on('input', function () {
        getSettings().maxConcurrentEvents = parseInt(this.value) || 2;
        saveSettings();
    });
    $('#dynevt-debug').on('change', function () {
        getSettings().debugLog = this.checked;
        saveSettings();
    });
    $('#dynevt-export').on('click', exportAllSets);
    $('#dynevt-import-btn').on('click', () => $('#dynevt-import-file').trigger('click'));
    $('#dynevt-import-file').on('change', importSets);
}

function openPopup() {
    if (isPopupOpen) return;
    isPopupOpen = true;
    selectedSetId = selectedSetId || getSettings().eventSets[0]?.id || null;

    ensurePopupDOM();

    // Sync header controls
    const s = getSettings();
    $('#dynevt-max-concurrent').val(s.maxConcurrentEvents);
    $('#dynevt-debug').prop('checked', s.debugLog);

    renderSetList();
    renderRightPanel();

    requestAnimationFrame(() => {
        document.getElementById(OVERLAY_ID)?.classList.add('dynevt-visible');
        document.getElementById(MODAL_ID)?.classList.add('dynevt-visible');
    });
}

function closePopup() {
    if (!isPopupOpen) return;
    document.getElementById(OVERLAY_ID)?.classList.remove('dynevt-visible');
    document.getElementById(MODAL_ID)?.classList.remove('dynevt-visible');
    isPopupOpen = false;
    updateDrawerStatus();
}

// ═══════════════════════════════════════════════════════════════
// POPUP — Left panel (Event Sets)
// ═══════════════════════════════════════════════════════════════

/** Sort sets: primaries in their original order, each followed by its secondaries */
function getGroupedSets(eventSets) {
    const primaries = eventSets.filter(s => s.role !== SetRole.SECONDARY || !s.parentSetId);
    const secondaryMap = new Map(); // parentId -> [secondary sets]
    eventSets.forEach(s => {
        if (s.role === SetRole.SECONDARY && s.parentSetId) {
            if (!secondaryMap.has(s.parentSetId)) secondaryMap.set(s.parentSetId, []);
            secondaryMap.get(s.parentSetId).push(s);
        }
    });
    const result = [];
    primaries.forEach(p => {
        result.push(p);
        const children = secondaryMap.get(p.id);
        if (children) result.push(...children);
    });
    return result;
}

/** Revert secondary sets with no parent back to primary (cleanup on selection change) */
function cleanupOrphanedSecondaries(settings) {
    let changed = false;
    settings.eventSets.forEach(s => {
        if (s.role === SetRole.SECONDARY && !s.parentSetId) {
            s.role = SetRole.PRIMARY;
            changed = true;
        }
    });
    if (changed) saveSettings();
}

function renderSetList() {
    const panel = document.getElementById('dynevt-panel-left');
    if (!panel) return;

    const settings = getSettings();
    const charName = getCurrentCharacterName();

    // Build grouped order: primaries first, secondaries indented underneath their parent
    const orderedSets = getGroupedSets(settings.eventSets);

    panel.innerHTML = `
        <div class="dynevt-set-list-header">
            <span class="dynevt-set-list-title">Event Sets</span>
            <button class="dynevt-btn dynevt-btn-accent" id="dynevt-add-set"><i class="fa-solid fa-plus"></i></button>
        </div>
        <div class="dynevt-set-list" id="dynevt-set-list">
            ${settings.eventSets.length === 0
                ? '<div class="dynevt-empty">No event sets yet.</div>'
                : orderedSets.map(set => renderSetRow(set, charName, settings.eventSets)).join('')
            }
        </div>
    `;

    panel.querySelector('#dynevt-add-set')?.addEventListener('click', () => {
        const newSet = createEventSet();
        settings.eventSets.push(newSet);
        saveSettings();
        selectedSetId = newSet.id;
        selectedEventId = null;
        renderSetList();
        renderRightPanel();
    });

    // Wire set rows
    panel.querySelectorAll('.dynevt-set-row').forEach(row => {
        const id = row.dataset.id;

        row.addEventListener('click', (e) => {
            if (e.target.closest('input, button, [data-action]')) return;
            cleanupOrphanedSecondaries(settings);
            selectedSetId = id;
            selectedEventId = null;
            renderSetList();
            renderRightPanel();
        });

        row.querySelector('[data-action="toggle-set"]')?.addEventListener('change', function () {
            const set = settings.eventSets.find(s => s.id === id);
            if (set) {
                set.enabled = this.checked;
                saveSettings();
                clearAllInjections(settings);
                primeInjections();
                renderSetList();
            }
        });

        row.querySelector('[data-action="delete-set"]')?.addEventListener('click', async () => {
            const set = settings.eventSets.find(s => s.id === id);
            if (!set) return;
            const ok = await dynevtConfirm(`Delete "${set.name}" and all its events?`);
            if (!ok) return;
            // Orphan protection: revert any secondaries linked to this set back to primary
            if (set.role === SetRole.PRIMARY) {
                settings.eventSets.forEach(s => {
                    if (s.parentSetId === id) { s.role = SetRole.PRIMARY; s.parentSetId = null; }
                });
            }
            settings.eventSets = settings.eventSets.filter(s => s.id !== id);
            if (selectedSetId === id) { selectedSetId = settings.eventSets[0]?.id || null; selectedEventId = null; }
            saveSettings();
            renderSetList();
            renderRightPanel();
        });
    });
}

function renderSetRow(set, charName, allSets) {
    const active = isSetActive(set, charName);
    const evtCount = set.events.length;
    const isSecondary = set.role === SetRole.SECONDARY && set.parentSetId;
    const bindLabel = set.bindMode === BindMode.CHARACTER
        ? (set.characterBindings.length ? set.characterBindings.join(', ') : 'unbound')
        : '';

    return `
        <div class="dynevt-set-row ${set.id === selectedSetId ? 'selected' : ''} ${active ? '' : 'inactive'} ${isSecondary ? 'dynevt-set-secondary' : ''}" data-id="${set.id}">
            <label class="dynevt-set-toggle" onclick="event.stopPropagation()">
                <input type="checkbox" ${set.enabled ? 'checked' : ''} data-action="toggle-set" />
            </label>
            <div class="dynevt-set-info">
                <span class="dynevt-set-name">${isSecondary ? '<i class="fa-solid fa-turn-up fa-flip-horizontal dynevt-secondary-icon"></i> ' : ''}${esc(set.name)}</span>
                <span class="dynevt-set-meta">
                    ${evtCount} event${evtCount !== 1 ? 's' : ''}
                    ${bindLabel ? ` · <i class="fa-solid fa-link"></i> ${esc(bindLabel)}` : ''}
                </span>
            </div>
            <button class="dynevt-btn-icon" data-action="delete-set" title="Delete" onclick="event.stopPropagation()">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
    `;
}

// ═══════════════════════════════════════════════════════════════
// POPUP — Right panel (Set editor + Events)
// ═══════════════════════════════════════════════════════════════

function renderRightPanel() {
    const panel = document.getElementById('dynevt-panel-right');
    if (!panel) return;

    const settings = getSettings();
    const set = settings.eventSets.find(s => s.id === selectedSetId);

    if (!set) {
        panel.innerHTML = '<div class="dynevt-empty dynevt-empty-big">Select or create an event set.</div>';
        return;
    }

    const primarySets = settings.eventSets.filter(s => s.id !== set.id && s.role !== SetRole.SECONDARY);
    const showParentPicker = set.role === SetRole.SECONDARY;
    const showCharPicker = set.bindMode === BindMode.CHARACTER;
    const showRow2 = showParentPicker || showCharPicker;

    panel.innerHTML = `
        <div class="dynevt-right-header">
            <div class="dynevt-right-header-fields">
                <input type="text" class="dynevt-input" id="dynevt-set-name" value="${esc(set.name)}" placeholder="Set name" />
                <select class="dynevt-select dynevt-select-sm" id="dynevt-set-role">
                    <option value="${SetRole.PRIMARY}" ${set.role === SetRole.PRIMARY ? 'selected' : ''}>Primary</option>
                    <option value="${SetRole.SECONDARY}" ${set.role === SetRole.SECONDARY ? 'selected' : ''}>Secondary</option>
                </select>
                <select class="dynevt-select" id="dynevt-set-bind-mode">
                    <option value="${BindMode.MANUAL}" ${set.bindMode === BindMode.MANUAL ? 'selected' : ''}>Manual</option>
                    <option value="${BindMode.CHARACTER}" ${set.bindMode === BindMode.CHARACTER ? 'selected' : ''}>Bind to Character</option>
                </select>
            </div>
            <div id="dynevt-set-row2" style="display:${showRow2 ? 'flex' : 'none'}; gap: 8px; align-items: center; margin-top: 8px;">
                <div id="dynevt-parent-picker-wrap" style="display:${showParentPicker ? 'block' : 'none'}; min-width: 160px;">
                    <select class="dynevt-select" id="dynevt-set-parent">
                        <option value="">— Parent Set —</option>
                        ${primarySets.map(p => `<option value="${p.id}" ${set.parentSetId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
                    </select>
                </div>
                <div id="dynevt-char-picker-wrap" style="display:${showCharPicker ? 'block' : 'none'}; flex: 1; min-width: 0;">
                    ${renderCharPicker(set)}
                </div>
            </div>
        </div>
        <div class="dynevt-events-header">
            <span>Events</span>
            <button class="dynevt-btn dynevt-btn-accent" id="dynevt-add-event"><i class="fa-solid fa-plus"></i> Add Event</button>
        </div>
        <div class="dynevt-events-area">
            <div class="dynevt-event-list" id="dynevt-event-list">
                ${set.events.length === 0
                    ? '<div class="dynevt-empty">No events in this set.</div>'
                    : set.events.map(evt =>
                        renderEventRow(evt) + (evt.id === selectedEventId ? '<div id="dynevt-event-editor"></div>' : '')
                    ).join('')
                }
            </div>
        </div>
    `;

    // Wire set-level controls
    panel.querySelector('#dynevt-set-name')?.addEventListener('input', function () {
        set.name = this.value; saveSettings(); renderSetList();
    });

    const updateRow2Visibility = () => {
        const show = set.role === SetRole.SECONDARY || set.bindMode === BindMode.CHARACTER;
        const row2 = panel.querySelector('#dynevt-set-row2');
        if (row2) row2.style.display = show ? 'flex' : 'none';
    };

    panel.querySelector('#dynevt-set-role')?.addEventListener('change', function () {
        set.role = this.value;
        const parentWrap = panel.querySelector('#dynevt-parent-picker-wrap');
        if (parentWrap) parentWrap.style.display = set.role === SetRole.SECONDARY ? 'block' : 'none';
        if (set.role !== SetRole.SECONDARY) set.parentSetId = null;
        updateRow2Visibility();
        saveSettings(); renderSetList();
    });

    panel.querySelector('#dynevt-set-parent')?.addEventListener('change', function () {
        set.parentSetId = this.value || null;
        saveSettings(); renderSetList();
    });

    panel.querySelector('#dynevt-set-bind-mode')?.addEventListener('change', function () {
        set.bindMode = this.value;
        const charWrap = panel.querySelector('#dynevt-char-picker-wrap');
        if (charWrap) charWrap.style.display = this.value === BindMode.CHARACTER ? 'block' : 'none';
        updateRow2Visibility();
        saveSettings(); renderSetList();
    });

    wireCharPicker(panel, set);

    panel.querySelector('#dynevt-add-event')?.addEventListener('click', () => {
        const evt = createEvent();
        set.events.push(evt);
        saveSettings();
        selectedEventId = evt.id;
        renderRightPanel();
    });

    wireEventRows(panel, set);

    if (selectedEventId) {
        renderEventEditor(set);
        // Scroll the editor into view within the events area
        const editorEl = document.getElementById('dynevt-event-editor');
        if (editorEl) editorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function renderEventRow(evt) {
    const chatState = chat_metadata?.[METADATA_KEY];
    const status = chatState ? getEventStatus(evt, chatState) : '';
    const catIcon = { plot: 'fa-book', flavor: 'fa-dice', world: 'fa-globe', custom: 'fa-bolt' }[evt.category] || 'fa-bolt';

    return `
        <div class="dynevt-event-row ${evt.id === selectedEventId ? 'selected' : ''}" data-id="${evt.id}" draggable="true">
            <i class="fa-solid fa-grip-vertical dynevt-drag-handle" title="Drag to reorder"></i>
            <label class="dynevt-event-toggle" onclick="event.stopPropagation()">
                <input type="checkbox" ${evt.enabled ? 'checked' : ''} data-action="toggle-event" />
            </label>
            <i class="fa-solid ${catIcon} dynevt-event-icon" title="${evt.category}"></i>
            <span class="dynevt-event-name">${esc(evt.name)}</span>
            <span class="dynevt-event-type">${evt.schedule.type}</span>
            <span class="dynevt-event-status">${status}</span>
            <button class="dynevt-btn-icon" data-action="reset-event" title="Reset state" onclick="event.stopPropagation()">
                <i class="fa-solid fa-rotate-left"></i>
            </button>
            <button class="dynevt-btn-icon" data-action="delete-event" title="Delete" onclick="event.stopPropagation()">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
    `;
}

function wireEventRows(panel, set) {
    let dragSourceId = null;

    panel.querySelectorAll('.dynevt-event-row').forEach(row => {
        const id = row.dataset.id;

        row.addEventListener('click', (e) => {
            if (e.target.closest('input, button, [data-action]')) return;
            selectedEventId = selectedEventId === id ? null : id;
            renderRightPanel();
        });

        row.querySelector('[data-action="toggle-event"]')?.addEventListener('change', function () {
            const evt = set.events.find(e => e.id === id);
            if (evt) {
                evt.enabled = this.checked;
                saveSettings();
                clearAllInjections(getSettings());
                primeInjections();
            }
        });

        row.querySelector('[data-action="delete-event"]')?.addEventListener('click', async () => {
            const evt = set.events.find(e => e.id === id);
            if (!evt) return;
            const ok = await dynevtConfirm(`Delete event "${evt.name}"?`);
            if (!ok) return;
            set.events = set.events.filter(e => e.id !== id);
            if (selectedEventId === id) selectedEventId = null;
            saveSettings();
            renderRightPanel();
        });

        row.querySelector('[data-action="reset-event"]')?.addEventListener('click', () => {
            const evt = set.events.find(e => e.id === id);
            if (!evt) return;
            const chatState = getChatState();
            delete chatState.eventStates[evt.id];
            saveChatState();
            clearAllInjections(getSettings());
            primeInjections();
            updateDrawerStatus();
            toastr.info(`Reset: ${evt.name}`, 'Dynamic Events');
            renderRightPanel();
        });

        // ─── Drag-and-drop reorder ───
        row.addEventListener('dragstart', (e) => {
            dragSourceId = id;
            row.classList.add('dynevt-dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        row.addEventListener('dragend', () => {
            dragSourceId = null;
            row.classList.remove('dynevt-dragging');
            panel.querySelectorAll('.dynevt-event-row').forEach(r => r.classList.remove('dynevt-drag-over-top', 'dynevt-drag-over-bottom'));
        });

        row.addEventListener('dragover', (e) => {
            if (!dragSourceId || dragSourceId === id) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const rect = row.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            const above = e.clientY < midY;
            row.classList.toggle('dynevt-drag-over-top', above);
            row.classList.toggle('dynevt-drag-over-bottom', !above);
        });

        row.addEventListener('dragleave', () => {
            row.classList.remove('dynevt-drag-over-top', 'dynevt-drag-over-bottom');
        });

        row.addEventListener('drop', (e) => {
            e.preventDefault();
            if (!dragSourceId || dragSourceId === id) return;
            const fromIdx = set.events.findIndex(ev => ev.id === dragSourceId);
            let toIdx = set.events.findIndex(ev => ev.id === id);
            if (fromIdx < 0 || toIdx < 0) return;

            // Decide insert above or below based on cursor position
            const rect = row.getBoundingClientRect();
            if (e.clientY >= rect.top + rect.height / 2) toIdx++;
            // Adjust if moving downward (the source removal shifts indices)
            if (fromIdx < toIdx) toIdx--;

            const [moved] = set.events.splice(fromIdx, 1);
            set.events.splice(toIdx, 0, moved);
            saveSettings();
            renderRightPanel();
        });
    });
}

// ═══════════════════════════════════════════════════════════════
// EVENT EDITOR (inside right panel)
// ═══════════════════════════════════════════════════════════════

function renderEventEditor(set) {
    const el = document.getElementById('dynevt-event-editor');
    if (!el) return;
    const evt = set.events.find(e => e.id === selectedEventId);
    if (!evt) { el.innerHTML = ''; return; }

    const isChain = evt.schedule.type === ScheduleType.PLOT_CHAIN;
    const isMacro = evt.injection.mode === InjectionMode.MACRO;
    const capture = evt.capture || { enabled: false, varName: '' };
    if (!evt.capture) evt.capture = capture;

    el.innerHTML = `
        <div class="dynevt-editor">
            <div class="dynevt-editor-row">
                <div class="dynevt-field"><label>Name</label>
                    <input type="text" class="dynevt-input" data-f="name" value="${esc(evt.name)}" /></div>
                <div class="dynevt-field"><label>Category</label>
                    <select class="dynevt-select" data-f="category">
                        ${Object.values(EventCategory).map(c => `<option value="${c}" ${evt.category === c ? 'selected' : ''}>${c}</option>`).join('')}
                    </select></div>
                <div class="dynevt-field"><label>Priority (0–100)</label>
                    <input type="number" class="dynevt-input dynevt-input-sm" data-f="priority" value="${evt.priority}" min="0" max="100" /></div>
                <div class="dynevt-field"><label>Schedule</label>
                    <select class="dynevt-select" data-f="schedule.type">
                        ${Object.values(ScheduleType).map(t => `<option value="${t}" ${evt.schedule.type === t ? 'selected' : ''}>${t}</option>`).join('')}
                    </select></div>
            </div>

            <div class="dynevt-field ${isChain ? 'hidden' : ''}" id="dynevt-evt-text">
                <label>Event Text</label>
                <textarea class="dynevt-textarea" data-f="text" rows="3" placeholder="[Scene Direction: ...]">${esc(evt.text)}</textarea>
            </div>

            <div class="dynevt-section-label">Schedule Settings</div>
            <div class="dynevt-editor-row">
                <div class="dynevt-field"><label>Interval Min</label>
                    <input type="number" class="dynevt-input dynevt-input-sm" data-f="schedule.intervalMin" value="${evt.schedule.intervalMin}" min="1" /></div>
                <div class="dynevt-field"><label>Interval Max</label>
                    <input type="number" class="dynevt-input dynevt-input-sm" data-f="schedule.intervalMax" value="${evt.schedule.intervalMax}" min="1" /></div>
                <div class="dynevt-field"><label>Probability (%)</label>
                    <input type="number" class="dynevt-input dynevt-input-sm" data-f="schedule.probability" data-pct value="${Math.round(evt.schedule.probability * 100)}" min="0" max="100" step="5" /></div>
                <div class="dynevt-field"><label>Cooldown</label>
                    <input type="number" class="dynevt-input dynevt-input-sm" data-f="schedule.cooldown" value="${evt.schedule.cooldown}" min="0" /></div>
                <div class="dynevt-field"><label>Initial Delay</label>
                    <input type="number" class="dynevt-input dynevt-input-sm" data-f="schedule.initialDelay" value="${evt.schedule.initialDelay}" min="0" /></div>
            </div>

            <div class="dynevt-section-label">Injection</div>
            <div class="dynevt-editor-row">
                <div class="dynevt-field"><label>Mode</label>
                    <select class="dynevt-select" data-f="injection.mode">
                        <option value="${InjectionMode.EXTENSION_PROMPT}" ${!isMacro ? 'selected' : ''}>Extension Prompt</option>
                        <option value="${InjectionMode.MACRO}" ${isMacro ? 'selected' : ''}>Macro {{dynamicEvents}}</option>
                    </select></div>
                <div class="dynevt-field ${isMacro ? 'hidden' : ''}" data-show="ext-prompt"><label>Position</label>
                    <select class="dynevt-select" data-f="injection.position">
                        <option value="${PromptPosition.IN_PROMPT}" ${evt.injection.position === PromptPosition.IN_PROMPT ? 'selected' : ''}>In Prompt (after story)</option>
                        <option value="${PromptPosition.IN_CHAT}" ${evt.injection.position === PromptPosition.IN_CHAT ? 'selected' : ''}>In Chat (at depth)</option>
                        <option value="${PromptPosition.BEFORE_PROMPT}" ${evt.injection.position === PromptPosition.BEFORE_PROMPT ? 'selected' : ''}>Before Prompt</option>
                    </select></div>
                <div class="dynevt-field ${isMacro ? 'hidden' : ''}" data-show="ext-prompt"><label>Depth</label>
                    <input type="number" class="dynevt-input dynevt-input-sm" data-f="injection.depth" value="${evt.injection.depth}" min="0" max="999" /></div>
                <div class="dynevt-field ${isMacro ? 'hidden' : ''}" data-show="ext-prompt"><label>Role</label>
                    <select class="dynevt-select" data-f="injection.role">
                        <option value="${PromptRole.SYSTEM}" ${evt.injection.role === PromptRole.SYSTEM ? 'selected' : ''}>System</option>
                        <option value="${PromptRole.USER}" ${evt.injection.role === PromptRole.USER ? 'selected' : ''}>User</option>
                        <option value="${PromptRole.ASSISTANT}" ${evt.injection.role === PromptRole.ASSISTANT ? 'selected' : ''}>Assistant</option>
                    </select></div>
            </div>

            <div id="dynevt-phases-section" class="${isChain ? '' : 'hidden'}">
                <div class="dynevt-section-label">
                    Plot Phases
                    <button class="dynevt-btn dynevt-btn-sm" id="dynevt-add-phase"><i class="fa-solid fa-plus"></i> Phase</button>
                </div>
                <div id="dynevt-phases-list"></div>
            </div>

            <div class="dynevt-section-label"><i class="fa-solid fa-lock" style="font-size:0.85em"></i> Condition</div>
            <div id="dynevt-evt-condition">
                ${renderConditionHTML(evt.condition || createCondition(), 'evt', evt.id, false)}
            </div>

            <div class="dynevt-section-label"><i class="fa-solid fa-database" style="font-size:0.85em"></i> Response Capture</div>
            <div class="dynevt-editor-row">
                <div class="dynevt-field">
                    <label class="dynevt-header-toggle">
                        <input type="checkbox" id="dynevt-capture-enabled" ${capture.enabled ? 'checked' : ''} />
                        Capture data from response
                    </label>
                </div>
                <div class="dynevt-field ${!capture.enabled ? 'hidden' : ''}" id="dynevt-capture-var-field">
                    <label>Variable name</label>
                    <input type="text" class="dynevt-input" id="dynevt-capture-varname" value="${esc(capture.varName)}" placeholder="myVariable" />
                </div>
            </div>
            <div class="dynevt-hint ${!capture.enabled ? 'hidden' : ''}" id="dynevt-capture-hint">
                LLM should output: <code>&lt;!--DE:${esc(capture.varName || 'varName')}:value here--&gt;</code>
            </div>
        </div>
    `;

    wireEditorFields(el, evt, set);

    // Wire event-level condition
    if (!evt.condition) evt.condition = createCondition();
    const condContainer = el.querySelector('#dynevt-evt-condition .dynevt-condition');
    if (condContainer) wireConditionFields(condContainer, evt.condition, saveSettings, evt.id);

    // Wire capture fields
    el.querySelector('#dynevt-capture-enabled')?.addEventListener('change', function () {
        evt.capture.enabled = this.checked;
        el.querySelector('#dynevt-capture-var-field')?.classList.toggle('hidden', !this.checked);
        el.querySelector('#dynevt-capture-hint')?.classList.toggle('hidden', !this.checked);
        saveSettings();
    });
    el.querySelector('#dynevt-capture-varname')?.addEventListener('input', function () {
        evt.capture.varName = this.value.replace(/[^\w]/g, '');
        this.value = evt.capture.varName;
        // Update the hint with the current variable name
        const hint = el.querySelector('#dynevt-capture-hint');
        if (hint) hint.innerHTML = `LLM should output: <code>&lt;!--DE:${esc(evt.capture.varName || 'varName')}:value here--&gt;</code>`;
        saveSettings();
    });

    if (isChain) renderPhasesList(evt);
}

function wireEditorFields(el, evt, set) {
    el.querySelectorAll('[data-f]').forEach(input => {
        const handler = () => {
            const field = input.dataset.f;
            let value = input.type === 'number' ? parseFloat(input.value) : input.value;
            // Percentage fields: display 0-100, store 0-1
            if (input.type === 'number' && input.hasAttribute('data-pct')) {
                value = Math.min(100, Math.max(0, value)) / 100;
            }
            const parts = field.split('.');
            let target = evt;
            for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]];
            target[parts.at(-1)] = value;

            if (field === 'schedule.type') {
                const isChain = value === ScheduleType.PLOT_CHAIN;
                el.querySelector('#dynevt-evt-text')?.classList.toggle('hidden', isChain);
                el.querySelector('#dynevt-phases-section')?.classList.toggle('hidden', !isChain);
                if (isChain) {
                    // Auto-migrate event text to first phase
                    if (!evt.phases.length) evt.phases.push(createPhase({ name: 'Phase 1' }));
                    if (evt.text.trim() && !evt.phases[0].text.trim()) {
                        evt.phases[0].text = evt.text;
                        evt.text = '';
                    }
                }
                renderPhasesList(evt);
            }

            if (field === 'injection.mode') {
                const hide = value === InjectionMode.MACRO;
                el.querySelectorAll('[data-show="ext-prompt"]').forEach(f => f.classList.toggle('hidden', hide));
            }

            if (field === 'name') {
                // Update event row label in-place without re-rendering (avoids killing input focus)
                const row = document.querySelector(`.dynevt-event-row[data-id="${evt.id}"] .dynevt-event-name`);
                if (row) row.textContent = value;
                saveSettings();
            } else saveSettings();
        };

        input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', handler);
    });

    el.querySelector('#dynevt-add-phase')?.addEventListener('click', () => {
        evt.phases.push(createPhase({ name: `Phase ${evt.phases.length + 1}` }));
        saveSettings();
        renderPhasesList(evt);
    });
}

function renderPhasesList(evt) {
    const list = document.getElementById('dynevt-phases-list');
    if (!list) return;

    list.innerHTML = evt.phases.map((ph, i) => {
        const collapsed = collapsedPhases.has(ph.id);
        return `
        <div class="dynevt-phase ${collapsed ? 'collapsed' : ''}" data-idx="${i}" data-phase-id="${ph.id}">
            <div class="dynevt-phase-header">
                <button class="dynevt-btn-icon dynevt-phase-collapse" data-action="toggle-phase" title="${collapsed ? 'Expand' : 'Collapse'}">
                    <i class="fa-solid fa-chevron-${collapsed ? 'right' : 'down'}"></i>
                </button>
                <input type="text" class="dynevt-input dynevt-input-sm" data-pi="${i}" data-pf="name" value="${esc(ph.name)}" />
                <button class="dynevt-btn-icon" data-action="del-phase" data-idx="${i}" title="Remove"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="dynevt-phase-body" ${collapsed ? 'style="display:none"' : ''}>
                <textarea class="dynevt-textarea dynevt-textarea-sm" data-pi="${i}" data-pf="text" rows="2" placeholder="Phase text…">${esc(ph.text)}</textarea>
                <div class="dynevt-editor-row">
                    <div class="dynevt-field"><label>Duration Min</label>
                        <input type="number" class="dynevt-input dynevt-input-sm" data-pi="${i}" data-pf="durationMin" value="${ph.durationMin}" min="1" /></div>
                    <div class="dynevt-field"><label>Duration Max</label>
                        <input type="number" class="dynevt-input dynevt-input-sm" data-pi="${i}" data-pf="durationMax" value="${ph.durationMax}" min="1" /></div>
                    <div class="dynevt-field"><label>Probability (%)</label>
                        <input type="number" class="dynevt-input dynevt-input-sm" data-pi="${i}" data-pf="probability" data-pct value="${Math.round(ph.probability * 100)}" min="0" max="100" step="5" /></div>
                </div>
                <div class="dynevt-phase-condition" data-phase-idx="${i}">
                    ${renderConditionHTML(ph.condition || createCondition(), 'phase-' + i, evt.id, true)}
                </div>
            </div>
        </div>
    `;
    }).join('');

    list.querySelectorAll('[data-pf]').forEach(input => {
        input.addEventListener(input.tagName === 'TEXTAREA' ? 'input' : 'change', function () {
            const i = parseInt(this.dataset.pi);
            const field = this.dataset.pf;
            let val = this.type === 'number' ? parseFloat(this.value) : this.value;
            // Percentage fields: display 0-100, store 0-1
            if (this.type === 'number' && this.hasAttribute('data-pct')) {
                val = Math.min(100, Math.max(0, val)) / 100;
            }
            evt.phases[i][field] = val;
            saveSettings();
        });
    });

    list.querySelectorAll('[data-action="del-phase"]').forEach(btn => {
        btn.addEventListener('click', () => {
            evt.phases.splice(parseInt(btn.dataset.idx), 1);
            saveSettings();
            renderPhasesList(evt);
        });
    });

    list.querySelectorAll('[data-action="toggle-phase"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const phaseEl = btn.closest('.dynevt-phase');
            const phaseId = phaseEl?.dataset.phaseId;
            if (!phaseId) return;
            if (collapsedPhases.has(phaseId)) collapsedPhases.delete(phaseId);
            else collapsedPhases.add(phaseId);
            renderPhasesList(evt);
        });
    });

    // Wire phase-level conditions
    list.querySelectorAll('.dynevt-phase-condition').forEach(condWrapper => {
        const idx = parseInt(condWrapper.dataset.phaseIdx);
        const phase = evt.phases[idx];
        if (!phase) return;
        if (!phase.condition) phase.condition = createCondition();
        const condEl = condWrapper.querySelector('.dynevt-condition');
        if (condEl) wireConditionFields(condEl, phase.condition, saveSettings, evt.id);
    });
}

// ═══════════════════════════════════════════════════════════════
// IMPORT / EXPORT
// ═══════════════════════════════════════════════════════════════

function exportAllSets() {
    const settings = getSettings();
    if (settings.eventSets.length === 0) {
        toastr.info('No event sets to export.');
        return;
    }
    // If only 1 set, skip the picker
    if (settings.eventSets.length === 1) {
        doExport(settings.eventSets);
        return;
    }
    showExportPicker();
}

function showExportPicker() {
    // Remove any existing
    document.getElementById('dynevt-export-overlay')?.remove();

    const settings = getSettings();
    const charName = getCurrentCharacterName();
    const orderedSets = getGroupedSets(settings.eventSets);

    const overlay = document.createElement('div');
    overlay.id = 'dynevt-export-overlay';
    overlay.className = 'dynevt-confirm-overlay';
    overlay.innerHTML = `
        <div class="dynevt-confirm-box dynevt-export-box">
            <div class="dynevt-confirm-msg">Select sets to export together</div>
            <div class="dynevt-export-list">
                ${orderedSets.map(set => {
                    const isSecondary = set.role === SetRole.SECONDARY && set.parentSetId;
                    const bindLabel = set.bindMode === BindMode.CHARACTER
                        ? (set.characterBindings.length ? ` (${set.characterBindings.join(', ')})` : ' (unbound)')
                        : ' (manual)';
                    return `<label class="dynevt-export-row ${isSecondary ? 'dynevt-export-row-secondary' : ''}" data-parent="${set.parentSetId || ''}">
                        <input type="checkbox" value="${set.id}" checked />
                        <span class="dynevt-export-set-name">${isSecondary ? '↳ ' : ''}${esc(set.name)}</span>
                        <span class="dynevt-export-set-meta">${set.events.length} event${set.events.length !== 1 ? 's' : ''}${bindLabel}</span>
                    </label>`;
                }).join('')}
            </div>
            <div class="dynevt-export-actions">
                <button class="dynevt-btn dynevt-btn-sm" id="dynevt-export-toggle-all">Toggle All</button>
            </div>
            <div class="dynevt-confirm-buttons">
                <button class="dynevt-btn" id="dynevt-export-cancel">Cancel</button>
                <button class="dynevt-btn dynevt-btn-accent" id="dynevt-export-go"><i class="fa-solid fa-file-export"></i> Export Selected</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('dynevt-visible'));

    const close = () => {
        overlay.classList.remove('dynevt-visible');
        setTimeout(() => overlay.remove(), 200);
    };

    overlay.querySelector('#dynevt-export-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('#dynevt-export-toggle-all').addEventListener('click', () => {
        const boxes = overlay.querySelectorAll('.dynevt-export-list input[type="checkbox"]');
        const allChecked = [...boxes].every(b => b.checked);
        boxes.forEach(b => b.checked = !allChecked);
    });

    overlay.querySelector('#dynevt-export-go').addEventListener('click', () => {
        const checked = [...overlay.querySelectorAll('.dynevt-export-list input[type="checkbox"]:checked')].map(b => b.value);
        if (checked.length === 0) { toastr.warning('Select at least one set.'); return; }
        const sets = settings.eventSets.filter(s => checked.includes(s.id));
        doExport(sets);
        close();
    });
}

function doExport(sets) {
    const payload = { version: 1, exportedAt: new Date().toISOString(), eventSets: sets };
    const name = sets.length === 1 ? sets[0].name.replace(/[^a-z0-9_-]/gi, '-').toLowerCase() : 'dynamic-events';
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}-export.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toastr.success(`Exported ${sets.length} set(s).`);
}

function importSets(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (ev) {
        try {
            const data = JSON.parse(ev.target.result);
            if (!Array.isArray(data.eventSets)) { toastr.error('Invalid file: missing eventSets.'); return; }
            const settings = getSettings();

            // Build old→new ID map so condition references survive import
            const idMap = new Map();
            for (const set of data.eventSets) {
                const oldSetId = set.id;
                set.id = generateId('set');
                idMap.set(oldSetId, set.id);
                for (const evt of set.events) {
                    const oldEvtId = evt.id;
                    evt.id = generateId('evt');
                    idMap.set(oldEvtId, evt.id);
                    evt.phases?.forEach(ph => {
                        const oldPhId = ph.id;
                        ph.id = generateId('ph');
                        idMap.set(oldPhId, ph.id);
                    });
                }
            }

            // Remap condition targetEventId and parentSetId references using the old→new map
            for (const set of data.eventSets) {
                // Remap parent set linkage
                if (set.parentSetId) {
                    const newParent = idMap.get(set.parentSetId);
                    set.parentSetId = newParent || null;
                    // If parent wasn't in this import, revert to primary
                    if (!newParent) set.role = SetRole.PRIMARY;
                }
                for (const evt of set.events) {
                    remapConditionTarget(evt.condition, idMap);
                    evt.phases?.forEach(ph => remapConditionTarget(ph.condition, idMap));
                }
                settings.eventSets.push(set);
            }

            saveSettings();
            renderSetList();
            renderRightPanel();
            toastr.success(`Imported ${data.eventSets.length} set(s).`);
        } catch (err) { toastr.error('Import failed: ' + err.message); }
    };
    reader.readAsText(file);
    $(e.target).val('');
}

/** Remap a condition's targetEventId using an old→new ID map */
function remapConditionTarget(condition, idMap) {
    if (!condition || !condition.targetEventId) return;
    const newId = idMap.get(condition.targetEventId);
    if (newId) condition.targetEventId = newId;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

function debug(...args) {
    if (getSettings().debugLog) console.log(LOG_PREFIX, ...args);
}

// ═══════════════════════════════════════════════════════════════
// CHARACTER PICKER (autocomplete + pill tags for character binding)
// ═══════════════════════════════════════════════════════════════

/** Get sorted list of all ST characters with name + avatar for the picker */
function getCharacterList() {
    const seen = new Set();
    const list = [];
    for (const char of characters) {
        if (!char?.name) continue;
        const key = `${char.name}|||${char.avatar || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({ name: char.name, avatar: char.avatar || '' });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
}

/** Render the character picker HTML (pills + search input + dropdown) */
function renderCharPicker(set) {
    const pills = set.characterBindings.map(name =>
        `<span class="dynevt-char-pill" data-name="${esc(name)}">${esc(name)}<span class="dynevt-char-pill-x">&times;</span></span>`
    ).join('');

    return `
        <div class="dynevt-char-picker" id="dynevt-char-picker">
            <div class="dynevt-char-pills">
                ${pills}
                <input type="text" class="dynevt-char-search" id="dynevt-char-search"
                       placeholder="${set.characterBindings.length ? '' : 'Type to search characters...'}" autocomplete="off" />
            </div>
            <div class="dynevt-char-dropdown" id="dynevt-char-dropdown"></div>
        </div>
    `;
}

/** Wire up the character picker: autocomplete, pill add/remove, keyboard */
function wireCharPicker(panel, set) {
    const picker = panel.querySelector('#dynevt-char-picker');
    if (!picker) return;

    const searchInput = picker.querySelector('#dynevt-char-search');
    const dropdown = picker.querySelector('#dynevt-char-dropdown');
    if (!searchInput || !dropdown) return;

    const allChars = getCharacterList();

    const showDropdown = (filter = '') => {
        const filterLower = filter.toLowerCase();
        const available = allChars.filter(c => {
            if (set.characterBindings.some(b => b.toLowerCase() === c.name.toLowerCase())) return false;
            if (!filter) return true;
            const avatarLabel = c.avatar.replace(/\.[^.]+$/, '');
            return c.name.toLowerCase().includes(filterLower) ||
                   avatarLabel.toLowerCase().includes(filterLower);
        });

        if (!filter && available.length > 20) {
            dropdown.innerHTML = '';
            dropdown.classList.remove('visible');
            return;
        }

        if (available.length === 0) {
            dropdown.innerHTML = filter
                ? '<div class="dynevt-char-no-match">No matching characters</div>'
                : '';
            dropdown.classList.toggle('visible', !!filter);
            return;
        }

        dropdown.innerHTML = available.slice(0, 15).map(c => {
            const avatarLabel = c.avatar ? c.avatar.replace(/\.[^.]+$/, '') : '';
            return `<div class="dynevt-char-option" data-name="${esc(c.name)}">
                ${esc(c.name)}${avatarLabel ? ` <span class="dynevt-char-avatar">(${esc(avatarLabel)})</span>` : ''}
            </div>`;
        }).join('');
        dropdown.classList.add('visible');

        dropdown.querySelectorAll('.dynevt-char-option').forEach(opt => {
            opt.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const name = opt.dataset.name;
                if (!set.characterBindings.includes(name)) {
                    set.characterBindings.push(name);
                    saveSettings();
                    renderSetList();
                }
                searchInput.value = '';
                refreshPills();
                showDropdown('');
                searchInput.focus();
            });
        });
    };

    const refreshPills = () => {
        const pillsContainer = picker.querySelector('.dynevt-char-pills');
        pillsContainer.querySelectorAll('.dynevt-char-pill').forEach(p => p.remove());
        set.characterBindings.forEach(name => {
            const pill = document.createElement('span');
            pill.className = 'dynevt-char-pill';
            pill.dataset.name = name;
            pill.innerHTML = `${esc(name)}<span class="dynevt-char-pill-x">&times;</span>`;
            pill.querySelector('.dynevt-char-pill-x').addEventListener('click', () => {
                set.characterBindings = set.characterBindings.filter(b => b !== name);
                saveSettings();
                renderSetList();
                refreshPills();
            });
            pillsContainer.insertBefore(pill, searchInput);
        });
        searchInput.placeholder = set.characterBindings.length ? '' : 'Type to search characters...';
    };

    searchInput.addEventListener('input', () => showDropdown(searchInput.value));
    searchInput.addEventListener('focus', () => showDropdown(searchInput.value));
    searchInput.addEventListener('blur', () => {
        setTimeout(() => dropdown.classList.remove('visible'), 150);
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !searchInput.value && set.characterBindings.length) {
            set.characterBindings.pop();
            saveSettings();
            renderSetList();
            refreshPills();
        }
    });

    // Wire initial pill X buttons
    picker.querySelectorAll('.dynevt-char-pill-x').forEach(x => {
        x.addEventListener('click', () => {
            const name = x.closest('.dynevt-char-pill').dataset.name;
            set.characterBindings = set.characterBindings.filter(b => b !== name);
            saveSettings();
            renderSetList();
            refreshPills();
        });
    });
}

/** Build a flat list of all events across all sets for condition target pickers */
function getAllEventOptions(excludeId = '') {
    const settings = getSettings();
    const opts = [];
    for (const set of settings.eventSets) {
        for (const evt of set.events) {
            if (evt.id === excludeId) continue;
            opts.push({ id: evt.id, label: `${set.name} \u2192 ${evt.name}`, phases: evt.phases });
        }
    }
    return opts;
}

/** Render a condition editor block (used for both events and phases) */
function renderConditionHTML(condition, prefix, excludeEventId = '', showBehavior = false) {
    if (!condition) condition = createCondition();
    const allEvents = getAllEventOptions(excludeEventId);
    const isNone = condition.type === ConditionType.NONE;
    const needsTarget = !isNone;
    const needsPhase = condition.type === ConditionType.PHASE_REACHED;
    const needsCount = condition.type === ConditionType.FIRE_COUNT;

    // For phase-reached, only show events that have phases
    const targetEvents = needsPhase ? allEvents.filter(e => e.phases?.length > 0) : allEvents;
    // Build phase options for the selected target
    const targetEvt = allEvents.find(e => e.id === condition.targetEventId);
    const phaseOptions = targetEvt?.phases?.length
        ? targetEvt.phases.map((ph, i) => `<option value="${i}" ${condition.targetPhase === i ? 'selected' : ''}>${esc(ph.name || 'Phase ' + (i + 1))}</option>`).join('')
        : '<option value="0">--</option>';

    return `
        <div class="dynevt-condition" data-prefix="${prefix}">
            <div class="dynevt-condition-row">
                <div class="dynevt-field">
                    <label>Requires</label>
                    <select class="dynevt-select" data-cond="type">
                        <option value="${ConditionType.NONE}" ${condition.type === ConditionType.NONE ? 'selected' : ''}>None (always eligible)</option>
                        <option value="${ConditionType.PHASE_REACHED}" ${condition.type === ConditionType.PHASE_REACHED ? 'selected' : ''}>Phase reached</option>
                        <option value="${ConditionType.HAS_FIRED}" ${condition.type === ConditionType.HAS_FIRED ? 'selected' : ''}>Has fired</option>
                        <option value="${ConditionType.FIRE_COUNT}" ${condition.type === ConditionType.FIRE_COUNT ? 'selected' : ''}>Fire count ≥</option>
                        <option value="${ConditionType.IS_SPENT}" ${condition.type === ConditionType.IS_SPENT ? 'selected' : ''}>Is spent (one-shot)</option>
                        <option value="${ConditionType.NOT_SPENT}" ${condition.type === ConditionType.NOT_SPENT ? 'selected' : ''}>Not spent</option>
                    </select>
                </div>
                <div class="dynevt-field ${needsTarget ? '' : 'hidden'}" data-cond-show="target">
                    <label>Target Event</label>
                    <select class="dynevt-select" data-cond="targetEventId">
                        <option value="">-- select --</option>
                        ${targetEvents.map(e => `<option value="${e.id}" ${condition.targetEventId === e.id ? 'selected' : ''}>${esc(e.label)}</option>`).join('')}
                    </select>
                </div>
                <div class="dynevt-field ${needsPhase ? '' : 'hidden'}" data-cond-show="phase">
                    <label>Phase ≥</label>
                    <select class="dynevt-select" data-cond="targetPhase">
                        ${phaseOptions}
                    </select>
                </div>
                <div class="dynevt-field ${needsCount ? '' : 'hidden'}" data-cond-show="count">
                    <label>Count ≥</label>
                    <input type="number" class="dynevt-input dynevt-input-sm" data-cond="targetCount" value="${condition.targetCount}" min="1" />
                </div>
                <label class="dynevt-condition-invert ${needsTarget ? '' : 'hidden'}" data-cond-show="invert">
                    <input type="checkbox" data-cond="invert" ${condition.invert ? 'checked' : ''} />
                    <span>Invert</span>
                </label>
                ${showBehavior ? `
                <div class="dynevt-field ${needsTarget ? '' : 'hidden'}" data-cond-show="behavior">
                    <label>If unmet</label>
                    <select class="dynevt-select" data-cond="behavior">
                        <option value="${ConditionBehavior.STALL}" ${condition.behavior === ConditionBehavior.STALL ? 'selected' : ''}>Stall</option>
                        <option value="${ConditionBehavior.SKIP}" ${condition.behavior === ConditionBehavior.SKIP ? 'selected' : ''}>Skip phase</option>
                    </select>
                </div>` : ''}
            </div>
        </div>
    `;
}

/** Wire condition fields inside a container */
function wireConditionFields(container, conditionObj, onSave, excludeEventId = '') {
    // Helper to rebuild the target dropdown based on condition type
    const rebuildTargetDropdown = () => {
        const targetSelect = container.querySelector('[data-cond="targetEventId"]');
        if (!targetSelect) return;
        const allEvents = getAllEventOptions(excludeEventId);
        const filtered = conditionObj.type === ConditionType.PHASE_REACHED
            ? allEvents.filter(e => e.phases?.length > 0)
            : allEvents;
        const currentVal = conditionObj.targetEventId;
        targetSelect.innerHTML = '<option value="">-- select --</option>' +
            filtered.map(e => `<option value="${e.id}" ${currentVal === e.id ? 'selected' : ''}>${esc(e.label)}</option>`).join('');
        // If current target not in filtered list, clear it
        if (currentVal && !filtered.find(e => e.id === currentVal)) {
            conditionObj.targetEventId = '';
            targetSelect.value = '';
        }
    };

    // Helper to rebuild the phase dropdown based on selected target
    const rebuildPhaseDropdown = () => {
        const phaseSelect = container.querySelector('[data-cond="targetPhase"]');
        if (!phaseSelect) return;
        const allEvents = getAllEventOptions(excludeEventId);
        const targetEvt = allEvents.find(e => e.id === conditionObj.targetEventId);
        if (targetEvt?.phases?.length) {
            phaseSelect.innerHTML = targetEvt.phases.map((ph, i) =>
                `<option value="${i}" ${conditionObj.targetPhase === i ? 'selected' : ''}>${esc(ph.name || 'Phase ' + (i + 1))}</option>`
            ).join('');
        } else {
            phaseSelect.innerHTML = '<option value="0">--</option>';
        }
    };

    container.querySelectorAll('[data-cond]').forEach(input => {
        const handler = () => {
            const field = input.dataset.cond;
            if (field === 'type') {
                conditionObj.type = input.value;
                // Show/hide dependent fields
                const isNone = input.value === ConditionType.NONE;
                const needsPhase = input.value === ConditionType.PHASE_REACHED;
                const needsCount = input.value === ConditionType.FIRE_COUNT;
                container.querySelectorAll('[data-cond-show="target"], [data-cond-show="invert"], [data-cond-show="behavior"]')
                    .forEach(el => el.classList.toggle('hidden', isNone));
                container.querySelector('[data-cond-show="phase"]')?.classList.toggle('hidden', !needsPhase);
                container.querySelector('[data-cond-show="count"]')?.classList.toggle('hidden', !needsCount);
                // Rebuild target dropdown (filtered for phase-reached)
                rebuildTargetDropdown();
                if (needsPhase) rebuildPhaseDropdown();
            } else if (field === 'invert') {
                conditionObj.invert = input.checked;
            } else if (field === 'targetPhase' || field === 'targetCount') {
                conditionObj[field] = parseInt(input.value) || 0;
            } else if (field === 'targetEventId') {
                conditionObj.targetEventId = input.value;
                // Rebuild phase dropdown when target changes
                if (conditionObj.type === ConditionType.PHASE_REACHED) {
                    conditionObj.targetPhase = 0;
                    rebuildPhaseDropdown();
                }
            } else {
                conditionObj[field] = input.value;
            }
            onSave();
        };
        input.addEventListener(input.tagName === 'SELECT' ? 'change' : input.type === 'checkbox' ? 'change' : 'input', handler);
    });
}

// ═══════════════════════════════════════════════════════════════
// CUSTOM CONFIRM DIALOG (replaces browser confirm())
// ═══════════════════════════════════════════════════════════════

function dynevtConfirm(message, { confirmText = 'Delete', cancelText = 'Cancel', danger = true } = {}) {
    return new Promise(resolve => {
        // Remove any existing confirm dialog
        document.getElementById('dynevt-confirm-overlay')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'dynevt-confirm-overlay';
        overlay.className = 'dynevt-confirm-overlay';
        overlay.innerHTML = `
            <div class="dynevt-confirm-box">
                <div class="dynevt-confirm-msg">${esc(message)}</div>
                <div class="dynevt-confirm-buttons">
                    <button class="dynevt-btn" id="dynevt-confirm-cancel">${esc(cancelText)}</button>
                    <button class="dynevt-btn ${danger ? 'dynevt-btn-danger' : 'dynevt-btn-accent'}" id="dynevt-confirm-ok">${esc(confirmText)}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        // Animate in
        requestAnimationFrame(() => overlay.classList.add('dynevt-visible'));

        const cleanup = (result) => {
            overlay.classList.remove('dynevt-visible');
            setTimeout(() => overlay.remove(), 200);
            resolve(result);
        };

        overlay.querySelector('#dynevt-confirm-ok').addEventListener('click', () => cleanup(true));
        overlay.querySelector('#dynevt-confirm-cancel').addEventListener('click', () => cleanup(false));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
    });
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

jQuery(async () => {
    getSettings();
    migrateSettings();
    await loadDrawerUI();
    addWandMenuItem();
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(event_types.CHAT_CHANGED, () => {
        lastChatLength = getContext().chat?.length || 0;
        // NOTE: we intentionally do NOT capture or scrub on chat load. There's no
        // new AI message here, and the old full-history scrub forced a saveChat()
        // on every switch. Leftover tags can be cleaned on demand via /dynevt-scrub.
        // Prime injections on chat load so they're ready for the first generation
        // (including swipes). Uses a cloned chatState so messageCount and event
        // states aren't advanced — this is a "read-only" evaluation.
        primeInjections();
        updateDrawerStatus();
    });
    registerMacro();
    registerSlashCommands();

    // If the user has macro-mode events but the macro API wasn't available,
    // those events would silently produce nothing — surface it once.
    if (!_macroRegistered && anyMacroEventsConfigured()) {
        console.warn(LOG_PREFIX, 'Macro {{dynamicEvents}} could not register, but macro-mode events exist — they will not inject.');
        toastr.warning('Dynamic Events: {{dynamicEvents}} macro unavailable in this ST version. Macro-mode events won\'t inject — switch them to Extension Prompt mode.', '', { timeOut: 12000 });
    }

    debug('Extension loaded');
});
