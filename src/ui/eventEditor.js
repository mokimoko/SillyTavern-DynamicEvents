import {
    EventCategory,
    InjectionMode,
    PromptPosition,
    PromptRole,
    ScheduleType,
    createCondition,
    createPhase,
    getEventStatus,
} from '../../eventEngine.js';
import { saveSettings } from '../config/settings.js';
import { getChatState } from '../runtime/chatState.js';
import { availableSubjectsFromConditions, renderSubjectEditor, wireSubjectEditor } from './subjectEditor.js';
import { renderActionEditor, wireActionEditor } from './actionEditor.js';
import { renderConditionHTML, wireConditionFields } from './conditionEditor.js';
import { renderSharedInstructionPicker, wireSharedInstructionPicker } from './sharedInstructionEditor.js';

let services = {
    getSelectedEventId: () => null,
    collapsedPhases: new Set(),
    updateEventButtons: () => {},
    confirm: null,
};

export function configureEventEditor(nextServices) {
    services = { ...services, ...nextServices };
}

function esc(value) {
    const element = document.createElement('div');
    element.textContent = String(value ?? '');
    return element.innerHTML;
}

function getEventScheduleExplanation(evt) {
    if (evt.schedule.type === ScheduleType.ONE_SHOT) {
        return '<strong>One-shot timing:</strong> its first chance is <code>Initial Delay + a random Interval</code>. If it has a condition, that countdown begins when the condition first becomes true. Probability is rolled at that first chance and again on each later message until it fires.';
    }
    if (evt.schedule.type === ScheduleType.PLOT_CHAIN) {
        return '<strong>Plot-chain timing:</strong> Initial Delay controls the first activation. Later pacing comes from each phase\'s duration; Interval Min/Max do not schedule phase changes.';
    }
    return '<strong>Recurring timing:</strong> its first chance is <code>Initial Delay + a random Interval</code>. After a fire or missed probability roll, a fresh interval schedules the next chance.';
}

