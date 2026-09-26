/** Add an outcome contract when a Dynamic Event is driven by a Calendar record. */

function calendarEvent(event) {
    return event?.subject?.providerId === 'superagents-calendar'
        && event?.resolvedSubjectState?.commitmentId
        && ['missed', 'cancelled'].includes(event.resolvedSubjectState.status);
}

export function buildCalendarReconciliationCue(event, grantToken) {
    const commitmentId = String(event?.resolvedSubjectState?.commitmentId || '').trim();
    const grant = String(grantToken || '').trim();
    if (!commitmentId || !grant) return '';
    const target = JSON.stringify(commitmentId);
    const authorization = JSON.stringify(grant);
    const surfaceLabel = String(
        globalThis.SuperAgents?.integration?.presentation?.getSurface?.('calendar')?.title || 'Calendar',
    );
    return [
        '<calendar_story_reconciliation>',
        `If this response explicitly establishes a concrete replacement plan for this commitment—through agreement, an authorized rescheduling, or another canonical act—append one hidden directive after the prose so ${surfaceLabel} can retain it:`,
        `<!--SA-CALENDAR:{"action":"reschedule","commitmentId":${target},"grant":${authorization},"title":"optional replacement title","time":{"kind":"relative","amount":2,"unit":"days","relation":"after","anchorLabel":"now","label":"two days from now"},"notes":"optional established context"}-->`,
        'Use the fitting time shape: exact(calendarId/date/clock/label), relative(amount/unit/relation/anchorLabel), window(startLabel/endLabel), recurring(rule/nextLabel), anchor(relation/anchorLabel), or unscheduled(trigger).',
        'Do not emit the directive for a suggestion, unresolved negotiation, vague intention, or unchanged plan. Never translate a fictional or non-Gregorian date into Gregorian. The original missed or cancelled record remains historical; this creates a linked successor rather than rewriting what happened.',
        '</calendar_story_reconciliation>',
    ].join('\n');
}

export function appendCalendarReconciliationCues(fired, texts, chatState, calendarApi, location = {}) {
    if (!calendarApi || calendarApi.apiVersion < 2 || typeof calendarApi.authorizeReconciliation !== 'function'
        || calendarApi.canReconcileStory?.() === false) return 0;
    let changed = 0;
    for (const event of fired || []) {
        if (!calendarEvent(event)) continue;
        const payload = texts?.get?.(event.id);
        if (!payload?.text) continue;
        const grant = calendarApi.authorizeReconciliation(
            event.resolvedSubjectState.commitmentId,
            { ...location, source: `dynamic-event:${event.id}` },
        );
        const cue = buildCalendarReconciliationCue(event, grant?.token);
        if (!cue) continue;
        payload.text = `${payload.text}\n${cue}`;
        if (payload.baseText !== undefined) payload.baseText = `${payload.baseText}\n${cue}`;
        const pending = chatState?.pendingEventInjections?.[event.id];
        if (pending) {
            pending.text = payload.text;
            if (pending.baseText !== undefined) pending.baseText = payload.baseText;
        }
        changed++;
    }
    return changed;
}
