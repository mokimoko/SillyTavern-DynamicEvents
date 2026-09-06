export const DYNAMIC_EVENTS_EVENTS = Object.freeze({
    EVENT_FIRED: 'dynamicevents:event-fired',
    PHASE_CHANGED: 'dynamicevents:phase-changed',
    EVENT_SPENT: 'dynamicevents:event-spent',
    STATE_RESTORED: 'dynamicevents:state-restored',
    TRACK_CHANGED: 'dynamicevents:track-changed',
});

/** Publish lifecycle metadata only; consumers read state through the public API. */
export function emitDynamicEvent(eventName, detail) {
    if (typeof globalThis.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') return;
    globalThis.dispatchEvent(new CustomEvent(eventName, { detail }));
}
