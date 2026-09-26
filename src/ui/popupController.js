import { getSettings, saveSettings } from '../config/settings.js';
import { configureEventEditor } from './eventEditor.js';
import { configurePresetTools, exportAllSets, importSets, showPresetPicker } from './presetTools.js';
import { configureScriptEditor } from './scriptEditor.js';
import { createComponentPanel } from './componentPanel.js';
import { dynevtConfirm } from './confirmDialog.js';
import { createSetPanel, getGroupedSets } from './setPanel.js';
import { makeModalDraggable } from './draggableModal.js';

const MODAL_ID = 'dynevt-modal';
const OVERLAY_ID = 'dynevt-overlay';

export function createPopupController({ updateDrawerStatus, updateEventButtons }) {
    const state = {
        isOpen: false,
        selectedSetId: null,
        selectedEventId: null,
        selectedComponentIds: new Set(),
        selectedScriptId: null,
        selectedTrackId: null,
        selectedRouterId: null,
        expandedPrimarySetIds: new Set(),
        collapsedPhases: new Set(),
    };

    let componentPanel;
    let draggableModal;
    const setPanel = createSetPanel({
        state,
        confirm: dynevtConfirm,
        renderRightPanel: (...args) => componentPanel.renderRightPanel(...args),
        updateEventButtons,
    });
    componentPanel = createComponentPanel({
        state,
        confirm: dynevtConfirm,
        renderSetList: setPanel.renderSetList,
        updateDrawerStatus,
        updateEventButtons,
    });

    configureEventEditor({
        getSelectedEventId: () => state.selectedEventId,
        collapsedPhases: state.collapsedPhases,
        updateEventButtons,
        confirm: dynevtConfirm,
    });
    configureScriptEditor({
        getSelectedScriptId: () => state.selectedScriptId,
        selectScript: id => componentPanel.selectComponent('script', id),
        renderRightPanel: componentPanel.renderRightPanel,
        updateEventButtons,
        confirm: dynevtConfirm,
    });
    configurePresetTools({
        getGroupedSets,
        getSelectedSetId: () => state.selectedSetId,
        selectSet: setPanel.selectSet,
        refreshAll: () => {
            setPanel.renderSetList();
            componentPanel.renderRightPanel();
            updateDrawerStatus();
            updateEventButtons();
        },
        refreshPanels: () => {
            setPanel.renderSetList();
            componentPanel.renderRightPanel();
        },
    });

    function closePopup() {
        if (!state.isOpen) return;
        document.getElementById(OVERLAY_ID)?.classList.remove('dynevt-visible');
        document.getElementById(MODAL_ID)?.classList.remove('dynevt-visible');
        state.isOpen = false;
        updateDrawerStatus();
        updateEventButtons();
    }

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
                <div class="dynevt-modal-title"><i class="fa-solid fa-bolt"></i> Dynamic Events</div>
                <div class="dynevt-modal-header-controls">
                    <label class="dynevt-header-toggle" title="Max concurrent events per message">
                        <span>Max:</span>
                        <input type="number" id="dynevt-max-concurrent" class="dynevt-input dynevt-input-xs" value="2" min="1" max="10" />
                    </label>
                    <label class="dynevt-header-toggle" title="Log to console">
                        <input type="checkbox" id="dynevt-debug" />
                        <span>Debug</span>
                    </label>
                    <button id="dynevt-export" class="dynevt-btn" title="Export all sets"><i class="fa-solid fa-file-export"></i> Export</button>
                    <button id="dynevt-import-btn" class="dynevt-btn" title="Import sets"><i class="fa-solid fa-file-import"></i> Import</button>
                    <button id="dynevt-presets" class="dynevt-btn dynevt-btn-accent" title="Install an event preset"><i class="fa-solid fa-layer-group"></i> Presets</button>
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

        draggableModal = makeModalDraggable(modal, modal.querySelector('.dynevt-modal-header'), {
            prefix: 'dynevt-modal',
            visibleClass: 'dynevt-visible',
            ignoreSelector: '.dynevt-modal-close',
        });

        modal.querySelector('#dynevt-close').addEventListener('click', closePopup);
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && state.isOpen) closePopup();
        });
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
        $('#dynevt-presets').on('click', showPresetPicker);
    }

    function openPopup() {
        if (state.isOpen) return;
        state.isOpen = true;
        state.selectedSetId ||= getSettings().eventSets[0]?.id || null;
        ensurePopupDOM();

        const settings = getSettings();
        $('#dynevt-max-concurrent').val(settings.maxConcurrentEvents);
        $('#dynevt-debug').prop('checked', settings.debugLog);
        setPanel.renderSetList();
        componentPanel.renderRightPanel();

        requestAnimationFrame(() => {
            document.getElementById(OVERLAY_ID)?.classList.add('dynevt-visible');
            document.getElementById(MODAL_ID)?.classList.add('dynevt-visible');
            requestAnimationFrame(() => draggableModal?.clamp());
        });
    }

    return {
        closePopup,
        isOpen: () => state.isOpen,
        openPopup,
        renderRightPanel: componentPanel.renderRightPanel,
    };
}
