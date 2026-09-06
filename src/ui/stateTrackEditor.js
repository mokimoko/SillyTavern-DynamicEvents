import {
    ConditionType,
    InjectionMode,
    PromptPosition,
    PromptRole,
    createConditionGroup,
} from '../../eventEngine.js';
import {
    TrackTransitionMode,
    createTrackState,
} from '../tracks/stateTracks.js';
import { renderActionEditor, wireActionEditor } from './actionEditor.js';
import {
    createDefaultProviderCondition,
    renderConditionEditor,
    wireConditionEditor,
} from './conditionEditor.js';
import {
    availableSubjectsFromConditions,
    renderSubjectEditor,
    wireSubjectEditor,
} from './subjectEditor.js';

function esc(value) {
    const element = document.createElement('div');
    element.textContent = String(value ?? '');
    return element.innerHTML;
}

function availableSubjects(track) {
    return availableSubjectsFromConditions((track.states || []).flatMap(state => [
        state.condition,
        state.exitCondition,
    ]));
}

function renderConditionSection(state, property, label, detail = null) {
    const condition = state[property];
    const configured = condition && condition.type !== ConditionType.NONE;
    return `
        <div class="dynevt-track-condition-editor" data-condition-property="${property}">
            <div class="dynevt-track-subheading">
                <span>${label}</span>
                ${configured ? '' : '<button class="dynevt-btn dynevt-btn-sm" data-condition-action="enable">Add conditions</button>'}
            </div>
            ${configured ? renderConditionEditor(condition, { prefix: property, providerOnly: true, detail }) : '<div class="dynevt-hint">No condition configured.</div>'}
        </div>`;
}

export function renderStateTrackRow(track, inspection = {}, { bulkSelected = false, editing = false } = {}) {
    const active = (track.states || []).find(state => state.id === inspection.activeStateId);
    return `
        <div class="dynevt-event-row dynevt-track-row ${bulkSelected ? 'bulk-selected' : ''} ${editing ? 'editing' : ''}" data-track-id="${esc(track.id)}" data-component-id="${esc(track.id)}" aria-selected="${bulkSelected}" ${editing ? 'aria-current="true"' : ''}>
            <span class="dynevt-drag-spacer" aria-hidden="true"></span>
            <label class="dynevt-event-select" onclick="event.stopPropagation()" title="Select this State Track for bulk actions">
                <input type="checkbox" ${bulkSelected ? 'checked' : ''} data-action="select-component" aria-label="Select ${esc(track.name)} for bulk actions" />
            </label>
            <label class="dynevt-event-enable-toggle" onclick="event.stopPropagation()" title="${track.enabled ? 'Disable' : 'Enable'} this State Track">
                <input type="checkbox" ${track.enabled ? 'checked' : ''} data-track-action="toggle" aria-label="${track.enabled ? 'Disable' : 'Enable'} ${esc(track.name)}" />
                <span aria-hidden="true"></span>
            </label>
            <i class="fa-solid fa-layer-group dynevt-event-icon"></i>
            <span class="dynevt-event-name">${esc(track.name)}</span>
            <span class="dynevt-event-type">state track</span>
            <span class="dynevt-event-status">${active ? `${esc(active.name)}${inspection.subject ? ` · ${esc(inspection.subject)}` : ''}` : 'No matching state'}</span>
            <button class="dynevt-btn-icon" data-track-action="reset" title="Reset selected state"><i class="fa-solid fa-rotate-left"></i></button>
            <button class="dynevt-btn-icon" data-track-action="delete" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div>`;
}

