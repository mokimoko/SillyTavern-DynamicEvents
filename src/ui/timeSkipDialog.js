/** Private time-skip planner with a neutral transition and native reply generation. */

const OPTIONS = Object.freeze([
    { value: 'later tonight', label: 'Later tonight' },
    { value: 'the next morning', label: 'Next morning' },
    { value: 'three days later', label: 'Three days later' },
]);

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function activeWorldState() {
    try {
        const api = globalThis.SuperAgents?.integration;
        const source = api?.listStateSources?.().find(item => item.variableName === 'sa_world_state');
        if (!source) return { active: false, paused: false, value: null };
        if (source.enabled === false || source.paused === true) {
            return { active: false, paused: source.paused === true, value: null };
        }
        const resolved = api.getState?.('sa_world_state');
        return { active: true, paused: false, value: resolved?.found ? resolved.value : null };
    } catch {
        return { active: false, paused: false, value: null };
    }
}

export function buildTimeSkipMessage(destination, context = '', useWorldState = false) {
    const when = String(destination ?? '').trim();
    if (!when) return '';
    const details = String(context ?? '').trim();
    return [
        `Time skip to ${when}.`,
        details ? `During the skipped time: ${details}.` : '',
        'Open the next scene there. Keep established commitments and character circumstances coherent without inventing actions for my character during the gap.',
        useWorldState ? 'Keep World State’s clock aligned with the new scene.' : '',
    ].filter(Boolean).join(' ');
}

