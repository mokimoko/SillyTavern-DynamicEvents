import { SlashCommandParser } from '../../../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from '../../../../../slash-commands/SlashCommandArgument.js';
import { scrubAllCaptureTags } from '../runtime/captureTags.js';
import {
    forceFireEvent,
    getStatusReport,
    resetAllEventStates,
    resetEventState,
} from '../runtime/manualOperations.js';

export function registerSlashCommands({ onMutation = () => {} } = {}) {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'dynevt-fire',
        callback: (_, value) => {
            const name = value?.trim();
            if (!name) { toastr.warning('Usage: /dynevt-fire [event name]'); return ''; }
            const result = forceFireEvent(name);
            toastr.info(result, 'Dynamic Events');
            onMutation();
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
            const result = target ? resetEventState(target) : (resetAllEventStates(), 'Reset all event states.');
            toastr.info(result, 'Dynamic Events');
            onMutation();
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
            const count = scrubAllCaptureTags();
            const message = count > 0 ? `Scrubbed capture tags from ${count} message(s).` : 'No capture tags found.';
            toastr.info(message, 'Dynamic Events');
            return message;
        },
        helpString: 'Remove any leftover <!--DE:...--> capture tags from the entire chat history.',
    }));
}
