import {
    ScriptTiming,
    createCondition,
    getScriptStatus,
    isCountingTiming,
} from '../../eventEngine.js';
import { saveSettings } from '../config/settings.js';
import { getChatState } from '../runtime/chatState.js';
import { runManualScript } from '../runtime/scriptRunner.js';
import { renderConditionHTML, wireConditionFields } from './conditionEditor.js';

let services = {
    getSelectedScriptId: () => null,
    selectScript: () => {},
    renderRightPanel: () => {},
    updateEventButtons: () => {},
    confirm: async () => false,
};

export function configureScriptEditor(nextServices) {
    services = { ...services, ...nextServices };
}

function esc(value) {
    const element = document.createElement('div');
    element.textContent = String(value ?? '');
    return element.innerHTML;
}

export const SCRIPT_TIMING_LABELS = {
    [ScriptTiming.BEFORE_AI]: 'Before AI responds',
    [ScriptTiming.AFTER_AI]: 'After AI responds',
    [ScriptTiming.CHAT_CHANGED]: 'On chat load',
    [ScriptTiming.CHAT_CREATED]: 'On new chat',
    [ScriptTiming.MANUAL]: 'Manual only',
};
const SCRIPT_TIMING_ICONS = {
    [ScriptTiming.BEFORE_AI]: 'fa-user',
    [ScriptTiming.AFTER_AI]: 'fa-robot',
    [ScriptTiming.CHAT_CHANGED]: 'fa-arrows-rotate',
    [ScriptTiming.CHAT_CREATED]: 'fa-file-circle-plus',
    [ScriptTiming.MANUAL]: 'fa-hand-pointer',
};

export function renderScriptRow(scr, {
    bulkSelected = false,
    editing = false,
    chatState = getChatState(),
} = {}) {
    const status = chatState ? getScriptStatus(scr, chatState) : '';
    const timing = scr.trigger?.timing || ScriptTiming.AFTER_AI;
    const icon = SCRIPT_TIMING_ICONS[timing] || 'fa-terminal';

    return `
        <div class="dynevt-event-row dynevt-script-row ${bulkSelected ? 'bulk-selected' : ''} ${editing ? 'editing' : ''}" data-id="${esc(scr.id)}" data-component-id="${esc(scr.id)}" draggable="true" aria-selected="${bulkSelected}" ${editing ? 'aria-current="true"' : ''}>
            <i class="fa-solid fa-grip-vertical dynevt-drag-handle" title="Drag to reorder"></i>
            <label class="dynevt-event-select" onclick="event.stopPropagation()" title="Select this Script for bulk actions">
                <input type="checkbox" ${bulkSelected ? 'checked' : ''} data-action="select-component" aria-label="Select ${esc(scr.name)} for bulk actions" />
            </label>
            <label class="dynevt-event-enable-toggle" onclick="event.stopPropagation()" title="${scr.enabled ? 'Disable' : 'Enable'} this Script">
                <input type="checkbox" ${scr.enabled ? 'checked' : ''} data-action="toggle-script" aria-label="${scr.enabled ? 'Disable' : 'Enable'} ${esc(scr.name)}" />
                <span aria-hidden="true"></span>
            </label>
            <i class="fa-solid ${icon} dynevt-event-icon" title="${SCRIPT_TIMING_LABELS[timing] || timing}"></i>
            <span class="dynevt-event-name">${esc(scr.name)}</span>
            <span class="dynevt-event-type">${SCRIPT_TIMING_LABELS[timing] || timing}</span>
            <span class="dynevt-event-status">${esc(status)}</span>
            <button class="dynevt-btn-icon" data-action="run-script" title="Run now" onclick="event.stopPropagation()">
                <i class="fa-solid fa-play"></i>
            </button>
            <button class="dynevt-btn-icon" data-action="delete-script" title="Delete" onclick="event.stopPropagation()">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
    `;
}

