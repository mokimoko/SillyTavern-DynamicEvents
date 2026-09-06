import { getContext } from '../../../../../extensions.js';
import {
    BindMode,
    createEvent,
    createScript,
    getEventStatus,
    SetRole,
} from '../../eventEngine.js';
import { debug, getSettings, saveSettings } from '../config/settings.js';
import { activeSwipeId, cloneRuntimeState } from '../runtime/branchState.js';
import { getBindingContext } from '../runtime/bindingContext.js';
import { getChatState, saveChatState } from '../runtime/chatState.js';
import { clearAllInjections, primeInjections } from '../runtime/injectionManager.js';
import { createStateTrack, inspectStateTrack } from '../tracks/stateTracks.js';
import { createPromptRouter, inspectPromptRouter } from '../routers/promptRouters.js';
import { renderCharPicker, renderTagPicker, wireCharPicker, wireTagPicker } from './bindingEditor.js';
import { getComponentToggleState, getSetComponents, setAllComponentsEnabled } from './componentToggle.js';
import { renderEventEditor } from './eventEditor.js';
import {
    clearComponentSelection,
    getSelectedComponentIds,
    openEventEditor,
    setAllComponentsSelected,
    setComponentSelected,
    toggleEventEditor,
} from './componentSelection.js';
import { renderScriptEditor, renderScriptRow, wireScriptRows } from './scriptEditor.js';
import { renderStateTrackEditor, renderStateTrackRow, wireStateTrackEditor } from './stateTrackEditor.js';
import { renderPromptRouterEditor, renderPromptRouterRow, wirePromptRouterEditor } from './promptRouterEditor.js';

