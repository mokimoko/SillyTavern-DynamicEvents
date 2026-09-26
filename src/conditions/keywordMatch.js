/** Literal, bounded chat-text matching for keyword conditions. */

export const KeywordScope = Object.freeze({
    LAST_USER: 'last-user',
    LAST_ASSISTANT: 'last-assistant',
    RECENT: 'recent',
});

export const KeywordMode = Object.freeze({
    ANY: 'any',
    ALL: 'all',
});

const MAX_LOOKBACK = 20;
const MAX_SCAN = 40;
const MAX_KEYWORDS = 100;
const WORD_CHAR = /[\p{L}\p{N}_]/u;

export function normalizeKeywords(value) {
    const source = Array.isArray(value) ? value : String(value ?? '').split(/\r?\n/);
    const seen = new Set();
    return source
        .map(item => String(item ?? '').trim())
        .filter(item => {
            const key = item.toLocaleLowerCase();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, MAX_KEYWORDS);
}

function messageText(message) {
    return String(message?.mes ?? message?.content ?? message?.text ?? '');
}

export function selectKeywordText(messages, scope = KeywordScope.LAST_USER, lookback = 4) {
    if (!Array.isArray(messages)) return '';
    const count = scope === KeywordScope.RECENT
        ? Math.max(1, Math.min(MAX_LOOKBACK, Number(lookback) || 4))
        : 1;
    const selected = [];
    for (let index = messages.length - 1, scanned = 0;
        index >= 0 && scanned < MAX_SCAN && selected.length < count;
        index--, scanned++) {
        const message = messages[index];
        const text = messageText(message);
        if (!message || message.is_system === true || !text.trim()) continue;
        if (scope === KeywordScope.LAST_USER && message.is_user !== true) continue;
        if (scope === KeywordScope.LAST_ASSISTANT && message.is_user === true) continue;
        selected.push(text);
    }
    return selected.reverse().join('\n');
}

function literalMatch(text, keyword, wholeWords) {
    let from = 0;
    while (from <= text.length - keyword.length) {
        const index = text.indexOf(keyword, from);
        if (index < 0) return false;
        if (!wholeWords) return true;
        const before = index > 0 ? text[index - 1] : '';
        const afterIndex = index + keyword.length;
        const after = afterIndex < text.length ? text[afterIndex] : '';
        if ((!before || !WORD_CHAR.test(before)) && (!after || !WORD_CHAR.test(after))) return true;
        from = index + Math.max(1, keyword.length);
    }
    return false;
}

export function inspectKeywordCondition(condition, context = {}) {
    const keywords = normalizeKeywords(condition?.keywords);
    const scope = condition?.keywordScope || KeywordScope.LAST_USER;
    const lookback = condition?.keywordLookback || 4;
    const cacheKey = `${scope}:${lookback}`;
    const sharedCache = context.keywordCache instanceof Map ? context.keywordCache : null;
    const cached = sharedCache?.get(cacheKey);
    let text = typeof cached === 'string' ? cached : cached?.text;
    let matchCache = cached && typeof cached === 'object' ? cached.matches : null;
    if (text === undefined) {
        text = selectKeywordText(context.messages, scope, lookback);
    }
    if (sharedCache && !(matchCache instanceof Map)) {
        matchCache = new Map();
        sharedCache.set(cacheKey, { text, matches: matchCache });
    }
    const caseSensitive = condition?.keywordCaseSensitive === true;
    const wholeWords = condition?.keywordWholeWords !== false;
    const mode = condition?.keywordMode === KeywordMode.ALL ? KeywordMode.ALL : KeywordMode.ANY;
    const signature = `${caseSensitive ? 1 : 0}:${wholeWords ? 1 : 0}:${mode}:${keywords.join('\u001f')}`;
    const cachedResult = matchCache?.get(signature);
    if (cachedResult) return cachedResult;

    const haystack = caseSensitive ? text : text.toLocaleLowerCase();
    const matched = keywords.filter(keyword => literalMatch(
        haystack,
        caseSensitive ? keyword : keyword.toLocaleLowerCase(),
        wholeWords,
    ));
    const result = {
        result: keywords.length > 0 && (mode === KeywordMode.ALL
            ? matched.length === keywords.length
            : matched.length > 0),
        found: Boolean(text),
        actual: matched,
        expected: keywords,
        matched,
        scope,
    };
    matchCache?.set(signature, result);
    return result;
}