export async function openTimeSkipDialog() {
    const planner = await import('../runtime/timeSkipPlanner.js');
    document.getElementById('dynevt-time-skip-overlay')?.remove();
    const worldState = activeWorldState();
    const known = [
        ['Date', worldState.value?.date],
        ['Time', worldState.value?.time],
        ['Time of day', worldState.value?.timeOfDay],
    ].filter(([, item]) => item && String(item).toLowerCase() !== 'unknown');
    const worldBaseline = known.map(([label, item]) => `${label}: ${item}`).join('; ');
    const worldStatus = worldState.active
        ? known.length ? `World State now: ${worldBaseline}` : 'World State is active; its current date or time is unknown.'
        : worldState.paused
            ? 'World State is paused; its clock will update after it resumes.'
            : 'World State is unavailable; the story can still skip ahead.';
    const roster = planner.getTimeSkipRoster();
    if (!roster.responders.length) {
        toastr.warning('Open a character or group chat before using Time Skip.', 'Dynamic Events');
        return false;
    }

    const overlay = document.createElement('div');
    overlay.id = 'dynevt-time-skip-overlay';
    overlay.className = 'dynevt-confirm-overlay';
    overlay.innerHTML = `<div class="dynevt-confirm-box dynevt-time-skip-box" role="dialog" aria-modal="true" aria-labelledby="dynevt-time-skip-title">
        <div class="dynevt-time-skip-heading">
            <div><div class="dynevt-confirm-msg" id="dynevt-time-skip-title">Time Skip</div><p>Plan a narrator transition, preview it, then begin a normal character reply.</p></div>
            <button type="button" class="dynevt-btn-icon" data-time-skip-close aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="dynevt-time-skip-world">${escapeHtml(worldStatus)}</div>
        <form class="dynevt-time-skip-setup">
            <fieldset class="dynevt-time-skip-choices"><legend>Resume the story</legend>
                ${OPTIONS.map((option, index) => `<label><input type="radio" name="destination" value="${option.value}" ${index === 1 ? 'checked' : ''}><span>${option.label}</span></label>`).join('')}
                <label><input type="radio" name="destination" value="custom"><span>Custom</span></label>
            </fieldset>
            <label class="dynevt-field dynevt-time-skip-custom hidden"><span>When should the next scene begin?</span><input class="dynevt-input" name="customDestination" maxlength="160" placeholder="Two weeks later, at dusk" /></label>
            <label class="dynevt-field"><span>What happened during the gap? <small>Optional</small></span><textarea class="dynevt-textarea" name="context" rows="2" maxlength="600" placeholder="Only details you've decided, such as travel or rest"></textarea></label>
            <div class="dynevt-confirm-buttons"><button type="button" class="dynevt-btn" data-time-skip-close>Cancel</button><button type="submit" class="dynevt-btn dynevt-btn-accent">Plan Time Skip</button></div>
        </form>
        <section class="dynevt-time-skip-preview hidden" aria-live="polite">
            <label class="dynevt-field"><span>Narrator transition</span><textarea class="dynevt-textarea" data-time-skip-transition rows="5" maxlength="2000"></textarea></label>
            <div class="dynevt-time-skip-meta">
                <label class="dynevt-field"><span>Post transition as</span><input class="dynevt-input" data-time-skip-narrator maxlength="80" value="Narrator" /></label>
                <label class="dynevt-field"><span>Who responds?</span><select class="dynevt-select" data-time-skip-responder>${roster.responders.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}</select></label>
            </div>
            <p class="dynevt-time-skip-hint">The responder will be generated normally, so the reply can be swiped or regenerated.</p>
            <div class="dynevt-confirm-buttons"><button type="button" class="dynevt-btn" data-time-skip-back>Back</button><button type="button" class="dynevt-btn" data-time-skip-regenerate>Regenerate</button><button type="button" class="dynevt-btn dynevt-btn-accent" data-time-skip-accept>Start Next Scene</button></div>
        </section>
    </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('dynevt-visible'));

    return new Promise(resolve => {
        let disposed = false;
        let request = '';
        const setup = overlay.querySelector('.dynevt-time-skip-setup');
        const preview = overlay.querySelector('.dynevt-time-skip-preview');
        const customField = setup.querySelector('.dynevt-time-skip-custom');
        const customInput = setup.querySelector('[name="customDestination"]');
        const contextInput = setup.querySelector('[name="context"]');
        const transitionInput = preview.querySelector('[data-time-skip-transition]');
        const narratorInput = preview.querySelector('[data-time-skip-narrator]');
        const responderInput = preview.querySelector('[data-time-skip-responder]');
        const finish = completed => {
            if (disposed) return;
            disposed = true;
            document.removeEventListener('keydown', onKeyDown);
            overlay.remove();
            resolve(completed);
        };
        const onKeyDown = event => {
            if (event.key === 'Escape') finish(false);
        };
        const setBusy = busy => {
            overlay.querySelectorAll('button, input, textarea, select').forEach(element => { element.disabled = busy; });
            overlay.classList.toggle('dynevt-time-skip-busy', busy);
        };
        const selectedRequest = () => {
            const selected = setup.querySelector('input[name="destination"]:checked')?.value;
            const destination = selected === 'custom' ? customInput.value.trim() : selected;
            if (!destination) {
                toastr.warning('Enter a time for the next scene.', 'Dynamic Events');
                customInput.focus();
                return '';
            }
            return buildTimeSkipMessage(destination, contextInput.value, worldState.active);
        };
        const generatePlan = async () => {
            if (!request) request = selectedRequest();
            if (!request) return;
            setBusy(true);
            try {
                const plan = await planner.planTimeSkip({ request, worldBaseline });
                if (disposed) return;
                transitionInput.value = plan.transition;
                responderInput.value = plan.responder;
                setup.classList.add('hidden');
                preview.classList.remove('hidden');
                transitionInput.focus();
            } catch (error) {
                console.error('[DynEvents] Time Skip planning failed:', error);
                toastr.error(error?.message || 'Could not plan the time skip.', 'Dynamic Events');
            } finally {
                if (!disposed) setBusy(false);
            }
        };

        document.addEventListener('keydown', onKeyDown);
        overlay.addEventListener('click', event => {
            if (event.target === overlay || event.target.closest('[data-time-skip-close]')) finish(false);
        });
        setup.addEventListener('change', event => {
            if (event.target.name !== 'destination') return;
            const custom = event.target.value === 'custom';
            customField.classList.toggle('hidden', !custom);
            if (custom) customInput.focus();
        });
        setup.addEventListener('submit', event => {
            event.preventDefault();
            request = selectedRequest();
            generatePlan();
        });
        preview.querySelector('[data-time-skip-back]').addEventListener('click', () => {
            preview.classList.add('hidden');
            setup.classList.remove('hidden');
            request = '';
        });
        preview.querySelector('[data-time-skip-regenerate]').addEventListener('click', generatePlan);
        preview.querySelector('[data-time-skip-accept]').addEventListener('click', async () => {
            const transition = transitionInput.value.trim();
            const narratorName = narratorInput.value.trim();
            if (!transition) {
                toastr.warning('The narrator transition cannot be empty.', 'Dynamic Events');
                transitionInput.focus();
                return;
            }
            if (!narratorName) {
                toastr.warning('Enter a name for the narrator message.', 'Dynamic Events');
                narratorInput.focus();
                return;
            }
            setBusy(true);
            let transitionAdded = false;
            try {
                await planner.insertTimeSkipTransition(transition, narratorName);
                transitionAdded = true;
                finish(true);
                await new Promise(release => setTimeout(release, 0));
                await planner.triggerTimeSkipReply(responderInput.value, roster.isGroup);
            } catch (error) {
                console.error('[DynEvents] Time Skip failed:', error);
                toastr.error(transitionAdded
                    ? 'The transition was added, but the next reply could not be started.'
                    : 'The time skip could not be added.', 'Dynamic Events');
                if (!transitionAdded) finish(false);
            }
        });
        setup.querySelector('input[name="destination"]:checked')?.focus();
    });
}
