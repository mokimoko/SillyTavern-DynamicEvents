import {
    extension_prompt_types,
    setExtensionPrompt,
    substituteParams,
} from '../../../../../../script.js';
import { macros, MacroCategory } from '../../../../../../scripts/macros/macro-system.js';
import { getContext } from '../../../../../extensions.js';
import { InjectionMode, isSetActive } from '../../eventEngine.js';
import { debug, getSettings } from '../config/settings.js';
import { evaluateStateTracks } from '../tracks/stateTracks.js';
import {
    evaluatePromptRouters,
    promptOutletMacroName,
} from '../routers/promptRouters.js';
import { activeSwipeId } from './branchState.js';
import { getBindingContext } from './bindingContext.js';
import { getChatState } from './chatState.js';

const LOG_PREFIX = '[DynEvents]';
const PROMPT_KEY_PREFIX = 'dynevt_';
let macroBuffer = '';
let macroRegistered = false;
const namedMacroBuffers = new Map();
const registeredNamedMacros = new Set();
const registeredRegistryMacros = new Set();
const registeredLegacyMacros = new Set();

function appendMacroText(current, text) {
    return current ? `${current}\n${text}` : text;
}

/** Register against ST's current registry, with the older window API as fallback. */
function registerHostMacro(name, handler, description) {
    const registry = macros?.registry;
    if (registry?.registerMacro) {
        try {
            if (registeredRegistryMacros.has(name)) registry.unregisterMacro?.(name);
            const definition = registry.registerMacro(name, {
                category: MacroCategory.MISC,
                description,
                handler,
            });
            if (definition) {
                registeredRegistryMacros.add(name);
                return true;
            }
        } catch (error) {
            console.warn(LOG_PREFIX, `Current macro registry rejected {{${name}}}:`, error);
        }
    }

    const legacyMacros = window?.SillyTavern?.macros;
    if (!legacyMacros?.register) return false;
    if (registeredLegacyMacros.has(name)) return true;
    try {
        legacyMacros.register({
            name,
            description,
            returns: 'Active routed prompt text or empty string.',
            handler,
        });
        registeredLegacyMacros.add(name);
        return true;
    } catch (error) {
        console.warn(LOG_PREFIX, `Legacy macro API rejected {{${name}}}:`, error);
        return false;
    }
}

function registerConfiguredPromptOutlets(settings = getSettings()) {
    const names = new Set((settings.eventSets || []).flatMap(set =>
        (set.promptRouters || [])
            .filter(router => router.injection?.mode === InjectionMode.MACRO)
            .map(router => promptOutletMacroName(router.injection?.macroName))
            .filter(Boolean)));
    for (const name of names) {
        if (registeredNamedMacros.has(name)) continue;
        const registered = registerHostMacro(
            name,
            () => namedMacroBuffers.get(name) || '',
            'Inserts the active text from a named Dynamic Events Prompt Router outlet.',
        );
        if (registered) {
            registeredNamedMacros.add(name);
            debug(`Registered {{${name}}} Prompt Router outlet`);
        }
    }
}

export function clearAllInjections(settings = getSettings()) {
    for (const set of settings.eventSets) {
        for (const event of set.events) {
            const position = event.injection?.position ?? extension_prompt_types.IN_CHAT;
            const depth = event.injection?.depth ?? 0;
            setExtensionPrompt(`${PROMPT_KEY_PREFIX}${event.id}`, '', position, depth);
        }
        for (const track of (set.stateTracks || [])) {
            const position = track.injection?.position ?? extension_prompt_types.IN_CHAT;
            const depth = track.injection?.depth ?? 0;
            setExtensionPrompt(`${PROMPT_KEY_PREFIX}${track.id}`, '', position, depth);
        }
        for (const router of (set.promptRouters || [])) {
            const position = router.injection?.position ?? extension_prompt_types.IN_CHAT;
            const depth = router.injection?.depth ?? 0;
            setExtensionPrompt(`${PROMPT_KEY_PREFIX}${router.id}`, '', position, depth);
        }
    }
    macroBuffer = '';
    namedMacroBuffers.clear();
}

