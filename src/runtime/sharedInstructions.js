/** Reusable Event guidance that is emitted once per injection destination. */

function injectionDestinationKey(injection = {}) {
    if (injection.mode === 'macro') {
        return `macro:${String(injection.macroName || '').trim()}`;
    }
    return [
        'extension-prompt',
        injection.position ?? 1,
        injection.depth ?? 0,
        injection.role ?? 0,
    ].join(':');
}

export function resolveEventSharedInstructions(set, event) {
    const requested = new Set(Array.isArray(event?.sharedInstructionIds)
        ? event.sharedInstructionIds
        : []);
    if (!requested.size) return [];
    return (set?.sharedInstructions || [])
        .filter(block => requested.has(block.id) && String(block.text || '').trim())
        .map(block => ({ id: block.id, name: block.name || 'Shared Instruction', text: block.text }));
}

/**
 * Mutates an Event text map so every requested block is appended once to the
 * last requesting Event in each injection destination.
 */
export function appendSharedInstructions(texts) {
    const destinations = new Map();
    for (const [sourceId, payload] of texts || []) {
        if (payload && payload.baseText === undefined) payload.baseText = payload.text;
        const blocks = Array.isArray(payload?.sharedInstructions) ? payload.sharedInstructions : [];
        if (!blocks.length) continue;
        const key = injectionDestinationKey(payload.injection);
        if (!destinations.has(key)) destinations.set(key, { seen: new Set(), blocks: [], targetId: sourceId });
        const destination = destinations.get(key);
        destination.targetId = sourceId;
        for (const block of blocks) {
            if (!block?.id || !String(block.text || '').trim() || destination.seen.has(block.id)) continue;
            destination.seen.add(block.id);
            destination.blocks.push(block);
        }
    }

    for (const destination of destinations.values()) {
        if (!destination.blocks.length) continue;
        const payload = texts.get(destination.targetId);
        if (!payload) continue;
        const sharedText = destination.blocks.map(block => String(block.text).trim()).join('\n\n');
        payload.text = [String(payload.text || '').trim(), sharedText].filter(Boolean).join('\n\n');
    }
    return texts;
}
