/** Versioned, read-only contract for optional extension integrations. */

import { DYNAMIC_EVENTS_EVENTS } from './events.js';
import { isSetActive } from '../../eventEngine.js';
import {
    SubjectMode,
    listConditionProviders,
    listConditionSources,
    describeConditionSource,
    registerConditionProvider,
} from '../conditions/providers.js';
import { listActionHandlers, registerActionHandler } from '../actions/actionRuntime.js';

export const INTEGRATION_API_VERSION = 5;

function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function findEvent(settings, eventRef) {
    const needle = String(eventRef || '').trim().toLowerCase();
    if (!needle) return null;
    for (const set of (settings.eventSets || [])) {
        const event = (set.events || []).find(candidate => candidate.id === eventRef
            || String(candidate.name || '').toLowerCase() === needle);
        if (event) return { set, event };
    }
    return null;
}

export function createPublicIntegrationApi({ getSettings, resolveRuntimeState, getBindingContext }) {
    function listEvents() {
        const settings = getSettings();
        return clone((settings.eventSets || []).flatMap(set => (set.events || []).map(event => ({
            setId: set.id,
            setName: set.name,
            eventId: event.id,
            eventName: event.name,
            enabled: Boolean(event.enabled),
            category: event.category,
            scheduleType: event.schedule?.type ?? null,
        }))));
    }

    function getRuntimeState(options = {}) {
        const resolved = resolveRuntimeState(options);
        return clone({ apiVersion: INTEGRATION_API_VERSION, ...resolved });
    }

    function getEventState(eventRef, options = {}) {
        const found = findEvent(getSettings(), eventRef);
        if (!found) return null;
        const resolved = resolveRuntimeState(options);
        return clone({
            apiVersion: INTEGRATION_API_VERSION,
            setId: found.set.id,
            setName: found.set.name,
            eventId: found.event.id,
            eventName: found.event.name,
            scheduleType: found.event.schedule?.type ?? null,
            messageIndex: resolved.messageIndex,
            swipeId: resolved.swipeId,
            sourceMessageIndex: resolved.sourceMessageIndex,
            sourceSwipeId: resolved.sourceSwipeId,
            state: resolved.state?.eventStates?.[found.event.id] ?? null,
        });
    }

    function listStateTracks() {
        const settings = getSettings();
        return clone((settings.eventSets || []).flatMap(set => (set.stateTracks || []).map(track => ({
            setId: set.id,
            setName: set.name,
            trackId: track.id,
            trackName: track.name,
            enabled: Boolean(track.enabled),
            transitionMode: track.transitionMode,
            subject: track.subject,
            states: (track.states || []).map(state => ({
                stateId: state.id,
                stateName: state.name,
                enabled: state.enabled !== false,
            })),
        }))));
    }

    function listPromptRouters() {
        const settings = getSettings();
        return clone((settings.eventSets || []).flatMap(set => (set.promptRouters || []).map(router => ({
            setId: set.id,
            setName: set.name,
            routerId: router.id,
            routerName: router.name,
            enabled: Boolean(router.enabled),
            mode: router.mode,
            subject: router.subject,
            layers: (router.layers || []).map(layer => ({
                layerId: layer.id,
                layerName: layer.name,
                enabled: layer.enabled !== false,
                priority: Number(layer.priority) || 0,
            })),
        }))));
    }

    function getStateTrackState(trackRef, options = {}) {
        const needle = String(trackRef || '').trim().toLowerCase();
        let found = null;
        for (const set of (getSettings().eventSets || [])) {
            const track = (set.stateTracks || []).find(candidate => candidate.id === trackRef
                || String(candidate.name || '').toLowerCase() === needle);
            if (track) { found = { set, track }; break; }
        }
        if (!found) return null;
        const resolved = resolveRuntimeState(options);
        return clone({
            apiVersion: INTEGRATION_API_VERSION,
            setId: found.set.id,
            setName: found.set.name,
            trackId: found.track.id,
            trackName: found.track.name,
            messageIndex: resolved.messageIndex,
            swipeId: resolved.swipeId,
            state: resolved.state?.trackStates?.[found.track.id] ?? null,
        });
    }

    function getStateTrackContexts(options = {}) {
        const requestedSubject = String(options.subject || '').trim().toLowerCase();
        const settings = getSettings();
        if (settings.enabled === false) return [];
        const resolved = resolveRuntimeState(options);
        const binding = getBindingContext();
        const contexts = [];

        for (const set of (settings.eventSets || [])) {
            if (!isSetActive(set, binding)) continue;
            for (const track of (set.stateTracks || [])) {
                if (!track.enabled) continue;
                const runtime = resolved.state?.trackStates?.[track.id];
                const state = (track.states || []).find(candidate => candidate.id === runtime?.activeStateId);
                if (!state || state.enabled === false) continue;

                const subject = track.subject?.mode === SubjectMode.ACTIVE_CARD
                    ? String(binding.charName || '').trim()
                    : String(track.subject?.value || '').trim();
                if (requestedSubject && subject.toLowerCase() !== requestedSubject) continue;

                contexts.push({
                    setId: set.id,
                    setName: set.name,
                    trackId: track.id,
                    trackName: track.name,
                    stateId: state.id,
                    stateName: state.name,
                    subject,
                    text: String(state.text || '').replace(/\{\{subject\}\}/g, () => subject),
                    messageIndex: resolved.messageIndex,
                    swipeId: resolved.swipeId,
                });
            }
        }
        return clone(contexts);
    }

    const conditions = Object.freeze({
        registerProvider: registerConditionProvider,
        listProviders: listConditionProviders,
        listSources: listConditionSources,
        describeSource: describeConditionSource,
    });
    const actions = Object.freeze({
        registerHandler: registerActionHandler,
        listHandlers: listActionHandlers,
    });

    return Object.freeze({
        apiVersion: INTEGRATION_API_VERSION,
        events: DYNAMIC_EVENTS_EVENTS,
        conditions,
        actions,
        listEvents,
        listStateTracks,
        listPromptRouters,
        getRuntimeState,
        getEventState,
        getStateTrackState,
        getStateTrackContexts,
        getBindingContext: () => clone(getBindingContext()),
    });
}