function renderTrackState(state, inspection) {
    const result = inspection.conditionResults?.[state.id];
    const active = inspection.activeStateId === state.id;
    const status = state.isFallback ? 'Fallback' : result ? 'Matches' : 'Does not match';
    return `
        <section class="dynevt-track-state ${active ? 'active' : ''}" data-state-id="${state.id}">
            <div class="dynevt-track-state-head">
                <input class="dynevt-input dynevt-phase-name" data-state-field="name" value="${esc(state.name)}" placeholder="State name" />
                <span class="dynevt-track-state-status ${result === false ? 'unmet' : ''}">${active ? 'Active · ' : ''}${status}</span>
                <button class="dynevt-btn-icon" data-state-action="delete" title="Delete state"><i class="fa-solid fa-trash"></i></button>
            </div>
            <div class="dynevt-editor-row">
                <div class="dynevt-field"><label>Priority</label><input type="number" class="dynevt-input dynevt-input-sm" data-state-field="priority" value="${state.priority || 0}" /></div>
                <div class="dynevt-field"><label>Minimum turns active</label><input type="number" min="0" class="dynevt-input dynevt-input-sm" data-state-field="minDuration" value="${state.minDuration || 0}" /></div>
            </div>
            <div class="dynevt-option-row"><label class="dynevt-toggle-label"><input type="checkbox" data-state-field="isFallback" ${state.isFallback ? 'checked' : ''} /><span>Fallback state</span></label></div>
            ${state.isFallback ? '' : renderConditionSection(state, 'condition', 'Enter / match when', inspection.conditionDetails?.[state.id])}
            ${renderConditionSection(state, 'exitCondition', 'Explicit exit condition (optional)')}
            <div class="dynevt-field"><label>Current-state capsule <span class="dynevt-hint">Use {{subject}} for the mapped narrative character.</span></label>
                <textarea class="dynevt-textarea dynevt-phase-text" rows="6" data-state-field="text" placeholder="Complete instructions the model needs on every response while this state is active…">${esc(state.text)}</textarea></div>
            <div class="dynevt-field"><label>On-enter instruction <span class="dynevt-hint">Injected once when this state becomes active.</span></label>
                <textarea class="dynevt-textarea" rows="3" data-state-field="entryText" placeholder="Optional transition beat…">${esc(state.entryText)}</textarea></div>
            ${renderActionEditor(state.onEnterActions || [], {
                title: 'On-enter actions',
                allowSubject: true,
                subjectLabel: "This State Track's subject",
            })}
        </section>`;
}

export function renderStateTrackEditor(track, inspection = {}) {
    const subjects = availableSubjects(track);
    const injection = {
        mode: InjectionMode.EXTENSION_PROMPT,
        position: PromptPosition.IN_CHAT,
        depth: 1,
        role: PromptRole.SYSTEM,
        ...(track.injection || {}),
    };
    const isMacro = injection.mode === InjectionMode.MACRO;
    return `
        <div class="dynevt-editor dynevt-track-editor" data-track-editor="${track.id}">
            <div class="dynevt-editor-row">
                <div class="dynevt-field dynevt-field-grow"><label>Track name</label><input class="dynevt-input" data-track-field="name" value="${esc(track.name)}" /></div>
                <div class="dynevt-field"><label>Transition behavior</label><select class="dynevt-select" data-track-field="transitionMode">
                    <option value="${TrackTransitionMode.REVERSIBLE}" ${track.transitionMode === TrackTransitionMode.REVERSIBLE ? 'selected' : ''}>Reversible</option>
                    <option value="${TrackTransitionMode.STICKY}" ${track.transitionMode === TrackTransitionMode.STICKY ? 'selected' : ''}>Sticky / hysteresis</option>
                    <option value="${TrackTransitionMode.ONE_WAY}" ${track.transitionMode === TrackTransitionMode.ONE_WAY ? 'selected' : ''}>One-way</option>
                    <option value="${TrackTransitionMode.LATCHED}" ${track.transitionMode === TrackTransitionMode.LATCHED ? 'selected' : ''}>Latched until exit</option>
                </select></div>
            </div>
            ${renderSubjectEditor(track.subject, {
                id: `track-${track.id}`,
                label: 'Relationship subject',
                suggestions: subjects,
                hint: 'Choose who this track describes here. Change validated agent sources inside each state\'s Enter / match and Exit conditions below.',
            })}
            <div class="dynevt-track-diagnostic">Resolved subject: <strong>${esc(inspection.subject || 'not available')}</strong> · Active state: <strong>${esc((track.states || []).find(state => state.id === inspection.activeStateId)?.name || 'none')}</strong></div>
            <div class="dynevt-section-label">Injection</div>
            <div class="dynevt-editor-row dynevt-track-injection">
                <div class="dynevt-field"><label>Mode</label>
                    <select class="dynevt-select" data-track-injection-field="mode">
                        <option value="${InjectionMode.EXTENSION_PROMPT}" ${!isMacro ? 'selected' : ''}>Extension Prompt</option>
                        <option value="${InjectionMode.MACRO}" ${isMacro ? 'selected' : ''}>Macro {{dynamicEvents}}</option>
                    </select></div>
                <div class="dynevt-field ${isMacro ? 'hidden' : ''}" data-track-show="ext-prompt"><label>Position</label>
                    <select class="dynevt-select" data-track-injection-field="position" data-number>
                        <option value="${PromptPosition.IN_PROMPT}" ${injection.position === PromptPosition.IN_PROMPT ? 'selected' : ''}>In Prompt (after story)</option>
                        <option value="${PromptPosition.IN_CHAT}" ${injection.position === PromptPosition.IN_CHAT ? 'selected' : ''}>In Chat (at depth)</option>
                        <option value="${PromptPosition.BEFORE_PROMPT}" ${injection.position === PromptPosition.BEFORE_PROMPT ? 'selected' : ''}>Before Prompt</option>
                    </select></div>
                <div class="dynevt-field ${isMacro ? 'hidden' : ''}" data-track-show="ext-prompt"><label>Depth</label>
                    <input type="number" class="dynevt-input dynevt-input-sm" data-track-injection-field="depth" value="${injection.depth}" min="0" max="999" /></div>
                <div class="dynevt-field ${isMacro ? 'hidden' : ''}" data-track-show="ext-prompt"><label>Role</label>
                    <select class="dynevt-select" data-track-injection-field="role" data-number>
                        <option value="${PromptRole.SYSTEM}" ${injection.role === PromptRole.SYSTEM ? 'selected' : ''}>System</option>
                        <option value="${PromptRole.USER}" ${injection.role === PromptRole.USER ? 'selected' : ''}>User</option>
                        <option value="${PromptRole.ASSISTANT}" ${injection.role === PromptRole.ASSISTANT ? 'selected' : ''}>Assistant</option>
                    </select></div>
            </div>
            <div class="dynevt-track-states">
                ${(track.states || []).map(state => renderTrackState(state, inspection)).join('') || '<div class="dynevt-empty">No states yet.</div>'}
            </div>
            <button class="dynevt-btn dynevt-btn-accent" data-track-action="add-state"><i class="fa-solid fa-plus"></i> Add State</button>
        </div>`;
}

