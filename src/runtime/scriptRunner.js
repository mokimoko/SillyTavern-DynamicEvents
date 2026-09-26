import { getContext } from '../../../../../extensions.js';
import { evaluateCondition, evaluateScripts } from '../../eventEngine.js';
import { debug, getSettings } from '../config/settings.js';
import { cloneRuntimeState } from './branchState.js';
import { getBindingContext } from './bindingContext.js';
import { getChatState, saveChatState } from './chatState.js';
import { openTimeSkipDialog } from '../ui/timeSkipDialog.js';

const LOG_PREFIX = '[DynEvents]';
let scriptsRunning = false;

export async function runScripts(timing, options = {}) {
    const settings = getSettings();
    if (!settings.enabled || scriptsRunning) return [];
    const chatState = options.chatState || cloneRuntimeState(getChatState());
    const bindingContext = getBindingContext();
    const messages = getContext().chat || [];
    let scripts;
    try {
        scripts = evaluateScripts(settings.eventSets, chatState, bindingContext, timing, {
            messageIndex: options.messageIndex,
            swipeId: options.swipeId,
            messages,
            keywordCache: new Map(),
        });
    } catch (error) {
        console.error(LOG_PREFIX, 'evaluateScripts failed:', error);
        return [];
    }
    if (options.persist !== false) {
        saveChatState(chatState, { messageIndex: options.messageIndex, swipeId: options.swipeId });
    }
    if (!scripts.length) return [];
    scriptsRunning = true;
    try {
        for (const script of scripts) await executeScript(script);
    } finally {
        scriptsRunning = false;
    }
    debug(`Ran ${scripts.length} script(s) on ${timing}: ${scripts.map(script => script.name).join(', ')}`);
    return scripts;
}

async function executeScript(script) {
    if (script.builtInAction === 'time-skip') return openTimeSkipDialog();
    const body = (script.body || '').trim();
    if (!body) return;
    try {
        const context = getContext();
        if (typeof context.executeSlashCommandsWithOptions === 'function') {
            return await context.executeSlashCommandsWithOptions(body, { handleParserErrors: true, source: 'dynamicEvents' });
        }
        if (typeof context.executeSlashCommands === 'function') return await context.executeSlashCommands(body, true);
        console.warn(LOG_PREFIX, 'No slash-command executor available; script skipped:', script.name);
    } catch (error) {
        console.error(LOG_PREFIX, `Script "${script.name}" failed:`, error);
        toastr.error(`Script "${script.name}" failed. Check console.`, 'Dynamic Events');
    }
}

export async function runManualScript(script, { showSuccessToast = true } = {}) {
    if (!script || scriptsRunning) return;
    if (!evaluateCondition(script.condition, getChatState(), {
        ...getBindingContext(),
        messages: getContext().chat || [],
        keywordCache: new Map(),
    })) {
        toastr.info(`Script "${script.name}": condition not met.`, 'Dynamic Events');
        return;
    }
    scriptsRunning = true;
    try {
        await executeScript(script);
    } finally {
        scriptsRunning = false;
    }
    if (showSuccessToast && !script.builtInAction) toastr.info(`Ran script: ${script.name}`, 'Dynamic Events');
}