const escapeHtml = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export function createComponentPanel({
    state,
    confirm,
    renderSetList,
    updateDrawerStatus,
    updateEventButtons,
}) {
    function selectComponent(type, id) {
        openEventEditor(state, type === 'event' ? id : null);
        state.selectedScriptId = type === 'script' ? id : null;
        state.selectedTrackId = type === 'track' ? id : null;
        state.selectedRouterId = type === 'router' ? id : null;
    }

    function getRouterInspection(router, runtime = null) {
        try {
            const chat = runtime?.chat || getContext().chat || [];
            const messageIndex = runtime?.messageIndex ?? chat.length - 1;
            return inspectPromptRouter(
                router,
                runtime?.chatState ?? getChatState(),
                runtime?.bindingContext ?? getBindingContext(),
                {
                    messageIndex,
                    swipeId: runtime?.swipeId ?? activeSwipeId(chat[messageIndex]),
                },
            );
        } catch (error) {
            debug(`Prompt Router inspection failed: ${error?.message || error}`);
            return { activeLayerIds: [], subject: '', conditionResults: {} };
        }
    }

    function getTrackInspection(track, runtime = null) {
        try {
            const chat = runtime?.chat || getContext().chat || [];
            const messageIndex = runtime?.messageIndex ?? chat.length - 1;
            return inspectStateTrack(
                track,
                runtime?.chatState ?? getChatState(),
                runtime?.bindingContext ?? getBindingContext(),
                {
                messageIndex,
                    swipeId: runtime?.swipeId ?? activeSwipeId(chat[messageIndex]),
                },
            );
        } catch (error) {
            debug(`Track inspection failed: ${error?.message || error}`);
            return { activeStateId: null, subject: '', conditionResults: {} };
        }
    }

    function renderEventRow(event, chatState = getChatState()) {
        const status = chatState ? getEventStatus(event, chatState) : '';
        const categoryIcon = {
            plot: 'fa-book',
            flavor: 'fa-dice',
            world: 'fa-globe',
            custom: 'fa-bolt',
        }[event.category] || 'fa-bolt';

        const bulkSelected = getSelectedComponentIds(state).has(event.id);
        const editing = state.selectedEventId === event.id;
        return `
            <div class="dynevt-event-row ${bulkSelected ? 'bulk-selected' : ''} ${editing ? 'editing' : ''}" data-id="${escapeHtml(event.id)}" data-component-id="${escapeHtml(event.id)}" draggable="true" aria-selected="${bulkSelected}" ${editing ? 'aria-current="true"' : ''}>
                <i class="fa-solid fa-grip-vertical dynevt-drag-handle" title="Drag to reorder"></i>
                <label class="dynevt-event-select" onclick="event.stopPropagation()" title="Select this Event for bulk actions">
                    <input type="checkbox" ${bulkSelected ? 'checked' : ''} data-action="select-component" aria-label="Select ${escapeHtml(event.name)} for bulk actions" />
                </label>
                <label class="dynevt-event-enable-toggle" onclick="event.stopPropagation()" title="${event.enabled ? 'Disable' : 'Enable'} this Event">
                    <input type="checkbox" ${event.enabled ? 'checked' : ''} data-action="toggle-event" aria-label="${event.enabled ? 'Disable' : 'Enable'} ${escapeHtml(event.name)}" />
                    <span aria-hidden="true"></span>
                </label>
                <i class="fa-solid ${categoryIcon} dynevt-event-icon" title="${escapeHtml(event.category)}"></i>
                <span class="dynevt-event-name">${escapeHtml(event.name)}</span>
                <span class="dynevt-event-type">${escapeHtml(event.schedule?.type)}</span>
                <span class="dynevt-event-status">${escapeHtml(status)}</span>
                <button class="dynevt-btn-icon" data-action="reset-event" title="Reset state" onclick="event.stopPropagation()"><i class="fa-solid fa-rotate-left"></i></button>
                <button class="dynevt-btn-icon" data-action="delete-event" title="Delete" onclick="event.stopPropagation()"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
    }

    function resetEventRuntimeState(event, { rerender = true } = {}) {
        const chatState = cloneRuntimeState(getChatState());
        delete chatState.eventStates[event.id];
        if (chatState.pendingEventInjections) delete chatState.pendingEventInjections[event.id];
        saveChatState(chatState);
        clearAllInjections(getSettings());
        primeInjections();
        updateDrawerStatus();
        toastr.info(`Reset: ${event.name}`, 'Dynamic Events');
        if (rerender) renderRightPanel();
    }

    async function deleteEvents(set, eventIds, message) {
        const ids = new Set(eventIds);
        const events = set.events.filter(event => ids.has(event.id));
        if (!events.length || !await confirm(message)) return;

        // Clear while the definitions still exist so their extension-prompt
        // keys cannot survive deletion as ghost injections.
        clearAllInjections(getSettings());
        set.events = set.events.filter(event => !ids.has(event.id));
        const currentState = getChatState();
        if (currentState) {
            const chatState = cloneRuntimeState(currentState);
            for (const id of ids) {
                delete chatState.eventStates?.[id];
                delete chatState.pendingEventInjections?.[id];
            }
            saveChatState(chatState);
        }
        const selection = getSelectedComponentIds(state);
        for (const id of ids) selection.delete(id);
        if (ids.has(state.selectedEventId)) state.selectedEventId = null;
        saveSettings();
        primeInjections();
        renderRightPanel();
        renderSetList();
        updateDrawerStatus();
        updateEventButtons();
        toastr.success(`Deleted ${events.length} event${events.length === 1 ? '' : 's'}.`, 'Dynamic Events');
    }

    function wireEventRows(panel, set) {
        let dragSourceId = null;
        panel.querySelectorAll('.dynevt-event-row:not(.dynevt-script-row):not(.dynevt-track-row):not(.dynevt-router-row)').forEach(row => {
            const id = row.dataset.id;
            row.addEventListener('click', event => {
                if (event.target.closest('input, button, [data-action]')) return;
                toggleEventEditor(state, id);
                state.selectedScriptId = null;
                state.selectedTrackId = null;
                state.selectedRouterId = null;
                renderRightPanel();
            });

            row.querySelector('[data-action="toggle-event"]')?.addEventListener('change', function () {
                const event = set.events.find(item => item.id === id);
                if (!event) return;
                event.enabled = this.checked;
                saveSettings();
                clearAllInjections(getSettings());
                primeInjections();
                updateEventButtons();
            });

            row.querySelector('[data-action="delete-event"]')?.addEventListener('click', async () => {
                const event = set.events.find(item => item.id === id);
                if (!event) return;
                await deleteEvents(set, [id], `Delete event "${event.name}"?`);
            });

            row.querySelector('[data-action="reset-event"]')?.addEventListener('click', () => {
                const event = set.events.find(item => item.id === id);
                if (event) resetEventRuntimeState(event);
            });

            row.addEventListener('dragstart', event => {
                dragSourceId = id;
                row.classList.add('dynevt-dragging');
                event.dataTransfer.effectAllowed = 'move';
            });
            row.addEventListener('dragend', () => {
                dragSourceId = null;
                row.classList.remove('dynevt-dragging');
                panel.querySelectorAll('.dynevt-event-row').forEach(item => {
                    item.classList.remove('dynevt-drag-over-top', 'dynevt-drag-over-bottom');
                });
            });
            row.addEventListener('dragover', event => {
                if (!dragSourceId || dragSourceId === id) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                const midpoint = row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
                const above = event.clientY < midpoint;
                row.classList.toggle('dynevt-drag-over-top', above);
                row.classList.toggle('dynevt-drag-over-bottom', !above);
            });
            row.addEventListener('dragleave', () => {
                row.classList.remove('dynevt-drag-over-top', 'dynevt-drag-over-bottom');
            });
            row.addEventListener('drop', event => {
                event.preventDefault();
                if (!dragSourceId || dragSourceId === id) return;
                const fromIndex = set.events.findIndex(item => item.id === dragSourceId);
                let toIndex = set.events.findIndex(item => item.id === id);
                if (fromIndex < 0 || toIndex < 0) return;
                const rect = row.getBoundingClientRect();
                if (event.clientY >= rect.top + rect.height / 2) toIndex++;
                if (fromIndex < toIndex) toIndex--;
                const [moved] = set.events.splice(fromIndex, 1);
                set.events.splice(toIndex, 0, moved);
                saveSettings();
                renderRightPanel();
            });
        });
    }

    function wireComponentSelectionRows(panel) {
        panel.querySelectorAll('[data-action="select-component"]').forEach(checkbox => {
            checkbox.addEventListener('change', function () {
                const componentId = this.closest('[data-component-id]')?.dataset.componentId;
                setComponentSelected(state, componentId, this.checked);
                const eventsArea = panel.querySelector('.dynevt-events-area');
                renderRightPanel({
                    scrollSelection: false,
                    restoreEventsScrollTop: eventsArea?.scrollTop ?? null,
                });
            });
        });
    }

    function wireStateTrackRows(panel, set) {
        panel.querySelectorAll('[data-track-id]').forEach(row => {
            const trackId = row.dataset.trackId;
            row.addEventListener('click', event => {
                if (event.target.closest('input, button, [data-action]')) return;
                selectComponent('track', state.selectedTrackId === trackId ? null : trackId);
                renderRightPanel();
            });
            row.querySelector('[data-track-action="toggle"]')?.addEventListener('change', function () {
                const track = (set.stateTracks || []).find(item => item.id === trackId);
                if (!track) return;
                track.enabled = this.checked;
                saveSettings();
                clearAllInjections(getSettings());
                primeInjections();
                renderRightPanel();
            });
            row.querySelector('[data-track-action="reset"]')?.addEventListener('click', event => {
                event.stopPropagation();
                const track = (set.stateTracks || []).find(item => item.id === trackId);
                if (!track) return;
                const chatState = cloneRuntimeState(getChatState());
                chatState.trackStates ||= {};
                delete chatState.trackStates[track.id];
                saveChatState(chatState);
                clearAllInjections(getSettings());
                primeInjections();
                toastr.info(`Reset: ${track.name}`, 'Dynamic Events');
                renderRightPanel();
            });
            row.querySelector('[data-track-action="delete"]')?.addEventListener('click', async event => {
                event.stopPropagation();
                const track = (set.stateTracks || []).find(item => item.id === trackId);
                if (!track || !await confirm(`Delete state track "${track.name}" and all its states?`)) return;
                clearAllInjections(getSettings());
                set.stateTracks = set.stateTracks.filter(item => item.id !== trackId);
                if (state.selectedTrackId === trackId) state.selectedTrackId = null;
                saveSettings();
                primeInjections();
                renderRightPanel();
                renderSetList();
            });
        });
    }

    function wirePromptRouterRows(panel, set) {
        panel.querySelectorAll('[data-router-id]').forEach(row => {
            const routerId = row.dataset.routerId;
            row.addEventListener('click', event => {
                if (event.target.closest('input, button, [data-action]')) return;
                selectComponent('router', state.selectedRouterId === routerId ? null : routerId);
                renderRightPanel();
            });
            row.querySelector('[data-router-action="toggle"]')?.addEventListener('change', function () {
                const router = (set.promptRouters || []).find(item => item.id === routerId);
                if (!router) return;
                router.enabled = this.checked;
                saveSettings();
                clearAllInjections(getSettings());
                primeInjections();
                renderRightPanel();
            });
            row.querySelector('[data-router-action="delete"]')?.addEventListener('click', async event => {
                event.stopPropagation();
                const router = (set.promptRouters || []).find(item => item.id === routerId);
                if (!router || !await confirm(`Delete prompt router "${router.name}" and all its layers?`)) return;
                clearAllInjections(getSettings());
                set.promptRouters = set.promptRouters.filter(item => item.id !== routerId);
                if (state.selectedRouterId === routerId) state.selectedRouterId = null;
                saveSettings();
                primeInjections();
                renderRightPanel();
                renderSetList();
            });
        });
    }

    async function deleteSelectedComponents(set, selectedIds) {
        const eventIds = new Set(set.events.filter(item => selectedIds.has(item.id)).map(item => item.id));
        const trackIds = new Set((set.stateTracks || []).filter(item => selectedIds.has(item.id)).map(item => item.id));
        const routerIds = new Set((set.promptRouters || []).filter(item => selectedIds.has(item.id)).map(item => item.id));
        const scriptIds = new Set((set.scripts || []).filter(item => selectedIds.has(item.id)).map(item => item.id));
        const components = [
            ...set.events.filter(item => eventIds.has(item.id)).map(item => ({ ...item, type: 'Event' })),
            ...(set.stateTracks || []).filter(item => trackIds.has(item.id)).map(item => ({ ...item, type: 'State Track' })),
            ...(set.promptRouters || []).filter(item => routerIds.has(item.id)).map(item => ({ ...item, type: 'Prompt Router' })),
            ...(set.scripts || []).filter(item => scriptIds.has(item.id)).map(item => ({ ...item, type: 'Script' })),
        ];
        if (!components.length) return;

        const names = components.slice(0, 3).map(item => `“${item.name}”`).join(', ');
        const remainder = components.length > 3 ? ` and ${components.length - 3} more` : '';
        if (!await confirm(`Delete ${components.length} selected component${components.length === 1 ? '' : 's'} (${names}${remainder})?`)) return;

        clearAllInjections(getSettings());
        set.events = set.events.filter(item => !eventIds.has(item.id));
        set.stateTracks = (set.stateTracks || []).filter(item => !trackIds.has(item.id));
        set.promptRouters = (set.promptRouters || []).filter(item => !routerIds.has(item.id));
        set.scripts = (set.scripts || []).filter(item => !scriptIds.has(item.id));

        const currentState = getChatState();
        if (currentState) {
            const chatState = cloneRuntimeState(currentState);
            for (const id of eventIds) {
                delete chatState.eventStates?.[id];
                delete chatState.pendingEventInjections?.[id];
            }
            for (const id of trackIds) delete chatState.trackStates?.[id];
            saveChatState(chatState);
        }

        if (eventIds.has(state.selectedEventId)) state.selectedEventId = null;
        if (trackIds.has(state.selectedTrackId)) state.selectedTrackId = null;
        if (routerIds.has(state.selectedRouterId)) state.selectedRouterId = null;
        if (scriptIds.has(state.selectedScriptId)) state.selectedScriptId = null;
        clearComponentSelection(state);
        saveSettings();
        primeInjections();
        renderRightPanel();
        renderSetList();
        updateDrawerStatus();
        updateEventButtons();
        toastr.success(`Deleted ${components.length} component${components.length === 1 ? '' : 's'}.`, 'Dynamic Events');
    }

    function renderRightPanel({ scrollSelection = true, restoreEventsScrollTop = null } = {}) {
        const panel = document.getElementById('dynevt-panel-right');
        if (!panel) return;
        const settings = getSettings();
        const set = settings.eventSets.find(item => item.id === state.selectedSetId);
        if (!set) {
            panel.innerHTML = '<div class="dynevt-empty dynevt-empty-big">Select or create an event set.</div>';
            return;
        }
        // Branch resolution walks backward through chat history. Resolve it and
        // the binding context once per paint instead of once per component row.
        const renderChat = getContext().chat || [];
        const renderMessageIndex = renderChat.length - 1;
        const renderChatState = getChatState();
        const renderBindingContext = getBindingContext();
        const inspectionRuntime = {
            chat: renderChat,
            chatState: renderChatState,
            bindingContext: renderBindingContext,
            messageIndex: renderMessageIndex,
            swipeId: activeSwipeId(renderChat[renderMessageIndex]),
        };
        const trackInspections = new Map((set.stateTracks || []).map(track => [
            track.id,
            getTrackInspection(track, inspectionRuntime),
        ]));
        const routerInspections = new Map((set.promptRouters || []).map(router => [
            router.id,
            getRouterInspection(router, inspectionRuntime),
        ]));

        const componentIds = getSetComponents(set).map(component => component.id);
        const validComponentIds = new Set(componentIds);
        const selectedComponentIds = getSelectedComponentIds(state);
        for (const id of selectedComponentIds) {
            if (!validComponentIds.has(id)) selectedComponentIds.delete(id);
        }
        const eventIds = new Set(set.events.map(event => event.id));
        const trackIds = new Set((set.stateTracks || []).map(track => track.id));
        const routerIds = new Set((set.promptRouters || []).map(router => router.id));
        const scriptIds = new Set((set.scripts || []).map(script => script.id));
        if (state.selectedEventId && !eventIds.has(state.selectedEventId)) state.selectedEventId = null;
        if (state.selectedTrackId && !trackIds.has(state.selectedTrackId)) state.selectedTrackId = null;
        if (state.selectedRouterId && !routerIds.has(state.selectedRouterId)) state.selectedRouterId = null;
        if (state.selectedScriptId && !scriptIds.has(state.selectedScriptId)) state.selectedScriptId = null;
        const selectedComponentCount = selectedComponentIds.size;
        const allComponentsSelected = componentIds.length > 0 && selectedComponentCount === componentIds.length;
        const someComponentsSelected = selectedComponentCount > 0 && !allComponentsSelected;

        const primarySets = settings.eventSets.filter(item => item.id !== set.id && item.role !== SetRole.SECONDARY);
        const showParentPicker = set.role === SetRole.SECONDARY;
        const showCharPicker = set.bindMode === BindMode.CHARACTER;
        const showTagPicker = set.bindMode === BindMode.TAG;
        const showRow2 = showParentPicker || showCharPicker || showTagPicker;
        const hasComponents = set.events.length || (set.scripts || []).length || (set.stateTracks || []).length || (set.promptRouters || []).length;
        const componentToggleState = getComponentToggleState(set);
        const bulkToggleLabel = componentToggleState.allEnabled ? 'Disable all' : 'Enable all';
        const componentSelectionLabel = allComponentsSelected ? 'Deselect all components' : 'Select all components';

        panel.innerHTML = `
            <div class="dynevt-right-header">
                <div class="dynevt-right-header-fields">
                    <input type="text" class="dynevt-input" id="dynevt-set-name" value="${escapeHtml(set.name)}" placeholder="Set name" />
                    <select class="dynevt-select dynevt-select-sm" id="dynevt-set-role">
                        <option value="${SetRole.PRIMARY}" ${set.role === SetRole.PRIMARY ? 'selected' : ''}>Primary</option>
                        <option value="${SetRole.SECONDARY}" ${set.role === SetRole.SECONDARY ? 'selected' : ''}>Secondary</option>
                    </select>
                    <select class="dynevt-select" id="dynevt-set-bind-mode">
                        <option value="${BindMode.MANUAL}" ${set.bindMode === BindMode.MANUAL ? 'selected' : ''}>Manual</option>
                        <option value="${BindMode.CHARACTER}" ${set.bindMode === BindMode.CHARACTER ? 'selected' : ''}>Bind to Character</option>
                        <option value="${BindMode.TAG}" ${set.bindMode === BindMode.TAG ? 'selected' : ''}>Bind to Tag</option>
                    </select>
                </div>
                <div id="dynevt-set-row2" style="display:${showRow2 ? 'flex' : 'none'}; gap: 8px; align-items: center; margin-top: 8px;">
                    <div id="dynevt-parent-picker-wrap" style="display:${showParentPicker ? 'block' : 'none'}; min-width: 160px;">
                        <select class="dynevt-select" id="dynevt-set-parent">
                            <option value="">— Parent Set —</option>
                            ${primarySets.map(item => `<option value="${escapeHtml(item.id)}" ${set.parentSetId === item.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}
                        </select>
                    </div>
                    <div id="dynevt-char-picker-wrap" style="display:${showCharPicker ? 'block' : 'none'}; flex: 1; min-width: 0;">${renderCharPicker(set)}</div>
                    <div id="dynevt-tag-picker-wrap" style="display:${showTagPicker ? 'block' : 'none'}; flex: 1; min-width: 0;">${renderTagPicker(set)}</div>
                </div>
            </div>
            <div class="dynevt-events-header">
                <div class="dynevt-events-heading">
                    <span>Events, State Tracks, Prompt Routers &amp; Scripts</span>
                </div>
                <div class="dynevt-header-btns">
                    <button class="dynevt-toolbar-btn dynevt-select-all-components ${selectedComponentCount ? 'active' : ''} ${someComponentsSelected ? 'partial' : ''}" id="dynevt-select-all-components" title="${componentSelectionLabel}" aria-label="${componentSelectionLabel}" aria-pressed="${allComponentsSelected ? 'true' : someComponentsSelected ? 'mixed' : 'false'}" ${componentIds.length ? '' : 'disabled'}>
                        <i class="fa-solid ${allComponentsSelected ? 'fa-square-minus' : 'fa-list-check'}" aria-hidden="true"></i>
                    </button>
                    <button class="dynevt-toolbar-btn dynevt-enable-all-components ${componentToggleState.allEnabled ? 'active' : ''}" id="dynevt-toggle-all-components" title="${bulkToggleLabel} all components" aria-label="${bulkToggleLabel} all components" ${componentToggleState.total ? '' : 'disabled'}>
                        <i class="fa-solid ${componentToggleState.allEnabled ? 'fa-toggle-on' : 'fa-toggle-off'}" aria-hidden="true"></i>
                    </button>
                    ${selectedComponentCount > 0 ? `<button class="dynevt-toolbar-btn dynevt-toolbar-danger" id="dynevt-delete-selected-components" title="Delete ${selectedComponentCount} selected component${selectedComponentCount === 1 ? '' : 's'}" aria-label="Delete ${selectedComponentCount} selected component${selectedComponentCount === 1 ? '' : 's'}"><i class="fa-solid fa-trash" aria-hidden="true"></i><span class="dynevt-toolbar-count">${selectedComponentCount}</span></button>` : ''}
                    <span class="dynevt-toolbar-divider" aria-hidden="true"></span>
                    <button class="dynevt-toolbar-btn dynevt-btn-router" id="dynevt-add-router" title="Add Prompt Router" aria-label="Add Prompt Router"><span class="dynevt-add-glyph" aria-hidden="true"><i class="fa-solid fa-code-branch"></i><i class="fa-solid fa-plus dynevt-add-mark"></i></span></button>
                    <button class="dynevt-toolbar-btn dynevt-btn-track" id="dynevt-add-track" title="Add State Track" aria-label="Add State Track"><span class="dynevt-add-glyph" aria-hidden="true"><i class="fa-solid fa-layer-group"></i><i class="fa-solid fa-plus dynevt-add-mark"></i></span></button>
                    <button class="dynevt-toolbar-btn dynevt-btn-script" id="dynevt-add-script" title="Add Script" aria-label="Add Script"><span class="dynevt-add-glyph" aria-hidden="true"><i class="fa-solid fa-terminal"></i><i class="fa-solid fa-plus dynevt-add-mark"></i></span></button>
                    <button class="dynevt-toolbar-btn dynevt-btn-accent" id="dynevt-add-event" title="Add Event" aria-label="Add Event"><span class="dynevt-add-glyph" aria-hidden="true"><i class="fa-solid fa-bolt"></i><i class="fa-solid fa-plus dynevt-add-mark"></i></span></button>
                </div>
            </div>
            <div class="dynevt-events-area">
                <div class="dynevt-event-list" id="dynevt-item-list">
                    ${!hasComponents ? '<div class="dynevt-empty">No events, state tracks, prompt routers, or scripts in this set.</div>' :
                        set.events.map(event => renderEventRow(event, renderChatState) + (event.id === state.selectedEventId ? '<div id="dynevt-event-editor"></div>' : '')).join('') +
                        (set.stateTracks || []).map(track => renderStateTrackRow(track, trackInspections.get(track.id), {
                            bulkSelected: selectedComponentIds.has(track.id),
                            editing: track.id === state.selectedTrackId,
                        }) + (track.id === state.selectedTrackId ? '<div id="dynevt-track-editor"></div>' : '')).join('') +
                        (set.promptRouters || []).map(router => renderPromptRouterRow(router, routerInspections.get(router.id), {
                            bulkSelected: selectedComponentIds.has(router.id),
                            editing: router.id === state.selectedRouterId,
                        }) + (router.id === state.selectedRouterId ? '<div id="dynevt-router-editor"></div>' : '')).join('') +
                        (set.scripts || []).map(script => renderScriptRow(script, {
                            bulkSelected: selectedComponentIds.has(script.id),
                            editing: script.id === state.selectedScriptId,
                            chatState: renderChatState,
                        }) + (script.id === state.selectedScriptId ? '<div id="dynevt-script-editor"></div>' : '')).join('')}
                </div>
            </div>
        `;

        panel.querySelector('#dynevt-set-name')?.addEventListener('input', function () {
            set.name = this.value;
            saveSettings();
            renderSetList();
        });
        const updateRow2Visibility = () => {
            const show = set.role === SetRole.SECONDARY || set.bindMode === BindMode.CHARACTER || set.bindMode === BindMode.TAG;
            const row = panel.querySelector('#dynevt-set-row2');
            if (row) row.style.display = show ? 'flex' : 'none';
        };
        panel.querySelector('#dynevt-set-role')?.addEventListener('change', function () {
            set.role = this.value;
            const wrap = panel.querySelector('#dynevt-parent-picker-wrap');
            if (wrap) wrap.style.display = set.role === SetRole.SECONDARY ? 'block' : 'none';
            if (set.role !== SetRole.SECONDARY) set.parentSetId = null;
            updateRow2Visibility();
            saveSettings();
            renderSetList();
        });
        panel.querySelector('#dynevt-set-parent')?.addEventListener('change', function () {
            set.parentSetId = this.value || null;
            saveSettings();
            renderSetList();
        });
        panel.querySelector('#dynevt-set-bind-mode')?.addEventListener('change', function () {
            set.bindMode = this.value;
            const charWrap = panel.querySelector('#dynevt-char-picker-wrap');
            const tagWrap = panel.querySelector('#dynevt-tag-picker-wrap');
            if (charWrap) charWrap.style.display = this.value === BindMode.CHARACTER ? 'block' : 'none';
            if (tagWrap) tagWrap.style.display = this.value === BindMode.TAG ? 'block' : 'none';
            updateRow2Visibility();
            saveSettings();
            renderSetList();
        });

        const bindingsChanged = () => {
            saveSettings();
            renderSetList();
        };
        wireCharPicker(panel, set, bindingsChanged);
        wireTagPicker(panel, set, bindingsChanged);

        const bulkToggle = panel.querySelector('#dynevt-toggle-all-components');
        if (bulkToggle) {
            bulkToggle.addEventListener('click', function () {
                if (!setAllComponentsEnabled(set, !componentToggleState.allEnabled)) return;
                const eventsArea = panel.querySelector('.dynevt-events-area');
                saveSettings();
                clearAllInjections(getSettings());
                primeInjections();
                renderRightPanel({
                    scrollSelection: false,
                    restoreEventsScrollTop: eventsArea?.scrollTop ?? null,
                });
                renderSetList();
                updateDrawerStatus();
                updateEventButtons();
            });
        }

        const componentSelectionToggle = panel.querySelector('#dynevt-select-all-components');
        if (componentSelectionToggle) {
            componentSelectionToggle.addEventListener('click', function () {
                setAllComponentsSelected(state, componentIds, !allComponentsSelected);
                const eventsArea = panel.querySelector('.dynevt-events-area');
                renderRightPanel({
                    scrollSelection: false,
                    restoreEventsScrollTop: eventsArea?.scrollTop ?? null,
                });
            });
        }

        panel.querySelector('#dynevt-delete-selected-components')?.addEventListener('click', async () => {
            await deleteSelectedComponents(set, selectedComponentIds);
        });

        panel.querySelector('#dynevt-add-event')?.addEventListener('click', () => {
            const event = createEvent();
            set.events.push(event);
            saveSettings();
            selectComponent('event', event.id);
            renderRightPanel();
        });
        panel.querySelector('#dynevt-add-script')?.addEventListener('click', () => {
            const script = createScript();
            set.scripts ||= [];
            set.scripts.push(script);
            saveSettings();
            selectComponent('script', script.id);
            renderRightPanel();
            updateEventButtons();
        });
        panel.querySelector('#dynevt-add-track')?.addEventListener('click', () => {
            const track = createStateTrack();
            set.stateTracks ||= [];
            set.stateTracks.push(track);
            saveSettings();
            selectComponent('track', track.id);
            renderRightPanel();
        });
        panel.querySelector('#dynevt-add-router')?.addEventListener('click', () => {
            const router = createPromptRouter();
            set.promptRouters ||= [];
            set.promptRouters.push(router);
            saveSettings();
            selectComponent('router', router.id);
            renderRightPanel();
        });

        wireComponentSelectionRows(panel);
        wireEventRows(panel, set);
        wireScriptRows(panel, set);
        wireStateTrackRows(panel, set);
        wirePromptRouterRows(panel, set);

        if (state.selectedEventId) {
            renderEventEditor(set);
            const editor = document.getElementById('dynevt-event-editor');
            if (scrollSelection && editor) editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        if (state.selectedScriptId) {
            renderScriptEditor(set);
            const editor = document.getElementById('dynevt-script-editor');
            if (scrollSelection && editor) editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        if (state.selectedTrackId) {
            const track = (set.stateTracks || []).find(item => item.id === state.selectedTrackId);
            const editor = document.getElementById('dynevt-track-editor');
            if (track && editor) {
                editor.innerHTML = renderStateTrackEditor(track, trackInspections.get(track.id));
                wireStateTrackEditor(editor, track, {
                    changed: (rerender = false) => {
                        saveSettings();
                        clearAllInjections(getSettings());
                        primeInjections();
                        if (rerender) {
                            const eventsArea = panel.querySelector('.dynevt-events-area');
                            renderRightPanel({
                                scrollSelection: false,
                                restoreEventsScrollTop: eventsArea?.scrollTop ?? null,
                            });
                        } else renderSetList();
                    },
                    confirmDelete: message => confirm(message),
                });
                if (scrollSelection) editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
        if (state.selectedRouterId) {
            const router = (set.promptRouters || []).find(item => item.id === state.selectedRouterId);
            const editor = document.getElementById('dynevt-router-editor');
            if (router && editor) {
                editor.innerHTML = renderPromptRouterEditor(router, routerInspections.get(router.id));
                wirePromptRouterEditor(editor, router, {
                    changed: (rerender = false) => {
                        saveSettings();
                        clearAllInjections(getSettings());
                        primeInjections();
                        if (rerender) {
                            const eventsArea = panel.querySelector('.dynevt-events-area');
                            renderRightPanel({
                                scrollSelection: false,
                                restoreEventsScrollTop: eventsArea?.scrollTop ?? null,
                            });
                        } else renderSetList();
                    },
                    confirmDelete: message => confirm(message),
                });
                if (scrollSelection) editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }

        if (Number.isFinite(restoreEventsScrollTop)) {
            const eventsArea = panel.querySelector('.dynevt-events-area');
            if (eventsArea) {
                eventsArea.scrollTop = restoreEventsScrollTop;
                requestAnimationFrame(() => {
                    if (eventsArea.isConnected) eventsArea.scrollTop = restoreEventsScrollTop;
                });
            }
        }
    }

    return { renderRightPanel, selectComponent };
}
