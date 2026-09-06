import { getContext } from '../../../../../extensions.js';
import { isSetActive, ScriptTiming } from '../../eventEngine.js';
import { getSettings, saveSettings } from '../config/settings.js';
import { getBindingContext } from '../runtime/bindingContext.js';
import { clearAllInjections, primeInjections } from '../runtime/injectionManager.js';
import { forceFireEvent } from '../runtime/manualOperations.js';
import { runManualScript } from '../runtime/scriptRunner.js';

export function createChatUi({
    openPopup,
    renderExtensionTemplateAsync,
    templateNamespace,
}) {
    async function loadDrawerUI() {
        const html = await renderExtensionTemplateAsync(templateNamespace, 'settings');
        const left = document.getElementById('extensions_settings');
        const right = document.getElementById('extensions_settings2');
        const target = left && right
            ? (right.children.length > left.children.length ? left : right)
            : (left || right);
        if (!target) return;
        $(target).append(html);

        $('#dynevt-enabled').on('change', function () {
            getSettings().enabled = this.checked;
            saveSettings();
            if (this.checked) primeInjections();
            else clearAllInjections(getSettings());
            updateDrawerStatus();
            updateEventButtons();
        }).prop('checked', getSettings().enabled);

        $('#dynevt-open-popup').on('click', openPopup);
        updateDrawerStatus();
    }

    function updateDrawerStatus() {
        const settings = getSettings();
        const bindingContext = getBindingContext();
        const activeSets = settings.eventSets.filter(set => isSetActive(set, bindingContext));
        const totalEvents = activeSets.reduce(
            (count, set) => count + set.events.filter(event => event.enabled).length,
            0,
        );
        const totalContinuousPrompts = activeSets.reduce(
            (count, set) => count
                + (set.stateTracks || []).filter(track => track.enabled).length
                + (set.promptRouters || []).filter(router => router.enabled).length,
            0,
        );
        const messageCount = getContext().chat?.length || 0;
        $('#dynevt-drawer-status').text(
            settings.enabled
                ? `${activeSets.length} set(s), ${totalEvents} event(s), ${totalContinuousPrompts} continuous prompt(s) — msg #${messageCount}`
                : 'Disabled',
        );
    }

    function getEventButtonBar() {
        let bar = document.getElementById('dynevt-btn-bar');
        if (bar?.isConnected) return bar;
        bar = document.createElement('div');
        bar.id = 'dynevt-btn-bar';
        bar.className = 'dynevt-btn-bar';
        const qr = document.getElementById('qr--bar') || document.getElementById('qr-bar');
        const sendForm = document.getElementById('send_form');
        if (qr?.parentElement) qr.parentElement.insertBefore(bar, qr);
        else if (sendForm?.parentElement) sendForm.parentElement.insertBefore(bar, sendForm);
        else document.body.appendChild(bar);
        return bar;
    }

    function updateEventButtons() {
        const bar = getEventButtonBar();
        if (!bar) return;
        const settings = getSettings();
        const bindingContext = getBindingContext();
        const events = [];
        const scripts = [];

        if (settings.enabled) {
            for (const set of settings.eventSets) {
                if (!isSetActive(set, bindingContext)) continue;
                for (const event of set.events) {
                    if (event.enabled && event.buttonActivated) events.push(event);
                }
                for (const script of set.scripts || []) {
                    const manual = script.buttonActivated || script.trigger?.timing === ScriptTiming.MANUAL;
                    if (script.enabled && manual) scripts.push(script);
                }
            }
        }

        bar.innerHTML = '';
        if (!events.length && !scripts.length) {
            bar.style.display = 'none';
            return;
        }
        bar.style.display = '';

        for (const event of events) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'menu_button dynevt-fire-btn interactable';
            button.textContent = event.name;
            button.title = `Fire event: ${event.name}`;
            button.dataset.eventId = event.id;
            button.addEventListener('click', () => {
                toastr.info(forceFireEvent(event.name), 'Dynamic Events');
            });
            bar.appendChild(button);
        }

        for (const script of scripts) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'menu_button dynevt-fire-btn dynevt-script-btn interactable';
            button.textContent = script.name;
            button.title = `Run script: ${script.name}`;
            button.dataset.scriptId = script.id;
            button.addEventListener('click', () => runManualScript(script, { showSuccessToast: false }));
            bar.appendChild(button);
        }
    }

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

    return {
        addWandMenuItem,
        loadDrawerUI,
        updateDrawerStatus,
        updateEventButtons,
    };
}