function wireTrackConditionEditor(container, state, property, callbacks) {
    const editor = container.querySelector(`[data-condition-property="${property}"]`);
    if (!editor) return;

    editor.querySelector('[data-condition-action="enable"]')?.addEventListener('click', () => {
        state[property] = createConditionGroup({ conditions: [createDefaultProviderCondition()] });
        callbacks.changed(true);
    });
    const conditionRoot = editor.querySelector('.dynevt-condition');
    if (!conditionRoot) return;
    wireConditionEditor(conditionRoot, state[property], rerender => {
        callbacks.changed(rerender);
        // A structural State Track update re-renders the complete right panel.
        return !rerender;
    }, { providerOnly: true });
}

export function wireStateTrackEditor(container, track, callbacks) {
    container.querySelectorAll('[data-track-field]').forEach(input => {
        input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
            track[input.dataset.trackField] = input.value;
            callbacks.changed(input.tagName === 'SELECT');
        });
    });
    wireSubjectEditor(container, track, callbacks);
    track.injection ||= {
        mode: InjectionMode.EXTENSION_PROMPT,
        position: PromptPosition.IN_CHAT,
        depth: 1,
        role: PromptRole.SYSTEM,
    };
    container.querySelectorAll('[data-track-injection-field]').forEach(input => {
        input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
            const field = input.dataset.trackInjectionField;
            track.injection[field] = input.type === 'number' || input.hasAttribute('data-number')
                ? Number(input.value)
                : input.value;
            if (field === 'mode') {
                const hide = input.value === InjectionMode.MACRO;
                container.querySelectorAll('[data-track-show="ext-prompt"]')
                    .forEach(element => element.classList.toggle('hidden', hide));
            }
            callbacks.changed(false);
        });
    });
    container.querySelector('[data-track-action="add-state"]')?.addEventListener('click', () => {
        track.states.push(createTrackState({
            name: `State ${track.states.length + 1}`,
            condition: createConditionGroup({ conditions: [createDefaultProviderCondition()] }),
        }));
        callbacks.changed(true);
    });

    container.querySelectorAll('[data-state-id]').forEach(stateElement => {
        const state = track.states.find(item => item.id === stateElement.dataset.stateId);
        if (!state) return;
        stateElement.querySelectorAll('[data-state-field]').forEach(input => {
            const eventName = input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input';
            input.addEventListener(eventName, () => {
                const field = input.dataset.stateField;
                if (input.type === 'checkbox') state[field] = input.checked;
                else if (input.type === 'number') state[field] = Number(input.value) || 0;
                else state[field] = input.value;
                if (field === 'isFallback' && state.isFallback) {
                    for (const other of track.states) if (other.id !== state.id) other.isFallback = false;
                }
                callbacks.changed(field === 'isFallback');
            });
        });
        stateElement.querySelector('[data-state-action="delete"]')?.addEventListener('click', async () => {
            if (!await callbacks.confirmDelete(`Delete state "${state.name}"?`)) return;
            track.states = track.states.filter(item => item.id !== state.id);
            callbacks.changed(true);
        });
        wireTrackConditionEditor(stateElement, state, 'condition', callbacks);
        wireTrackConditionEditor(stateElement, state, 'exitCondition', callbacks);
        wireActionEditor(stateElement, state, 'onEnterActions', callbacks, { allowSubject: true });
    });
}
