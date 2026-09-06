function selectedIds(state) {
    if (!(state.selectedComponentIds instanceof Set)) state.selectedComponentIds = new Set();
    return state.selectedComponentIds;
}

export function getSelectedComponentIds(state) {
    return selectedIds(state);
}

export function clearComponentSelection(state) {
    selectedIds(state).clear();
}

export function setComponentSelected(state, componentId, selected) {
    if (!componentId) return;
    if (selected) selectedIds(state).add(componentId);
    else selectedIds(state).delete(componentId);
}

export function setAllComponentsSelected(state, componentIds, selected) {
    const selection = selectedIds(state);
    selection.clear();
    if (!selected) return;
    for (const componentId of componentIds || []) {
        if (componentId) selection.add(componentId);
    }
}

export function openEventEditor(state, eventId) {
    state.selectedEventId = eventId || null;
}

export function toggleEventEditor(state, eventId) {
    state.selectedEventId = state.selectedEventId === eventId ? null : (eventId || null);
}
