import { saveSettingsDebounced } from '../../../../../../script.js';
import { extension_settings } from '../../../../../extensions.js';
import {
    ConditionType,
    InjectionMode,
    PromptPosition,
    PromptRole,
    SetRole,
} from '../../eventEngine.js';
import { normalizeDynamicActions } from '../actions/actionTypes.js';
import { ProviderOperator } from '../conditions/providers.js';
import { migratePresetXmlTags } from '../presets/migrations.js';
import { createSubject } from '../subjects/subjects.js';
import { createTrackSubject, TrackTransitionMode } from '../tracks/stateTracks.js';
import {
    PromptRouterMode,
    sanitizePromptOutletName,
} from '../routers/promptRouters.js';
import { getCharacterList, upgradeBindingToAvatar } from '../runtime/bindingContext.js';

export const SETTINGS_KEY = 'dynamicEvents';
const LOG_PREFIX = '[DynEvents]';
const DEFAULT_SETTINGS = {
    enabled: true,
    maxConcurrentEvents: 2,
    eventSets: [],
    debugLog: false,
};
const PRESET_TRACK_NAME_MIGRATIONS = Object.freeze({
    'staged-relationship-arc': Object.freeze({
        'Romantic Awakening — State Track': 'Romantic Awakening',
    }),
    'layered-social-bond': Object.freeze({
        'Relational Safety — State Track': 'Relational Safety',
        'Everyday Closeness — State Track': 'Everyday Closeness',
    }),
});

export function getSettings() {
    if (!extension_settings[SETTINGS_KEY]) {
        extension_settings[SETTINGS_KEY] = structuredClone(DEFAULT_SETTINGS);
    }
    return extension_settings[SETTINGS_KEY];
}

function normalizeConditionShape(condition) {
    if (!condition) return false;
    if (condition.type === ConditionType.GROUP) {
        if (!Array.isArray(condition.conditions)) {
            condition.conditions = [];
            return true;
        }
        return condition.conditions.reduce((changed, child) => normalizeConditionShape(child) || changed, false);
    }
    if (condition.type !== ConditionType.PROVIDER_STATE) return false;
    let changed = false;
    const defaults = {
        providerId: 'superagents',
        source: '',
        path: '',
        operator: ProviderOperator.EXISTS,
        value: '',
        subject: null,
    };
    for (const [key, value] of Object.entries(defaults)) {
        if (condition[key] === undefined) {
            condition[key] = value;
            changed = true;
        }
    }
    return changed;
}

let migrated = false;

export function migrateSettings() {
    if (migrated) return;
    migrated = true;
    const settings = getSettings();
    const allChars = getCharacterList();
    let changed = false;
    settings.eventSets?.forEach(set => {
        if (!set.role) { set.role = SetRole.PRIMARY; changed = true; }
        if (set.parentSetId === undefined) { set.parentSetId = null; changed = true; }
        if (!Array.isArray(set.tagBindings)) { set.tagBindings = []; changed = true; }
        if (!Array.isArray(set.scripts)) { set.scripts = []; changed = true; }
        if (!Array.isArray(set.stateTracks)) { set.stateTracks = []; changed = true; }
        if (!Array.isArray(set.promptRouters)) { set.promptRouters = []; changed = true; }
        for (const event of (set.events || [])) {
            if (migratePresetXmlTags(event)) changed = true;
            if (!event.subject) { event.subject = createSubject(); changed = true; }
            const hadActions = Array.isArray(event.actions);
            const normalizedActions = normalizeDynamicActions(event.actions);
            if (!hadActions || JSON.stringify(normalizedActions) !== JSON.stringify(event.actions)) {
                event.actions = normalizedActions;
                changed = true;
            }
            if (normalizeConditionShape(event.condition)) changed = true;
            for (const phase of (event.phases || [])) {
                if (normalizeConditionShape(phase.condition)) changed = true;
            }
        }
        for (const script of set.scripts) {
            if (normalizeConditionShape(script.condition)) changed = true;
        }
        for (const track of set.stateTracks) {
            if (migratePresetXmlTags(track)) changed = true;
            const renamed = PRESET_TRACK_NAME_MIGRATIONS[track.sourcePresetId]?.[track.name];
            if (renamed) { track.name = renamed; changed = true; }
            if (!track.subject) { track.subject = createTrackSubject(); changed = true; }
            if (!track.transitionMode) { track.transitionMode = TrackTransitionMode.REVERSIBLE; changed = true; }
            const defaultInjection = {
                mode: InjectionMode.EXTENSION_PROMPT,
                position: PromptPosition.IN_CHAT,
                depth: 1,
                role: PromptRole.SYSTEM,
            };
            if (!track.injection) {
                track.injection = defaultInjection;
                changed = true;
            } else {
                for (const [field, value] of Object.entries(defaultInjection)) {
                    if (track.injection[field] !== undefined) continue;
                    track.injection[field] = value;
                    changed = true;
                }
            }
            if (!Array.isArray(track.states)) { track.states = []; changed = true; }
            for (const state of track.states) {
                const hadActions = Array.isArray(state.onEnterActions);
                const normalizedActions = normalizeDynamicActions(state.onEnterActions);
                if (!hadActions || JSON.stringify(normalizedActions) !== JSON.stringify(state.onEnterActions)) {
                    state.onEnterActions = normalizedActions;
                    changed = true;
                }
                if (normalizeConditionShape(state.condition)) changed = true;
                if (normalizeConditionShape(state.exitCondition)) changed = true;
            }
        }
        for (const router of set.promptRouters) {
            if (migratePresetXmlTags(router)) changed = true;
            if (!router.subject) { router.subject = createSubject(); changed = true; }
            if (!Object.values(PromptRouterMode).includes(router.mode)) {
                router.mode = PromptRouterMode.STACK;
                changed = true;
            }
            const defaultInjection = {
                mode: InjectionMode.EXTENSION_PROMPT,
                position: PromptPosition.IN_CHAT,
                depth: 1,
                role: PromptRole.SYSTEM,
                macroName: '',
            };
            if (!router.injection) {
                router.injection = defaultInjection;
                changed = true;
            } else {
                for (const [field, value] of Object.entries(defaultInjection)) {
                    if (router.injection[field] !== undefined) continue;
                    router.injection[field] = value;
                    changed = true;
                }
            }
            const safeMacroName = sanitizePromptOutletName(router.injection.macroName);
            if (safeMacroName !== router.injection.macroName) {
                router.injection.macroName = safeMacroName;
                changed = true;
            }
            if (!Array.isArray(router.layers)) { router.layers = []; changed = true; }
            for (const layer of router.layers) {
                if (normalizeConditionShape(layer.condition)) changed = true;
            }
        }
        if (Array.isArray(set.characterBindings) && set.characterBindings.length && allChars.length) {
            const upgraded = set.characterBindings.map(binding => upgradeBindingToAvatar(binding, allChars));
            if (upgraded.some((value, index) => value !== set.characterBindings[index])) {
                set.characterBindings = upgraded;
                changed = true;
            }
        }
    });
    if (changed) saveSettingsDebounced();
}

export function saveSettings() {
    try {
        JSON.stringify(extension_settings[SETTINGS_KEY]);
        saveSettingsDebounced();
    } catch (error) {
        console.error(LOG_PREFIX, 'Settings serialization failed — save skipped:', error);
        toastr.error('Dynamic Events: settings save failed. Check console.');
    }
}

export function debug(...args) {
    if (getSettings().debugLog) console.log(LOG_PREFIX, ...args);
}