export function applyInjectionTexts(...textMaps) {
    for (const texts of textMaps) {
        for (const [sourceId, { text, injection }] of texts || []) {
            const expandedText = substituteParams(String(text || ''));
            if (injection.mode === InjectionMode.EXTENSION_PROMPT) {
                setExtensionPrompt(`${PROMPT_KEY_PREFIX}${sourceId}`, expandedText, injection.position, injection.depth, false, injection.role);
                debug(`Injected: ${sourceId}`);
            } else if (injection.mode === InjectionMode.MACRO) {
                const outletName = promptOutletMacroName(injection.macroName);
                if (outletName) {
                    namedMacroBuffers.set(outletName, appendMacroText(namedMacroBuffers.get(outletName) || '', expandedText));
                    debug(`Macro queued: ${sourceId} -> {{${outletName}}}`);
                } else {
                    macroBuffer = appendMacroText(macroBuffer, expandedText);
                    debug(`Macro queued: ${sourceId} -> {{dynamicEvents}}`);
                }
            }
        }
    }
}

export function injectEventText(eventId, text, injection) {
    applyInjectionTexts(new Map([[eventId, { text, injection }]]));
}

/** Restore exact pending Event prompts and deterministic State Track context. */
export function primeInjections(evaluationOptions = {}) {
    const settings = getSettings();
    registerConfiguredPromptOutlets(settings);
    if (!settings.enabled) {
        clearAllInjections(settings);
        return;
    }
    try {
        const realState = getChatState();
        const clonedState = structuredClone(realState);
        const bindingContext = getBindingContext();
        const messageIndex = (getContext().chat || []).length - 1;
        const swipeId = activeSwipeId(getContext().chat?.[messageIndex]);
        const evaluationContext = { messageIndex, swipeId, ...evaluationOptions };
        const definitions = new Map();
        for (const set of settings.eventSets || []) {
            const active = isSetActive(set, bindingContext);
            for (const event of set.events || []) definitions.set(event.id, { event, active });
        }
        const texts = new Map();
        for (const [eventId, payload] of Object.entries(realState.pendingEventInjections || {})) {
            const definition = definitions.get(eventId);
            if (!definition || !payload?.text || !payload?.injection) continue;
            if (!payload.manual && (!definition.active || !definition.event.enabled)) continue;
            texts.set(eventId, { text: payload.text, injection: payload.injection });
        }
        const trackResult = evaluateStateTracks(
            settings.eventSets,
            clonedState,
            bindingContext,
            evaluationContext,
        );
        const routerResult = evaluatePromptRouters(
            settings.eventSets,
            clonedState,
            bindingContext,
            evaluationContext,
        );
        clearAllInjections(settings);
        applyInjectionTexts(texts, trackResult.texts, routerResult.texts);
        debug('Primed injections on chat load');
    } catch (error) {
        console.warn(LOG_PREFIX, 'Failed to prime injections:', error);
    }
}

export function registerMacro() {
    macroRegistered = registerHostMacro(
        'dynamicEvents',
        () => macroBuffer,
        'Inserts active Dynamic Events text.',
    );
    if (macroRegistered) {
        debug('Registered {{dynamicEvents}} macro');
    } else {
        debug('Macro system unavailable');
    }
    registerConfiguredPromptOutlets();
    return macroRegistered;
}

export function isMacroRegistered() {
    return macroRegistered;
}

export function anyMacroEventsConfigured() {
    return getSettings().eventSets.some(set =>
        set.events.some(event => event.enabled && event.injection?.mode === InjectionMode.MACRO)
        || (set.stateTracks || []).some(track => track.enabled && track.injection?.mode === InjectionMode.MACRO)
        || (set.promptRouters || []).some(router => router.enabled && router.injection?.mode === InjectionMode.MACRO));
}