export function wireScriptRows(panel, set) {
    let dragSourceId = null;

    panel.querySelectorAll('.dynevt-script-row').forEach(row => {
        const id = row.dataset.id;

        row.addEventListener('click', (e) => {
            if (e.target.closest('input, button, [data-action]')) return;
            services.selectScript(services.getSelectedScriptId() === id ? null : id);
            services.renderRightPanel();
        });

        row.querySelector('[data-action="toggle-script"]')?.addEventListener('change', function () {
            const scr = set.scripts.find(s => s.id === id);
            if (scr) {
                scr.enabled = this.checked;
                saveSettings();
                services.updateEventButtons();
            }
        });

        row.querySelector('[data-action="run-script"]')?.addEventListener('click', () => {
            const scr = set.scripts.find(s => s.id === id);
            if (scr) runManualScript(scr);
        });

        row.querySelector('[data-action="delete-script"]')?.addEventListener('click', async () => {
            const scr = set.scripts.find(s => s.id === id);
            if (!scr) return;
            const ok = await services.confirm(`Delete script "${scr.name}"?`);
            if (!ok) return;
            set.scripts = set.scripts.filter(s => s.id !== id);
            if (services.getSelectedScriptId() === id) services.selectScript(null);
            saveSettings();
            services.renderRightPanel();
            services.updateEventButtons();
        });

        // ─── Drag-and-drop reorder (order controls run sequence) ───
        row.addEventListener('dragstart', (e) => {
            dragSourceId = id;
            row.classList.add('dynevt-dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        row.addEventListener('dragend', () => {
            dragSourceId = null;
            row.classList.remove('dynevt-dragging');
            panel.querySelectorAll('.dynevt-script-row').forEach(r => r.classList.remove('dynevt-drag-over-top', 'dynevt-drag-over-bottom'));
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
            const fromIdx = set.scripts.findIndex(s => s.id === dragSourceId);
            let toIdx = set.scripts.findIndex(s => s.id === id);
            if (fromIdx < 0 || toIdx < 0) return;
            const rect = row.getBoundingClientRect();
            if (e.clientY >= rect.top + rect.height / 2) toIdx++;
            if (fromIdx < toIdx) toIdx--;
            const [moved] = set.scripts.splice(fromIdx, 1);
            set.scripts.splice(toIdx, 0, moved);
            saveSettings();
            services.renderRightPanel();
        });
    });
}

// ═══════════════════════════════════════════════════════════════
// SCRIPT EDITOR (inside right panel)
// ═══════════════════════════════════════════════════════════════

export function renderScriptEditor(set) {
    const el = document.getElementById('dynevt-script-editor');
    if (!el) return;
    const scr = (set.scripts || []).find(s => s.id === services.getSelectedScriptId());
    if (!scr) { el.innerHTML = ''; return; }
    if (!scr.trigger) scr.trigger = { timing: ScriptTiming.AFTER_AI, interval: 1, probability: 1.0, cooldown: 0, initialDelay: 0 };
    if (!scr.condition) scr.condition = createCondition();

    const timing = scr.trigger.timing || ScriptTiming.AFTER_AI;
    const counting = isCountingTiming(timing);
    const timeSkip = scr.builtInAction === 'time-skip';

    el.innerHTML = `
        <div class="dynevt-editor">
            <div class="dynevt-editor-row">
                <div class="dynevt-field"><label>Name</label>
                    <input type="text" class="dynevt-input" id="dynevt-scr-name" value="${esc(scr.name)}" /></div>
                <div class="dynevt-field"><label>Trigger</label>
                    ${timeSkip ? '<div class="dynevt-script-built-in-trigger">Manual only</div>' : `
                    <select class="dynevt-select" id="dynevt-scr-timing">
                        ${Object.values(ScriptTiming).map(t => `<option value="${t}" ${timing === t ? 'selected' : ''}>${SCRIPT_TIMING_LABELS[t]}</option>`).join('')}
                    </select>`}</div>
            </div>

            <div class="dynevt-editor-row ${counting && !timeSkip ? '' : 'hidden'}" id="dynevt-scr-sched">
                <div class="dynevt-field"><label>Every N</label>
                    <input type="number" class="dynevt-input dynevt-input-sm" id="dynevt-scr-interval" value="${scr.trigger.interval}" min="1" /></div>
                <div class="dynevt-field"><label>Probability (%)</label>
                    <input type="number" class="dynevt-input dynevt-input-sm" id="dynevt-scr-prob" value="${Math.round((scr.trigger.probability ?? 1) * 100)}" min="0" max="100" step="5" /></div>
                <div class="dynevt-field"><label>Cooldown</label>
                    <input type="number" class="dynevt-input dynevt-input-sm" id="dynevt-scr-cooldown" value="${scr.trigger.cooldown || 0}" min="0" /></div>
                <div class="dynevt-field"><label>Initial Delay</label>
                    <input type="number" class="dynevt-input dynevt-input-sm" id="dynevt-scr-delay" value="${scr.trigger.initialDelay || 0}" min="0" /></div>
            </div>

            ${timeSkip ? `<div class="dynevt-script-built-in-note">Privately plans an unquoted neutral narrator transition, lets you edit its text and displayed narrator name, choose the responder, then opens a playable new scene with a normal character reply. The opening direction remains active for swipes and clears after your next message. Group chats use the selected member’s exact name. If SuperAgents World State is active, its date and time are used as the baseline.</div>` : `<div class="dynevt-field">
                <label>STScript</label>
                <textarea class="dynevt-textarea" id="dynevt-scr-body" rows="3" placeholder="/setvar key=mood value=tense">${esc(scr.body)}</textarea>
                <div class="dynevt-hint">Runs SillyTavern slash commands (STScript). Macros like <code>{{user}}</code> resolve at run time.</div>
            </div>`}

            <div class="dynevt-section-label"><i class="fa-solid fa-lock" style="font-size:0.85em"></i> Condition</div>
            <div class="dynevt-cond-wrap">
                <div id="dynevt-scr-condition" class="dynevt-cond-main">
                    ${renderConditionHTML(scr.condition, 'scr', '', false)}
                </div>
            </div>
            <div class="dynevt-option-row"><label class="dynevt-toggle-label"><input type="checkbox" id="dynevt-scr-btn-activated" ${scr.buttonActivated ? 'checked' : ''} /><span>Show manual trigger button</span></label></div>
        </div>
    `;

    // Wire fields
    el.querySelector('#dynevt-scr-name')?.addEventListener('input', function () {
        scr.name = this.value; saveSettings(); renderScriptListOnly(set); services.updateEventButtons();
    });
    el.querySelector('#dynevt-scr-timing')?.addEventListener('change', function () {
        scr.trigger.timing = this.value; saveSettings();
        renderScriptEditor(set);   // re-render to show/hide schedule fields
        renderScriptListOnly(set);
        services.updateEventButtons();
    });
    el.querySelector('#dynevt-scr-interval')?.addEventListener('input', function () {
        scr.trigger.interval = Math.max(1, parseInt(this.value) || 1); saveSettings();
    });
    el.querySelector('#dynevt-scr-prob')?.addEventListener('input', function () {
        const pct = Math.min(100, Math.max(0, parseInt(this.value) || 0));
        scr.trigger.probability = pct / 100; saveSettings();
    });
    el.querySelector('#dynevt-scr-cooldown')?.addEventListener('input', function () {
        scr.trigger.cooldown = Math.max(0, parseInt(this.value) || 0); saveSettings();
    });
    el.querySelector('#dynevt-scr-delay')?.addEventListener('input', function () {
        scr.trigger.initialDelay = Math.max(0, parseInt(this.value) || 0); saveSettings();
    });
    el.querySelector('#dynevt-scr-body')?.addEventListener('input', function () {
        scr.body = this.value; saveSettings();
    });
    el.querySelector('#dynevt-scr-btn-activated')?.addEventListener('change', function () {
        scr.buttonActivated = this.checked; saveSettings(); services.updateEventButtons();
    });

    // Wire condition
    const condContainer = el.querySelector('#dynevt-scr-condition .dynevt-condition');
    if (condContainer) wireConditionFields(condContainer, scr.condition, saveSettings, '');
}

/** Refresh just the script rows' name/status without tearing down the editor. */
function renderScriptListOnly(set) {
    const scr = (set.scripts || []).find(s => s.id === services.getSelectedScriptId());
    if (!scr) return;
    const row = document.querySelector(`.dynevt-script-row[data-id="${scr.id}"]`);
    if (!row) return;
    const nameEl = row.querySelector('.dynevt-event-name');
    const typeEl = row.querySelector('.dynevt-event-type');
    const timing = scr.trigger?.timing || ScriptTiming.AFTER_AI;
    if (nameEl) nameEl.textContent = scr.name;
    if (typeEl) typeEl.textContent = SCRIPT_TIMING_LABELS[timing] || timing;
}

// ═══════════════════════════════════════════════════════════════
// EVENT EDITOR (inside right panel)
// ═══════════════════════════════════════════════════════════════
