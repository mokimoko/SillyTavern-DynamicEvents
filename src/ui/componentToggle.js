export function getSetComponents(set = {}) {
    return [
        ...(Array.isArray(set.events) ? set.events : []),
        ...(Array.isArray(set.stateTracks) ? set.stateTracks : []),
        ...(Array.isArray(set.promptRouters) ? set.promptRouters : []),
        ...(Array.isArray(set.scripts) ? set.scripts : []),
    ];
}

export function getComponentToggleState(set) {
    const components = getSetComponents(set);
    const enabledCount = components.filter(component => Boolean(component.enabled)).length;
    const total = components.length;

    return {
        allEnabled: total > 0 && enabledCount === total,
        enabledCount,
        partiallyEnabled: enabledCount > 0 && enabledCount < total,
        total,
    };
}

export function setAllComponentsEnabled(set, enabled) {
    const nextEnabled = Boolean(enabled);
    let changedCount = 0;

    for (const component of getSetComponents(set)) {
        if (Boolean(component.enabled) === nextEnabled) continue;
        component.enabled = nextEnabled;
        changedCount++;
    }

    return changedCount;
}