export function renderEventEditor(set) {
    const el = document.getElementById('dynevt-event-editor');
    if (!el) return;
    const evt = set.events.find(e => e.id === services.getSelectedEventId());
    if (!evt) { el.innerHTML = ''; return; }

    const isChain = evt.schedule.type === ScheduleType.PLOT_CHAIN;
    const isMacro = evt.injection.mode === InjectionMode.MACRO;
    const capture = evt.capture || { enabled: false, varName: '' };
    const runtimeState = getChatState()?.eventStates?.[evt.id] || null;
    const runtimeStatus = getEventStatus(evt, getChatState());
    const subjectSuggestions = availableSubjectsFromConditions([
        evt.condition,
        ...(evt.phases || []).map(phase => phase.condition),
    ]);
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

            ${renderSharedInstructionPicker(set, evt)}

            ${renderSubjectEditor(evt.subject, {
                id: `event-${evt.id}`,
                label: 'Event subject',
                suggestions: subjectSuggestions,
                allowStateSource: true,
                hint: 'Choose a fixed character or an eligible state entry. Map endpoint fields for paired records: {{subject}} names the first endpoint, {{counterpart}} the second, and {{subjectState.field}} reads the selected record.',
            })}

            <div class="dynevt-section-label">Schedule Settings</div>
            <div class="dynevt-editor-row">
                <div class="dynevt-field"><label>Interval Min</label>
                    <input type="number" class="dynevt-input dynevt-input-sm" data-f="schedule.intervalMin" value="${evt.schedule.intervalMin}" min="0" /></div>
                <div class="dynevt-field"><label>Interval Max</label>
                    <input type="number" class="dynevt-input dynevt-input-sm" data-f="schedule.intervalMax" value="${evt.schedule.intervalMax}" min="0" /></div>
                <div class="dynevt-field"><label>Probability (%)</label>
                    <input type="number" class="dynevt-input dynevt-input-sm" data-f="schedule.probability" data-pct value="${Math.round(evt.schedule.probability * 100)}" min="0" max="100" step="5" /></div>
                <div class="dynevt-field"><label>Cooldown</label>
                    <input type="number" class="dynevt-input dynevt-input-sm" data-f="schedule.cooldown" value="${evt.schedule.cooldown}" min="0" /></div>
                <div class="dynevt-field"><label>Initial Delay</label>
                    <input type="number" class="dynevt-input dynevt-input-sm" data-f="schedule.initialDelay" value="${evt.schedule.initialDelay}" min="0" /></div>
            </div>
            <div class="dynevt-schedule-note">
                <i class="fa-solid fa-clock" aria-hidden="true"></i>
                <div>
                    <div id="dynevt-schedule-explanation">${getEventScheduleExplanation(evt)}</div>
                    ${runtimeState ? `<div class="dynevt-schedule-runtime"><span>Current chat: ${esc(runtimeStatus)}. Schedule edits keep this existing runtime until reset.</span><button type="button" class="dynevt-btn dynevt-btn-sm" id="dynevt-reset-schedule-state"><i class="fa-solid fa-rotate-left"></i> Apply &amp; reset schedule</button></div>` : '<div class="dynevt-schedule-runtime">No runtime has been seeded for this Event in the current chat yet.</div>'}
                </div>
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

            ${renderActionEditor(evt.actions || [], {
                title: 'When this event fires',
                allowSubject: true,
                allowCounterpart: Boolean(evt.subject?.counterpartPath),
                subjectLabel: "This Event's subject",
            })}

            <div class="dynevt-section-label"><i class="fa-solid fa-lock" style="font-size:0.85em"></i> Condition</div>
            <div class="dynevt-cond-wrap">
                <div id="dynevt-evt-condition" class="dynevt-cond-main">
                    ${renderConditionHTML(evt.condition || createCondition(), 'evt', evt.id, false)}
                </div>
            </div>
            <div class="dynevt-option-row">
                <label class="dynevt-toggle-label"><input type="checkbox" id="dynevt-btn-activated" ${evt.buttonActivated ? 'checked' : ''} /><span>Show manual trigger button</span></label>
                <label class="dynevt-toggle-label" title="Do not fire this Event twice for the same resolved subject key."><input type="checkbox" id="dynevt-once-per-subject" ${evt.oncePerSubject ? 'checked' : ''} /><span>Fire once per resolved subject</span></label>
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
    wireSubjectEditor(el, evt, {
        changed: rerender => {
            saveSettings();
            if (rerender) renderEventEditor(set);
        },
    });
    wireActionEditor(el, evt, 'actions', {
        changed: rerender => {
            saveSettings();
            if (rerender) renderEventEditor(set);
        },
    }, {
        allowSubject: true,
        allowCounterpart: Boolean(evt.subject?.counterpartPath),
    });
    wireSharedInstructionPicker(el, set, evt, {
        changed: () => saveSettings(),
        closed: () => renderEventEditor(set),
        confirm: services.confirm,
    });

    el.querySelector('#dynevt-reset-schedule-state')?.addEventListener('click', () => {
        resetEventRuntimeState(evt);
    });

    // Wire event-level condition
    if (!evt.condition) evt.condition = createCondition();
    const condContainer = el.querySelector('#dynevt-evt-condition .dynevt-condition');
    if (condContainer) wireConditionFields(condContainer, evt.condition, saveSettings, evt.id);

    // Wire manual-trigger button toggle
    el.querySelector('#dynevt-btn-activated')?.addEventListener('change', function () {
        evt.buttonActivated = this.checked;
        saveSettings();
        services.updateEventButtons();
    });
    el.querySelector('#dynevt-once-per-subject')?.addEventListener('change', function () {
        evt.oncePerSubject = this.checked;
        saveSettings();
    });

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
                const explanation = el.querySelector('#dynevt-schedule-explanation');
                if (explanation) explanation.innerHTML = getEventScheduleExplanation(evt);
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
        const collapsed = services.collapsedPhases.has(ph.id);
        return `
        <div class="dynevt-phase ${collapsed ? 'collapsed' : ''}" data-idx="${i}" data-phase-id="${ph.id}">
            <div class="dynevt-phase-header">
                <button class="dynevt-btn-icon dynevt-phase-collapse" data-action="toggle-phase" title="${collapsed ? 'Expand' : 'Collapse'}">
                    <i class="fa-solid fa-chevron-${collapsed ? 'right' : 'down'}"></i>
                </button>
                <input type="text" class="dynevt-input dynevt-input-sm dynevt-phase-name" data-pi="${i}" data-pf="name" value="${esc(ph.name)}" />
                <button class="dynevt-btn-icon" data-action="del-phase" data-idx="${i}" title="Remove"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="dynevt-phase-body" ${collapsed ? 'style="display:none"' : ''}>
                <textarea class="dynevt-textarea dynevt-textarea-sm dynevt-phase-text" data-pi="${i}" data-pf="text" rows="5" placeholder="Phase text…">${esc(ph.text)}</textarea>
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
            if (services.collapsedPhases.has(phaseId)) services.collapsedPhases.delete(phaseId);
            else services.collapsedPhases.add(phaseId);
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
