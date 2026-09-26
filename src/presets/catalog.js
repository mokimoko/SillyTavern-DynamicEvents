import {
    BindMode,
    ConditionGroupOperator,
    ConditionType,
    EventCategory,
    InjectionMode,
    KeywordMode,
    KeywordScope,
    PromptPosition,
    PromptRole,
    ScheduleType,
    ScriptTiming,
    SetRole,
    createCondition,
    createConditionGroup,
    createEvent,
    createEventSet,
    createPhase,
    createSharedInstruction,
    createScript,
} from '../../eventEngine.js';
import { SubjectMode, createSubject } from '../subjects/subjects.js';
import {
    TrackTransitionMode,
    createStateTrack,
    createTrackState,
    createTrackSubject,
} from '../tracks/stateTracks.js';
import {
    PromptRouterMode,
    createPromptLayer,
    createPromptRouter,
} from '../routers/promptRouters.js';
import { normalizeDynamicActions } from '../actions/actionTypes.js';

const SYSTEM_IN_CHAT = Object.freeze({
    mode: InjectionMode.EXTENSION_PROMPT,
    position: PromptPosition.IN_CHAT,
    depth: 1,
    role: PromptRole.SYSTEM,
});

const SYSTEM_PROMPT = Object.freeze({
    mode: InjectionMode.EXTENSION_PROMPT,
    position: PromptPosition.IN_PROMPT,
    depth: 0,
    role: PromptRole.SYSTEM,
});

const EROTIC_SPARK_SHARED_KEY = 'erotic-spark-continuity';
const EROTIC_SPARK_SHARED_TEXT = '<erotic_spark_guidance>Use established attraction, boundaries, and setting facts. If the sexual premise is unclear, keep the beat small or let it pass.</erotic_spark_guidance>';
const FIRST_MOVE_SHARED_KEY = 'first-move-continuity';
const FIRST_MOVE_SHARED_TEXT = '<first_move_guidance>Use {{subject}} if they are a present, clearly adult NPC playing opposite {{user}}; if that names a group or scenario card, choose one relevant present adult NPC from canon. Give the NPC a specific want, a real obstacle or cost, and one completed action of their own that {{user}} can answer. They may be selfish, competitive, awkward, hypocritical, or wrong about the timing; do not smooth the choice into automatic romance, healing, or a confession. Favor a concrete tactic and consequence over stock smirking, vague hints, or asking {{user}} to invent the move. A direct, specific question can be a move. Respect established limits, protection, participants, and setting facts. Do not write {{user}}\'s thoughts, desire, consent, dialogue, or actions. A refusal, withdrawal, impairment, or scene with no plausible desire or charged opening is not an invitation; let the cue pass. If sex is already underway, leave scene progression to the active scene.</first_move_guidance>';
const BAD_IDEA_SHARED_KEY = 'bad-idea-continuity';
const BAD_IDEA_SHARED_TEXT = '<bad_idea_guidance>Pick a clearly adult NPC with a sexual motive and a real risk already present in the story. Have them make one deliberate, morally compromised sexual move now. They may lie, use an advantage, break a promise, expose a secret, or pursue someone despite the likely cost. Keep them recognizably themselves. Do not decide {{user}}\'s response.</bad_idea_guidance>';
const SEXUAL_COMPLICATION_SHARED_KEY = 'sexual-complication-continuity';
const SEXUAL_COMPLICATION_SHARED_TEXT = '<sexual_complication_guidance>Continue the current sexual action. Keep bodies, limits, protection, participants, and setting facts consistent. If sex is not happening, ignore this cue.</sexual_complication_guidance>';
const FIRST_TIME_SHARED_KEY = 'first-time-continuity';
const FIRST_TIME_SHARED_TEXT = '<first_time_guidance>Use established experience, bodies, preferences, and limits. Let the encounter reflect these characters rather than a stock first-time script.</first_time_guidance>';
const CHANGED_BOUNDARY_SHARED_KEY = 'changed-boundary-continuity';
const CHANGED_BOUNDARY_SHARED_TEXT = '<changed_boundary_guidance>Use the exact recorded terms and who knows them. A milestone grants nothing beyond what was established.</changed_boundary_guidance>';
const SEXUAL_AFTERMATH_SHARED_KEY = 'sexual-aftermath-guardrails';
const SEXUAL_AFTERMATH_SHARED_TEXT = '<sexual_aftermath_guidance>Continue from what happened. Keep bodies, protection, participants, and setting details consistent. If sex is still happening—or never happened—do not force an aftermath.</sexual_aftermath_guidance>';

function stateRule(binding, path, operator, value) {
    return {
        type: ConditionType.PROVIDER_STATE,
        providerId: 'superagents',
        source: `$stateSource:${binding}`,
        path,
        operator,
        value: String(value),
    };
}

function notStateRule(binding, path, operator, value) {
    return { ...stateRule(binding, path, operator, value), invert: true };
}

function knowledgeRule(binding, capability) {
    return {
        type: ConditionType.PROVIDER_STATE,
        providerId: 'superagents-knowledge',
        source: `$stateSource:${binding}`,
        path: 'candidates.$subject.capability',
        operator: 'eq',
        value: capability,
    };
}

function knowledgeSubject(binding) {
    return {
        mode: SubjectMode.STATE_SOURCE,
        providerId: 'superagents-knowledge',
        source: `$stateSource:${binding}`,
        collectionPath: 'candidates',
        subjectPath: 'character',
        counterpartPath: '',
        selection: 'least-recent',
    };
}

function calendarRule(status) {
    return {
        type: ConditionType.PROVIDER_STATE,
        providerId: 'superagents-calendar',
        source: 'calendar',
        path: 'commitments.$subject.status',
        operator: 'eq',
        value: status,
    };
}

function calendarCommitmentSubject() {
    return {
        mode: SubjectMode.STATE_SOURCE,
        providerId: 'superagents-calendar',
        source: 'calendar',
        collectionPath: 'commitments',
        subjectPath: 'title',
        counterpartPath: '',
        selection: 'least-recent',
    };
}

function allStateRules(...conditions) {
    return { type: ConditionType.GROUP, operator: ConditionGroupOperator.ALL, conditions };
}

function anyStateRules(...conditions) {
    return { type: ConditionType.GROUP, operator: ConditionGroupOperator.ANY, conditions };
}

function keywordRule(keywords, scope = KeywordScope.LAST_USER, options = {}) {
    return {
        type: ConditionType.KEYWORD,
        keywords,
        keywordScope: scope,
        keywordMode: KeywordMode.ANY,
        keywordLookback: 4,
        keywordCaseSensitive: false,
        keywordWholeWords: true,
        ...options,
    };
}

function stateCharacterSubject(binding) {
    return {
        mode: SubjectMode.STATE_SOURCE,
        providerId: 'superagents',
        source: `$stateSource:${binding}`,
        collectionPath: 'characters',
        subjectPath: '',
        counterpartPath: '',
        selection: 'least-recent',
    };
}

function stateValueSubject(binding, subjectPath) {
    return {
        mode: SubjectMode.STATE_VALUE,
        providerId: 'superagents',
        source: `$stateSource:${binding}`,
        collectionPath: '',
        subjectPath,
        counterpartPath: '',
        selection: 'least-recent',
    };
}

function eroticSpark(type, direction) {
    return {
        text: `<erotic_spark type="${type}">\n${direction}\n</erotic_spark>`,
        sharedInstructionKeys: [EROTIC_SPARK_SHARED_KEY],
    };
}

function firstMove(type, direction) {
    return {
        text: `<first_move type="${type}" character="{{subject}}">\n${direction}\n</first_move>`,
        sharedInstructionKeys: [FIRST_MOVE_SHARED_KEY],
    };
}

function badIdea(type, direction) {
    return {
        text: `<bad_idea type="${type}" character="{{subject}}">\n${direction}\n</bad_idea>`,
        sharedInstructionKeys: [BAD_IDEA_SHARED_KEY],
    };
}

function badIdeaDesireRule() {
    return anyStateRules(
        stateRule('relationship', 'characters.$subject.attraction', 'gte', 55),
        stateRule('relationship', 'characters.$subject.milestones', 'contains', 'sexual intimacy established'),
        stateRule('scene', 'characters.$subject.arousal', 'gte', 60),
    );
}

function firstTimeBeat(type, direction) {
    return {
        text: `<first_time_beat type="${type}" character="{{subject}}">\n${direction}\n</first_time_beat>`,
        sharedInstructionKeys: [FIRST_TIME_SHARED_KEY],
    };
}

function changedBoundaryBeat(type, direction) {
    return {
        text: `<changed_boundary_beat type="${type}" character="{{subject}}">\n${direction}\n</changed_boundary_beat>`,
        sharedInstructionKeys: [CHANGED_BOUNDARY_SHARED_KEY],
    };
}

function dirtyMessageCue(direction) {
    return `${direction}\n\nTreat this as an occasion, not a required delivery. Consider whether {{subject}} would deliberately contact {{user}} through the canonically available private communication surface. Respect the active presentation, established access, medium, delivery time, privacy, availability, relationship, boundaries, and {{subject}}'s voice. Do not invent a communication method or delivery capability the setting has not established. Never decide {{user}}'s thoughts, feelings, arousal, consent, reply, or actions. Produce no communication if the premise, access, timing, or character choice does not fit.`;
}

function optionalStateRule(source, path, operator, value) {
    return {
        type: ConditionType.PROVIDER_STATE,
        providerId: 'superagents',
        source,
        path,
        operator,
        value: String(value),
    };
}

const SEXUAL_ACTIVITY_KEYWORDS = Object.freeze([
    'having sex',
    'had sex',
    'fuck me',
    'fucking me',
    'fucking you',
    'fucking him',
    'fucking her',
    'fucking them',
    'fucks me',
    'fucks you',
    'fucks him',
    'fucks her',
    'fucks them',
    'fucked',
    'inside me',
    'inside you',
    'inside him',
    'inside her',
    'inside them',
    'was inside me',
    'was inside you',
    'was inside him',
    'was inside her',
    'was inside them',
    'pushes inside',
    'pushed inside',
    'slides inside',
    'slid inside',
    'thrusts into',
    'thrusting into',
    'thrust into',
    'rides him',
    'rides her',
    'rides them',
    'rides me',
    'rides you',
    'rode him',
    'rode her',
    'rode them',
    'rode me',
    'rode you',
    'sucks his cock',
    'sucks her cock',
    'sucks their cock',
    'sucks my cock',
    'sucks your cock',
    'goes down on',
    'went down on',
    'eating her out',
    'eating them out',
    'eating me out',
    'eating you out',
    'ate her out',
    'ate them out',
    'ate me out',
    'ate you out',
    'penetrates',
    'penetrated',
    'penetration',
    'orgasm',
    'orgasmed',
    'climax',
    'climaxed',
    'comes inside',
    'came inside',
    'cums inside',
]);

function sexualActivityRule() {
    return anyStateRules(
        keywordRule(SEXUAL_ACTIVITY_KEYWORDS, KeywordScope.RECENT, { keywordLookback: 2 }),
        optionalStateRule('sa_prompt_base', 'nsfw', 'eq', true),
        optionalStateRule('sa_after_dark', 'active.stageIndex', 'gte', 2),
        allStateRules(
            optionalStateRule('sa_state_card', 'characters.$subject.arousal', 'gte', 70),
            keywordRule([
                'naked together',
                'both naked',
                'fully naked',
                'between his legs',
                'between her legs',
                'between their legs',
                'between my legs',
                'between your legs',
                'under the covers',
                'on top of me',
                'on top of you',
                'on top of him',
                'on top of her',
                'on top of them',
            ], KeywordScope.RECENT, { keywordLookback: 3 }),
        ),
    );
}

function sexualComplication(type, direction) {
    return {
        text: `<sexual_complication type="${type}">\n${direction}\n</sexual_complication>`,
        sharedInstructionKeys: [SEXUAL_COMPLICATION_SHARED_KEY],
    };
}

const SEXUAL_AFTERMATH_KEYWORDS = Object.freeze([
    'after sex',
    'post-sex',
    'afterglow',
    'after they finish',
    'after he finishes',
    'after she finishes',
    'after you finish',
    'after we finish',
    'after i finish',
    'after they finished',
    'after he finished',
    'after she finished',
    'after you finished',
    'after we finished',
    'after i finished',
    'after they had finished',
    'after he had finished',
    'after she had finished',
    'after you had finished',
    'after we had finished',
    'after i had finished',
    "after they'd finished",
    "after he'd finished",
    "after she'd finished",
    "after you'd finished",
    "after we'd finished",
    "after i'd finished",
    'once they finish',
    'once he finishes',
    'once she finishes',
    'once you finish',
    'once we finish',
    'once i finish',
    'once they finished',
    'once he finished',
    'once she finished',
    'once you finished',
    'once we finished',
    'once i finished',
    'once they had finished',
    'once he had finished',
    'once she had finished',
    'once you had finished',
    'once we had finished',
    'once i had finished',
    "once they'd finished",
    "once he'd finished",
    "once she'd finished",
    "once you'd finished",
    "once we'd finished",
    "once i'd finished",
    'when they are done',
    'when he is done',
    'when she is done',
    'when you are done',
    'when we are done',
    'when i am done',
    'when they were done',
    'when he was done',
    'when she was done',
    'when you were done',
    'when we were done',
    'when i was done',
]);

const SEXUAL_COOLDOWN_KEYWORDS = Object.freeze([
    'pulls out',
    'pulled out',
    'pulls away',
    'pulled away',
    'slips out',
    'slipped out',
    'rolls off',
    'rolled off',
    'catches his breath',
    'catches her breath',
    'catches their breath',
    'catching his breath',
    'catching her breath',
    'catching their breath',
    'catching my breath',
    'catching your breath',
    'catching our breath',
    'caught his breath',
    'caught her breath',
    'caught their breath',
    'caught my breath',
    'caught your breath',
    'caught our breath',
    'cleaning up',
    'cleaned up',
    'cleans himself',
    'cleans herself',
    'cleans themself',
    'cleaned himself',
    'cleaned herself',
    'cleaned themself',
    'cleaned myself',
    'cleaned yourself',
    'wipes himself',
    'wipes herself',
    'wipes themself',
    'wiped himself',
    'wiped herself',
    'wiped themself',
    'wiped myself',
    'wiped yourself',
    'gets dressed',
    'getting dressed',
    'got dressed',
    'puts his clothes on',
    'puts her clothes on',
    'puts their clothes on',
    'put his clothes on',
    'put her clothes on',
    'put their clothes on',
    'put my clothes on',
    'put your clothes on',
    'put our clothes on',
]);

function sexualAftermathRule() {
    const recentActivity = () => keywordRule(
        SEXUAL_ACTIVITY_KEYWORDS,
        KeywordScope.RECENT,
        { keywordLookback: 5 },
    );
    return anyStateRules(
        keywordRule(SEXUAL_AFTERMATH_KEYWORDS, KeywordScope.RECENT, { keywordLookback: 3 }),
        allStateRules(
            recentActivity(),
            keywordRule(SEXUAL_COOLDOWN_KEYWORDS, KeywordScope.RECENT, { keywordLookback: 2 }),
        ),
        allStateRules(
            recentActivity(),
            { ...keywordRule(SEXUAL_ACTIVITY_KEYWORDS, KeywordScope.LAST_ASSISTANT), invert: true },
        ),
        allStateRules(
            recentActivity(),
            optionalStateRule('sa_prompt_base', 'nsfw', 'eq', false),
        ),
        allStateRules(
            recentActivity(),
            optionalStateRule('sa_after_dark', 'active.stageIndex', 'gte', 4),
        ),
        allStateRules(
            recentActivity(),
            optionalStateRule('sa_state_card', 'characters.$subject.arousal', 'lte', 25),
        ),
    );
}

function sexualAftermath(type, direction) {
    return {
        text: `<sexual_aftermath type="${type}">\n${direction}\n</sexual_aftermath>`,
        sharedInstructionKeys: [SEXUAL_AFTERMATH_SHARED_KEY],
    };
}

function relationshipMilestone(value) {
    return stateRule('milestones', 'characters.$subject.milestones', 'contains', value);
}

function noRelationshipMilestone(value) {
    return notStateRule('milestones', 'characters.$subject.milestones', 'contains', value);
}

function betrayalEstablishedRule() {
    return anyStateRules(
        relationshipMilestone('betrayal by character established'),
        relationshipMilestone('betrayal by persona established'),
    );
}

export const BUILT_IN_PRESETS = Object.freeze([
    {
        id: 'time-skip',
        version: 1,
        name: 'Time Skip',
        description: 'A manual story transition. Choose when to resume, add optional context for the gap, and start the next reply. Uses SuperAgents World State when it is active.',
        tags: ['time', 'scene transition', 'manual'],
        setName: 'Preset — Time Skip',
        scripts: [{
            key: 'time-skip',
            name: 'Time Skip',
            description: 'Adds a send-bar button that opens the Time Skip chooser.',
            builtInAction: 'time-skip',
            buttonActivated: true,
            trigger: { timing: ScriptTiming.MANUAL },
        }],
    },
    {
        id: 'story-complications',
        version: 3,
        name: 'Story Complications',
        description: 'A menu of independent story disruptions. Pick any combination to introduce setbacks, returning history, severe crises, changing weather, or illness on a schedule.',
        tags: ['setbacks', 'surprises', 'world events'],
        setName: 'Preset — Story Complications',
        events: [
            {
                key: 'things-go-south',
                name: 'Things Go South',
                description: 'Periodically introduces a plausible setback connected to the current scene, goals, or risks.',
                category: EventCategory.FLAVOR,
                priority: 10,
                text: '[Something goes wrong: Introduce one believable setback tied to the current goal, risk, or setting. Make it matter, but keep earlier progress intact. DON’T choose {{user}}’s response.]',
                schedule: { type: ScheduleType.RECURRING, intervalMin: 8, intervalMax: 16, probability: 0.35, cooldown: 12, initialDelay: 8 },
            },
            {
                key: 'past-returns',
                name: 'Past Returns',
                description: 'Once per chat, brings back a person, consequence, obligation, or unresolved incident from the character’s established past.',
                category: EventCategory.PLOT,
                priority: 50,
                text: '[The past comes back: Bring in one person, consequence, obligation, or unfinished problem from {{char}}\'s established history. Work it in naturally. DON’T invent new history or contradict canon.]',
                schedule: { type: ScheduleType.ONE_SHOT, intervalMin: 3, intervalMax: 8, probability: 1, cooldown: 0, initialDelay: 45 },
            },
            {
                key: 'catastrophe',
                name: 'Catastrophe Strikes',
                description: 'Once per chat, begins a serious crisis with lasting consequences after the story has had time to develop.',
                category: EventCategory.PLOT,
                priority: 70,
                text: '[A serious crisis begins: Make it fit the setting. Give the characters enough warning to react, and let the consequences last. DON’T dictate {{user}}\'s choices or resolve the crisis immediately.]',
                schedule: { type: ScheduleType.ONE_SHOT, intervalMin: 5, intervalMax: 12, probability: 0.5, cooldown: 0, initialDelay: 70 },
            },
            {
                key: 'bad-weather',
                name: 'Bad Weather Event',
                description: 'Occasionally changes the weather in a dramatic but setting-appropriate way that affects the current scene.',
                category: EventCategory.WORLD,
                priority: 15,
                text: '[The weather changes: Make it dramatic enough to affect the scene, but believable for this place and season. Show what it does to visibility, movement, clothing, shelter, sound, or plans. DON’T repeat a recent weather beat.]',
                schedule: { type: ScheduleType.RECURRING, intervalMin: 18, intervalMax: 35, probability: 0.3, cooldown: 24, initialDelay: 18 },
            },
            {
                key: 'illness',
                name: 'Illness',
                description: 'Once per chat, has the current character begin showing gradual signs of illness or exhaustion.',
                category: EventCategory.FLAVOR,
                priority: 15,
                text: '[{{char}} is getting sick or worn down: Start with one or two believable signs and let them build gradually. Fit the symptoms to the setting and circumstances. DON’T diagnose them for {{user}} or decide how {{user}} reacts.]',
                schedule: { type: ScheduleType.ONE_SHOT, intervalMin: 4, intervalMax: 10, probability: 0.4, cooldown: 0, initialDelay: 55 },
            },
        ],
    },
    {
        id: 'world-conditions',
        version: 2,
        name: 'World Conditions',
        description: 'Turns validated World State environment and clock facts into occasional scene pressure without changing the weather, inventing precise time, or treating an inferred date as a deadline.',
        tags: ['world state', 'environment', 'time of day', 'weather', 'travel'],
        setName: 'Preset — World Conditions',
        stateBindings: [{
            key: 'world',
            label: 'World State environment and clock',
            path: 'timeOfDay',
            description: 'Validated branch-aware location, time of day, weather, temperature, and setting from SuperAgents World State.',
            preferredSources: ['sa_world_state'],
        }],
        events: [
            {
                key: 'nighttime-pressure',
                name: 'Nighttime Has Consequences',
                description: 'Occasionally lets established evening or nighttime conditions affect access, visibility, routine, safety, or social behavior.',
                category: EventCategory.WORLD,
                priority: 20,
                text: '<world_condition>It is evening or night. Make that matter once through visibility, access, crowds, fatigue, transport, routine, or local expectations. Keep the current time and place. Darkness alone does not mean danger. DON’T choose {{user}}\'s response or settle a major outcome.</world_condition>',
                condition: anyStateRules(
                    stateRule('world', 'timeOfDay', 'eq', 'Evening'),
                    stateRule('world', 'timeOfDay', 'eq', 'Night'),
                    stateRule('world', 'timeOfDay', 'eq', 'Late Night'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 10, intervalMax: 18, probability: 0.35, cooldown: 14, initialDelay: 8 },
            },
            {
                key: 'severe-weather-consequence',
                name: 'Severe Weather Consequence',
                description: 'Makes already-established severe weather matter physically or logistically without scheduling a new storm.',
                category: EventCategory.WORLD,
                priority: 35,
                text: '<world_condition>Severe weather is already happening. Show one concrete effect on sound, visibility, travel, shelter, clothing, infrastructure, timing, or ordinary behavior. Keep the tracked weather as-is. DON’T turn it into a disaster, injure anyone automatically, or decide {{user}}\'s action.</world_condition>',
                condition: anyStateRules(
                    stateRule('world', 'weather', 'eq', 'Heavy Rain'),
                    stateRule('world', 'weather', 'eq', 'Downpour'),
                    stateRule('world', 'weather', 'eq', 'Thunderstorm'),
                    stateRule('world', 'weather', 'eq', 'Storm'),
                    stateRule('world', 'weather', 'eq', 'Heavy Snow'),
                    stateRule('world', 'weather', 'eq', 'Blizzard'),
                    stateRule('world', 'weather', 'eq', 'Hail'),
                    stateRule('world', 'weather', 'eq', 'Sleet'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 8, intervalMax: 16, probability: 0.45, cooldown: 12, initialDelay: 5 },
            },
            {
                key: 'outdoor-exposure',
                name: 'Outdoor Exposure',
                description: 'Lets established outdoor temperature extremes impose believable, bounded practical pressure.',
                category: EventCategory.WORLD,
                priority: 30,
                text: '<world_condition>The scene is outdoors in extreme heat or cold. Show one practical effect on comfort, stamina, equipment, pace, or the need for shelter. Account for clothing, species, magic, technology, and acclimatization already in canon. DON’T inflict automatic injury or choose {{user}}\'s response.</world_condition>',
                condition: allStateRules(
                    stateRule('world', 'setting', 'eq', 'Outdoors'),
                    anyStateRules(
                        stateRule('world', 'temperature', 'eq', 'Freezing'),
                        stateRule('world', 'temperature', 'eq', 'Cold'),
                        stateRule('world', 'temperature', 'eq', 'Scorching'),
                    ),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 10, intervalMax: 20, probability: 0.35, cooldown: 15, initialDelay: 7 },
            },
            {
                key: 'travel-constraint',
                name: 'Travel Has Constraints',
                description: 'Occasionally makes an established vehicle or in-transit scene obey its physical and social limitations.',
                category: EventCategory.FLAVOR,
                priority: 20,
                text: '<world_condition>They are traveling by vehicle. Make one ordinary limitation of that vehicle matter: movement, noise, privacy, route, schedule, space, etiquette, access, or reliance on a driver or crew. Keep it small and believable. DON’T invent a breakdown, crash, or delay without support.</world_condition>',
                condition: stateRule('world', 'setting', 'eq', 'Vehicle'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 12, intervalMax: 24, probability: 0.3, cooldown: 18, initialDelay: 8 },
            },
        ],
    },
    {
        id: 'chekhov-setup-payoff',
        version: 3,
        name: 'Chekhov Setup → Payoff',
        description: 'Creates a two-part plot thread: first establish an ordinary detail, then bring that same detail back later when it can matter.',
        tags: ['foreshadowing', 'setup and payoff'],
        setName: 'Preset — Chekhov Setup → Payoff',
        events: [
            {
                key: 'setup',
                name: 'Chekhov Setup',
                description: 'Introduces one unobtrusive object, document, name, or fact and saves a short description of it.',
                category: EventCategory.PLOT,
                priority: 90,
                text: '[Plant one detail: Introduce a specific object, document, name, or fact that belongs in this setting. Treat it as incidental; DON’T spotlight its future importance. After the narrative output: <!--DE:chekhovDetail:SHORT DESCRIPTION-->]',
                capture: { enabled: true, varName: 'chekhovDetail' },
                injection: SYSTEM_PROMPT,
                schedule: { type: ScheduleType.ONE_SHOT, intervalMin: 12, intervalMax: 25, probability: 1, cooldown: 0, initialDelay: 4 },
            },
            {
                key: 'payoff',
                name: 'Chekhov Payoff',
                description: 'After the setup has happened, makes the saved detail directly relevant to the current conflict or goal.',
                requires: ['setup'],
                category: EventCategory.PLOT,
                priority: 95,
                text: '[Pay off the planted detail: Make {{getvar::chekhovDetail}} directly useful, dangerous, revealing, or troublesome to the current goal or conflict. Refer to the exact detail and keep how it was originally established intact.]',
                injection: SYSTEM_PROMPT,
                condition: { type: ConditionType.IS_SPENT, targetKey: 'setup' },
                schedule: { type: ScheduleType.ONE_SHOT, intervalMin: 15, intervalMax: 35, probability: 1, cooldown: 0, initialDelay: 8 },
            },
        ],
    },
    {
        id: 'event-spark',
        version: 3,
        name: 'Event Spark',
        description: 'Adds occasional, lightweight surprises—such as a message, mistake, visitor, hazard, discovery, or shift in the social dynamic—to keep scenes from becoming predictable.',
        tags: ['random events', 'variety'],
        setName: 'Preset — Event Spark',
        events: [{
            key: 'event-spark',
            name: 'Event Spark',
            description: 'On eligible turns, chooses one context-appropriate surprise from a varied list and works it into the next response.',
            category: EventCategory.FLAVOR,
            priority: 20,
            text: 'Add one thing that fits the current story: {{random::a telling background detail::a character making a mistake::an urgent message::an unexpected visitor::a physical hazard::a public event people are talking about::petty local drama::a reason to go somewhere::a loose thread someone can act on::a small shift in who has the upper hand}}. Keep it brief unless the scene naturally grabs onto it. DON’T write {{user}}’s actions or dialogue.',
            schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 1, probability: 0.3, cooldown: 0, initialDelay: 0 },
        }],
    },
    {
        id: 'erotic-sparks',
        version: 5,
        name: 'Erotic Sparks',
        description: 'Independent adult story openings driven by local phrases, optional Scene State or Relationship Ledger signals, low-frequency scheduling, and a manual wildcard. It favors character initiative and erotic variety without treating sex as romance.',
        tags: ['adult', 'nsfw', 'initiative', 'keywords', 'state-aware', 'anti-romance'],
        setName: 'Preset — Erotic Sparks',
        sharedInstructions: [{
            key: EROTIC_SPARK_SHARED_KEY,
            name: 'Erotic Spark Continuity',
            text: EROTIC_SPARK_SHARED_TEXT,
        }],
        stateBindings: [
            {
                key: 'scene',
                label: 'Scene State arousal',
                path: 'characters.$subject.arousal',
                preferredSources: ['sa_state_card'],
            },
            {
                key: 'milestones',
                label: 'Relationship attraction and pressure',
                path: 'characters.$subject.attraction',
                preferredSources: ['sa_relationship_ledger'],
            },
        ],
        events: [
            {
                key: 'invitation-stays-live',
                name: 'The Invitation Stays Live',
                description: 'Recognizes a direct physical or sexual invitation in the latest user message and keeps the relevant adult character from retreating into passive or romanticized discussion.',
                category: EventCategory.PLOT,
                priority: 48,
                ...eroticSpark('invitation', '{{user}} just gave a direct invitation. Let the relevant NPC take them up on it in a way that sounds and feels like that character; DON’T make {{user}} repeat it. Stay inside what was actually offered. The NPC may ask, offer, move closer, position themself, or make the next move within the invitation’s terms.'),
                condition: keywordRule([
                    'kiss me',
                    'touch me',
                    'take it off',
                    'take your clothes off',
                    'get undressed',
                    'come to bed',
                    'get in bed',
                    'i want you',
                    'on your knees',
                    "don't stop",
                    'keep going',
                    'show me what you want',
                    'tell me what you want',
                ]),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 0, intervalMax: 0, probability: 0.75, cooldown: 7, initialDelay: 0 },
            },
            {
                key: 'challenge-turns-loaded',
                name: 'A Challenge Turns Loaded',
                description: 'Lets a dare, taunt, or provocative challenge acquire erotic force when the established adult dynamic can genuinely support that reading.',
                category: EventCategory.FLAVOR,
                priority: 36,
                ...eroticSpark('challenge', 'A recent challenge has room to turn sexual. If that fits the established dynamic, let the NPC accept it, twist it, or answer with a bold move, teasing leverage, competitive escalation, or an unmistakable offer. Match the actual relationship. If the challenge is plainly nonsexual, leave it that way.'),
                condition: keywordRule([
                    'prove it',
                    'i dare you',
                    "you wouldn't",
                    'make me',
                    'try me',
                    "bet you can't",
                    'is that all',
                    'show me',
                ], KeywordScope.RECENT, { keywordLookback: 3 }),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 0, intervalMax: 0, probability: 0.45, cooldown: 9, initialDelay: 0 },
            },
            {
                key: 'body-gives-away',
                name: 'The Body Gives Them Away',
                description: 'Uses a present adult character’s elevated Scene State arousal to let physical awareness affect behavior without forcing confession or romance.',
                category: EventCategory.FLAVOR,
                priority: 34,
                subject: stateCharacterSubject('scene'),
                ...eroticSpark('physical-tell', '{{subject}} is aroused enough that their body or behavior gives something away. Show one specific tell: a lapse in composure, an adjustment, a change in distance or attention, or an attempt to hide or manage it. Fit the tell to {{subject}}’s body and personality. It can be tempting, funny, frustrating, or embarrassing without becoming a confession, proposition, or tender moment.'),
                condition: stateRule('scene', 'characters.$subject.arousal', 'gte', 35),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 0, intervalMax: 2, probability: 0.34, cooldown: 8, initialDelay: 0 },
            },
            {
                key: 'privacy-changes-equation',
                name: 'Privacy Changes the Equation',
                description: 'Combines an established privacy cue with elevated Scene State arousal so opportunity matters without assuming privacy itself is sexual.',
                category: EventCategory.PLOT,
                priority: 42,
                subject: stateCharacterSubject('scene'),
                ...eroticSpark('privacy', '{{subject}} is already affected, and they finally have believable privacy. Let them notice what they can do without witnesses and take one character-specific step: close the distance, make an offer, show their intent, arrange the space, test a boundary, or refuse to waste the opening. Use the opening within their established boundaries.'),
                condition: allStateRules(
                    keywordRule([
                        "we're alone",
                        'we are alone',
                        'we were alone',
                        'they were alone',
                        'no one can hear',
                        'no one will hear',
                        'no one could hear',
                        'lock the door',
                        'locked the door',
                        'had locked the door',
                        'private room',
                        'sharing a bed',
                        'were sharing a bed',
                        'shared a bed',
                        'only one bed',
                        'in the shower',
                        'in the bath',
                    ], KeywordScope.RECENT, { keywordLookback: 4 }),
                    stateRule('scene', 'characters.$subject.arousal', 'gte', 20),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 0, intervalMax: 1, probability: 0.5, cooldown: 10, initialDelay: 0 },
            },
            {
                key: 'stops-pretending',
                name: 'They Stop Pretending',
                description: 'Uses sustained attraction plus comfort or familiarity to give an adult character one chance to replace vague tension with a deliberate move.',
                category: EventCategory.PLOT,
                priority: 46,
                subject: stateCharacterSubject('relationship'),
                oncePerSubject: true,
                ...eroticSpark('deliberate-move', '{{subject}} is strongly attracted to {{user}} and knows them well enough to stop hiding behind endless tension. Have {{subject}} make one deliberate, unmistakably sexual move that fits their personality and the moment. It can be blunt, playful, calculating, awkward, selfish, confident, or risky.'),
                condition: allStateRules(
                    stateRule('relationship', 'characters.$subject.attraction', 'gte', 60),
                    anyStateRules(
                        stateRule('relationship', 'characters.$subject.comfort', 'gte', 30),
                        stateRule('relationship', 'characters.$subject.familiarity', 'gte', 40),
                    ),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 0, intervalMax: 3, probability: 0.38, cooldown: 12, initialDelay: 1 },
            },
            {
                key: 'jealousy-gets-physical',
                name: 'Jealousy Gets Physical',
                description: 'Lets meaningful jealousy and attraction produce a provocative bid for attention without presenting possessiveness as love or entitlement.',
                category: EventCategory.PLOT,
                priority: 40,
                subject: stateCharacterSubject('relationship'),
                ...eroticSpark('jealousy', '{{subject}} is attracted and jealous. Turn that pressure into one concrete sexual or provocative choice: compete for attention, show off, interrupt a charged moment, issue a challenge, get pointedly demonstrative, or create a private confrontation. Keep the choice specific to {{subject}}.'),
                condition: allStateRules(
                    stateRule('relationship', 'characters.$subject.attraction', 'gte', 40),
                    stateRule('relationship', 'characters.$subject.jealousy', 'gte', 55),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 2, intervalMax: 6, probability: 0.3, cooldown: 14, initialDelay: 2 },
            },
            {
                key: 'convenient-accident',
                name: 'A Convenient Accident',
                description: 'Occasionally creates a setting-appropriate practical mishap or coincidence that produces physical opportunity without requiring any tracker.',
                category: EventCategory.FLAVOR,
                priority: 22,
                ...eroticSpark('convenient-accident', 'Create one small, believable accident that puts the relevant characters in an unexpectedly physical situation: awkward proximity, a disrupted routine, troublesome clothing or equipment, a shared task, an object passed hand to hand, an inconvenient position, or a need for help. Let the NPC decide what to do with the opening. Keep the accident small and plausible.'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 10, intervalMax: 18, probability: 0.26, cooldown: 14, initialDelay: 6 },
            },
            {
                key: 'bad-idea-excellent-timing',
                name: 'Bad Idea, Excellent Timing',
                description: 'Rarely surfaces the most entertaining established temptation, social risk, inappropriate timing, or mutually questionable opportunity available now.',
                category: EventCategory.PLOT,
                priority: 28,
                ...eroticSpark('bad-idea', 'Put one sexual temptation within reach that is already a bad idea because of the timing, place, rivalry, duty, secrecy, social risk, power, old habits, practical fallout, or plain selfishness. Let an NPC notice it or go after it. Risk does not make the moment romantic, destined, or healing. DON’T invent coercion, impairment, taboo, or a power imbalance just to make it darker.'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 14, intervalMax: 26, probability: 0.2, cooldown: 20, initialDelay: 10 },
            },
            {
                key: 'manual-wildcard',
                name: 'Manual Erotic Wildcard',
                description: 'Adds a send-bar button for an immediate character-specific erotic development while remaining inert as an automatic Event.',
                category: EventCategory.CUSTOM,
                priority: 50,
                buttonActivated: true,
                ...eroticSpark('manual-wildcard', 'Add one strong sexual development the scene can use right now. Choose the people, physical opportunity, social or power dynamic, and tone from canon, then have a relevant NPC actually do something. Be specific and entertaining; skip generic yearning. It can be horny, playful, messy, funny, kinky, selfish, dark, risky, casual, or a terrible idea.'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 1, probability: 0, cooldown: 0, initialDelay: 0 },
            },
        ],
    },
    {
        id: 'they-make-the-first-move',
        version: 1,
        name: 'They Make the First Move',
        description: 'Character-driven adult initiative: flawed motives, concrete choices, and an opening for the player to answer. Works without trackers and does not assume that attraction is consent.',
        tags: ['adult', 'nsfw', 'initiative', 'character agency', 'anti-repetition'],
        setName: 'Preset — They Make the First Move',
        sharedInstructions: [{
            key: FIRST_MOVE_SHARED_KEY,
            name: 'First Move Continuity',
            text: FIRST_MOVE_SHARED_TEXT,
        }],
        subjectBinding: {
            label: 'Who may make the first move',
            description: 'Defaults to the active card. Choose a specific tracked character when a scenario or group card should not choose for itself.',
            default: { mode: SubjectMode.ACTIVE_CARD, value: '' },
        },
        events: [
            {
                key: 'rule-they-break',
                name: 'The Rule They Break',
                description: 'Lets a character knowingly act against an established rule they made for themself, without turning the choice into a confession or promise.',
                category: EventCategory.PLOT,
                priority: 42,
                ...firstMove('rule-they-break', 'Only if this NPC has an established self-imposed rule about {{user}}, intimacy, rivalry, duty, or the relationship, have them knowingly break that exact rule through one concrete offer or action. Show what the rule costs them and why they choose this moment. Do not invent a past rule, announce that everything has changed, or claim {{user}} accepts the breach.'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 9, intervalMax: 17, probability: 0.3, cooldown: 16, initialDelay: 5 },
            },
            {
                key: 'excuse-is-thin',
                name: 'The Excuse Is Embarrassingly Thin',
                description: 'Lets a character engineer a plausible reason to stay, return, or create an opening, then reveal what they actually want.',
                category: EventCategory.PLOT,
                priority: 38,
                ...firstMove('thin-excuse', 'If the scene supports attraction or charged curiosity, let the NPC use a plausible practical excuse to stay, return, help, or ask for a private moment. Make the excuse specific to their life and circumstances, then let their real purpose become legible through something they do or say now. Do not manufacture an emergency, erase witnesses, or make {{user}} go along.'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 7, intervalMax: 14, probability: 0.34, cooldown: 13, initialDelay: 4 },
            },
            {
                key: 'terrible-timing-their-choice',
                name: 'Terrible Timing, Their Choice',
                description: 'Lets an NPC choose a charged moment despite a real inconvenience, obligation, or social cost already in the scene.',
                category: EventCategory.PLOT,
                priority: 36,
                ...firstMove('terrible-timing', 'Only if an established obligation, deadline, social complication, or inconvenient setting makes this a genuinely bad moment, let the NPC decide to make a move anyway. Give them a specific action or proposition and preserve the practical consequence of their timing. Do not invent coercion, danger, impairment, or a power imbalance to make the choice more dramatic.'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 12, intervalMax: 22, probability: 0.27, cooldown: 19, initialDelay: 8 },
            },
            {
                key: 'make-it-a-challenge',
                name: 'They Make It a Challenge',
                description: 'Turns a canon-supported rivalry or provocative exchange into a specific dare, wager, or pointed invitation from the NPC.',
                category: EventCategory.PLOT,
                priority: 40,
                ...firstMove('challenge', 'A recent dare, taunt, wager, or competitive exchange may give this NPC an opening. If their dynamic with {{user}} supports a sexual reading, have the NPC initiate one concrete challenge or pointed invitation in their own voice. Give the challenge real stakes for the NPC; do not reinterpret an ordinary nonsexual dispute as desire or decide that {{user}} accepts.'),
                condition: keywordRule([
                    'i dare you', 'prove it', "you wouldn't", 'try me', 'make me',
                    'bet you', 'is that all', 'show me', 'challenge', 'wager',
                ], KeywordScope.RECENT, { keywordLookback: 3 }),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 0, intervalMax: 0, probability: 0.42, cooldown: 10, initialDelay: 0 },
            },
            {
                key: 'selfish-part',
                name: 'They Say the Selfish Part',
                description: 'Lets a character name a specific desire or selfish motive without laundering it into romance or a reassuring speech.',
                category: EventCategory.PLOT,
                priority: 39,
                ...firstMove('selfish-part', 'When desire is already credible, have the NPC say the particular thing they want from {{user}} and back it with one action they control: an offer, a changed plan, an invitation, or a deliberate risk. Their motive may be petty, convenient, competitive, lonely, or purely physical if that fits. Do not turn the admission into an automatic declaration of love, entitlement, or a summary of {{user}}\'s feelings.'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 8, intervalMax: 16, probability: 0.32, cooldown: 14, initialDelay: 5 },
            },
            {
                key: 'unfinished-part',
                name: 'They Come Back for the Unfinished Part',
                description: 'Lets a character deliberately reopen a specific interrupted opportunity while honoring later refusals or changed circumstances.',
                category: EventCategory.PLOT,
                priority: 37,
                ...firstMove('unfinished-part', 'Only if canon contains a specific mutual or still-open charged moment that was interrupted rather than refused, let the NPC bring that exact loose end back now. They should choose a new concrete tactic shaped by what interrupted them, not merely repeat the old line. Do not invent a prior agreement, treat silence as consent, or pursue after {{user}} has declined or moved on.'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 9, intervalMax: 18, probability: 0.3, cooldown: 16, initialDelay: 6 },
            },
            {
                key: 'manual-first-move',
                name: 'Manual First Move',
                description: 'Adds a send-bar button for one immediate, character-specific move without automatic scheduling.',
                category: EventCategory.CUSTOM,
                priority: 52,
                buttonActivated: true,
                ...firstMove('manual', 'Give a relevant adult NPC one decisive, character-specific move now. Find a credible desire, friction, and tactic in canon, then complete an action they control and leave {{user}} a real choice. Make the choice capable of creating tension or consequences even if {{user}} does not reciprocate. If no sexual premise fits, use a smaller charged move or let the cue pass.'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 1, probability: 0, cooldown: 0, initialDelay: 0 },
            },
        ],
    },
    {
        id: 'bad-ideas',
        version: 2,
        name: 'Bad Ideas',
        description: 'Opt-in darker adult sexual Events gated by Relationship Ledger desire, jealousy, or sexual history and optional Scene State arousal. Each component remains independent and leaves the player response open.',
        tags: ['adult', 'nsfw', 'dark tropes', 'sexual tension', 'character agency'],
        setName: 'Preset — Bad Ideas',
        sharedInstructions: [{
            key: BAD_IDEA_SHARED_KEY,
            name: 'Bad Idea Continuity',
            text: BAD_IDEA_SHARED_TEXT,
        }],
        subjectBinding: {
            label: 'Who makes the bad move',
            description: 'Defaults to the active card. Bind a specific tracked adult character when the card represents a group or scenario.',
            default: { mode: SubjectMode.ACTIVE_CARD, value: '' },
        },
        stateBindings: [
            {
                key: 'relationship',
                label: 'Relationship Ledger desire and jealousy',
                path: 'characters.$subject.attraction',
                description: 'Provides attraction, jealousy, and established sexual-history milestones for the active adult character.',
                preferredSources: ['sa_relationship_ledger'],
            },
            {
                key: 'scene',
                label: 'Scene State arousal',
                path: 'characters.$subject.arousal',
                description: 'Provides an alternate current desire signal when attraction history is unavailable.',
                preferredSources: ['sa_state_card'],
            },
        ],
        events: [
            {
                key: 'affair-starts-here',
                name: 'The Affair Starts Here',
                description: 'An adult NPC in an established exclusive relationship makes a direct sexual invitation despite the betrayal it would entail.',
                category: EventCategory.PLOT,
                priority: 45,
                ...badIdea('affair', 'If {{subject}} or the person they want is already in an exclusive relationship, have {{subject}} make an unmistakable invitation to have sex anyway. Let them choose a time, place, or cover story they can actually arrange. Do not invent a relationship, claim acceptance, or skip ahead to the encounter.'),
                condition: badIdeaDesireRule(),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 14, intervalMax: 24, probability: 0.24, cooldown: 24, initialDelay: 8 },
            },
            {
                key: 'sex-as-revenge',
                name: 'Sex as Revenge',
                description: 'An NPC uses a genuine sexual interest to strike at an established rival or grievance.',
                category: EventCategory.PLOT,
                priority: 42,
                ...badIdea('revenge', 'If {{subject}} has both sexual interest and a specific grievance against someone, have them make a direct sexual move partly to hurt, defy, or outmaneuver that person. Make the target of their revenge and the move itself specific. Desire and spite may coexist; do not replace either with a harmless flirtation.'),
                condition: badIdeaDesireRule(),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 15, intervalMax: 27, probability: 0.23, cooldown: 25, initialDelay: 9 },
            },
            {
                key: 'secret-is-leverage',
                name: 'The Secret Is Leverage',
                description: 'An NPC uses an existing secret to engineer a private, sexually charged confrontation.',
                category: EventCategory.PLOT,
                priority: 44,
                ...badIdea('leverage', 'If {{subject}} holds a real secret that matters to someone they want, have them use that knowledge to arrange a private encounter on their terms. They may show what they know, offer concealment, or make the risk of exposure clear, then state their sexual intent directly. Do not decide whether the other person agrees to anything.'),
                condition: badIdeaDesireRule(),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 16, intervalMax: 28, probability: 0.2, cooldown: 26, initialDelay: 10 },
            },
            {
                key: 'power-gets-personal',
                name: 'Power Gets Personal',
                description: 'An established status or authority gap enters an overt sexual proposition.',
                category: EventCategory.PLOT,
                priority: 45,
                ...badIdea('power', 'If {{subject}} has real authority, status, or control over access that affects the person they want, have them use that advantage to create an opening and make a direct sexual proposition. Show exactly what they control and why the offer is loaded. Do not erase the imbalance or decide the answer.'),
                condition: badIdeaDesireRule(),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 17, intervalMax: 30, probability: 0.2, cooldown: 28, initialDelay: 10 },
            },
            {
                key: 'possessive-display',
                name: 'Possession on Display',
                description: 'Sexual jealousy becomes an overt move meant to provoke an established rival.',
                category: EventCategory.PLOT,
                priority: 41,
                ...badIdea('possessive-display', 'If {{subject}} is sexually interested and an established rival is present or close enough to learn what happens, have them make a possessive sexual proposition or display meant to be noticed. Let jealousy make the choice sharper and less flattering. Do not assign ownership of anyone or decide that the person approached welcomes it.'),
                condition: allStateRules(
                    stateRule('relationship', 'characters.$subject.attraction', 'gte', 40),
                    stateRule('relationship', 'characters.$subject.jealousy', 'gte', 55),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 13, intervalMax: 25, probability: 0.24, cooldown: 23, initialDelay: 8 },
            },
            {
                key: 'corruption-game',
                name: 'The Corruption Game',
                description: 'An NPC deliberately tempts another adult to break a sexual rule or value they have actually expressed.',
                category: EventCategory.PLOT,
                priority: 43,
                ...badIdea('corruption', 'If another adult has clearly stated a sexual boundary, vow, or rule that they are now tempted to reconsider, have {{subject}} knowingly make a sexual offer that tests that exact commitment. Give {{subject}} a personal reason to want the breach. Do not invent the rule, rewrite a refusal as temptation, or decide that the other person gives in.'),
                condition: badIdeaDesireRule(),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 15, intervalMax: 28, probability: 0.22, cooldown: 26, initialDelay: 9 },
            },
            {
                key: 'mutual-ruin',
                name: 'Mutual Ruin',
                description: 'An NPC knowingly restarts a sexual involvement with an established cost for both people.',
                category: EventCategory.PLOT,
                priority: 44,
                ...badIdea('mutual-ruin', 'If {{subject}} and another adult have an established sexual history or live temptation that could seriously damage both their lives, have {{subject}} take a concrete step to restart it now. They may arrive somewhere they promised to avoid, offer a key, change a plan, or make a blunt invitation. Let the risk remain real without jumping ahead to the response or fallout.'),
                condition: badIdeaDesireRule(),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 16, intervalMax: 29, probability: 0.22, cooldown: 27, initialDelay: 10 },
            },
            {
                key: 'manual-bad-idea',
                name: 'Manual Bad Idea',
                description: 'Adds a send-bar button for an immediate dark adult sexual move without automatic scheduling.',
                category: EventCategory.CUSTOM,
                priority: 55,
                buttonActivated: true,
                ...badIdea('manual', 'Choose the strongest established dark sexual premise available now: an affair, revenge, a secret used as leverage, an unequal position, possessive jealousy, deliberate temptation, or mutual ruin. Have {{subject}} make the relevant sexual move immediately. If canon includes an explicit adult consensual control-play arrangement, that may be the premise instead. Leave the response to the person approached open.'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 1, probability: 0, cooldown: 0, initialDelay: 0 },
            },
        ],
    },
    {
        id: 'sexual-complications',
        version: 5,
        name: 'Sexual Complications',
        description: 'Independent adult scene-texture beats that activate from local sexual language or optional Prompt Base, After Dark, and Scene State signals. They add variety after sex is underway without turning it into romance.',
        tags: ['adult', 'nsfw', 'scene texture', 'keywords', 'optional state', 'anti-repetition'],
        setName: 'Preset — Sexual Complications',
        sharedInstructions: [{
            key: SEXUAL_COMPLICATION_SHARED_KEY,
            name: 'Sexual Complication Continuity',
            text: SEXUAL_COMPLICATION_SHARED_TEXT,
        }],
        events: [
            {
                key: 'change-rhythm',
                name: 'Change the Rhythm',
                description: 'Breaks a repetitive sexual loop by changing pace, angle, position, initiative, or focus while preserving the established encounter.',
                category: EventCategory.FLAVOR,
                priority: 34,
                ...sexualComplication('rhythm', 'Change something that physically matters: pace, position, angle, pressure, focus, who takes initiative, or the act itself. Someone adjusts because they want something different or because their body responds to what is happening. Make the change concrete and specific to the character. DON’T describe the same motion with new adjectives or turn the adjustment into an emotional revelation.'),
                condition: sexualActivityRule(),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 2, intervalMax: 5, probability: 0.34, cooldown: 8, initialDelay: 1 },
            },
            {
                key: 'bodies-have-limits',
                name: 'Bodies Have Limits',
                description: 'Makes fatigue, balance, friction, oversensitivity, preparation, refractory response, or another established physical limit matter without automatically ending the scene.',
                category: EventCategory.FLAVOR,
                priority: 32,
                ...sexualComplication('physical-limit', 'Make one believable physical limit matter: fatigue, leverage, balance, reach, flexibility, friction, lube, preparation, soreness, cramping, oversensitivity, breath, refractory time, an existing injury, or anatomy already established. The characters can adjust, use it, joke about it, work around it, or stop. Follow what they actually choose.'),
                condition: sexualActivityRule(),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 3, intervalMax: 7, probability: 0.28, cooldown: 10, initialDelay: 2 },
            },
            {
                key: 'mess-becomes-real',
                name: 'The Mess Becomes Real',
                description: 'Lets sweat, fluids, clothing, bedding, furniture, toys, or cleanup logistics become materially present instead of keeping sex frictionless and pristine.',
                category: EventCategory.FLAVOR,
                priority: 26,
                ...sexualComplication('mess', 'Make the mess physically present: sweat, fluids, smeared makeup, shoved-aside clothing, tangled bedding, a noisy or unstable surface, a lost item, a toy that needs attention, marks, scent, or cleanup. Let someone react in character—amused, annoyed, turned on, practical, embarrassed, territorial about an object, or completely unbothered. DON’T invent permanent marks, damage, exposure, or emotional meaning.'),
                condition: sexualActivityRule(),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 3, intervalMax: 8, probability: 0.28, cooldown: 11, initialDelay: 2 },
            },
            {
                key: 'control-shifts',
                name: 'Control Shifts',
                description: 'Changes who sets the pace or directs the encounter without equating dominance, initiative, or yielding with unlimited permission.',
                category: EventCategory.PLOT,
                priority: 38,
                ...sexualComplication('control-shift', 'Shift who controls one part of the encounter: pace, position, access, attention, restraint, instructions, teasing, denial, or when to continue. Someone may seize it, offer it, fight over it, reverse it for fun, or reveal that the control was never secure. Match established personalities and permissions. Keep the shift limited to this act.'),
                condition: sexualActivityRule(),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 3, intervalMax: 7, probability: 0.3, cooldown: 11, initialDelay: 2 },
            },
            {
                key: 'someone-gets-specific',
                name: 'Someone Gets Specific',
                description: 'Lets an adult participant reveal or act on a concrete preference already supported by behavior, canon, or the present encounter.',
                category: EventCategory.PLOT,
                priority: 36,
                ...sexualComplication('specific-want', 'Let one NPC get specific about what they want next. They can ask, instruct, demonstrate, reposition someone, use an established object, or refuse more generic repetition. Base the want on canon, shown behavior, or the physical logic of this encounter. If no kink is established, choose a simple preference instead of inventing a defining fetish. Desire can be blunt, selfish, playful, technical, shy, demanding, or strange.'),
                condition: sexualActivityRule(),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 3, intervalMax: 7, probability: 0.3, cooldown: 10, initialDelay: 2 },
            },
            {
                key: 'awkward-reality',
                name: 'Awkward Reality Intrudes',
                description: 'Adds an embodied mistake, failed maneuver, inconvenient sound, misplaced object, or unglamorous adjustment without dissolving the erotic scene.',
                category: EventCategory.FLAVOR,
                priority: 24,
                ...sexualComplication('awkward-reality', 'Let one ordinary awkward thing happen: an angle does not work, a maneuver fails, a limb goes numb, somebody makes an inconvenient sound, hair or clothing gets caught, an object goes missing, timing gets crossed, an adjustment is thoroughly unsexy, or somebody laughs at the wrong moment. Let them handle it in character and keep going, redirect, or use it. Keep the response proportionate.'),
                condition: sexualActivityRule(),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 4, intervalMax: 9, probability: 0.24, cooldown: 12, initialDelay: 3 },
            },
            {
                key: 'practical-risk',
                name: 'Practical Risk Matters',
                description: 'Brings an already plausible concern—noise, privacy, protection, contraception, evidence, time, or location—into the encounter without manufacturing a crisis.',
                category: EventCategory.WORLD,
                priority: 34,
                ...sexualComplication('practical-risk', 'Make one practical concern demand attention: noise, privacy, interruption, protection, contraception, lube, cleanup, evidence, time, an unsafe surface, clothes needed afterward, or the limits of this location. It can sharpen the thrill, require an adjustment, start an argument, or force a choice. DON’T invent pregnancy, infection, discovery, punishment, broken equipment, or a new setting rule as an accomplished fact.'),
                condition: sexualActivityRule(),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 4, intervalMax: 9, probability: 0.24, cooldown: 13, initialDelay: 3 },
            },
            {
                key: 'group-geometry',
                name: 'Group Geometry Changes',
                description: 'When recent language establishes multiple adult participants, changes attention, positioning, turn-taking, cooperation, or rivalry instead of reducing the scene to one active pair.',
                category: EventCategory.PLOT,
                priority: 40,
                ...sexualComplication('group-geometry', 'Several participants are involved. Keep everyone physically and socially present instead of letting somebody turn into furniture. Redirect attention, change positions, let someone choose to watch, ask for cooperation, create competition, switch pairings or turns, or give one person a separate want. Keep each person’s knowledge, boundaries, and personality straight. DON’T assume equal enthusiasm, add another participant, or make jealousy romantic by default.'),
                condition: allStateRules(
                    sexualActivityRule(),
                    keywordRule([
                        'both of you',
                        'both of them',
                        'the three of us',
                        'all three of us',
                        'all of us',
                        'take turns',
                        'taking turns',
                        'took turns',
                        'watch us',
                        'watch them',
                        'watched us',
                        'watched them',
                        'join us',
                        'joins them',
                        'joined us',
                        'joined them',
                        'the three of them',
                        'all three of them',
                        'between the two of them',
                        'between both of them',
                    ], KeywordScope.RECENT, { keywordLookback: 4 }),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 4, probability: 0.4, cooldown: 9, initialDelay: 1 },
            },
            {
                key: 'almost-caught',
                name: 'Almost Caught',
                description: 'Adds a credible near-discovery only after sex is underway, creating immediate pressure without automatically stopping or exposing the participants.',
                category: EventCategory.PLOT,
                priority: 30,
                ...sexualComplication('near-discovery', 'Give them one believable sign that privacy may not last: a sound outside, approaching footsteps, a device or signal, a voice, nearby movement, or a schedule catching up. This is almost being caught, not automatic exposure. Let the NPCs freeze, hide evidence, quiet down, hurry, risk it on purpose, enjoy the tension, or stop. DON’T invent surveillance, a voyeur, punishment, or a specific intruder without canon.'),
                condition: sexualActivityRule(),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 7, intervalMax: 14, probability: 0.18, cooldown: 18, initialDelay: 6 },
            },
            {
                key: 'manual-complication',
                name: 'Manual Sexual Complication',
                description: 'Adds a send-bar button for one immediate, scene-specific complication while remaining inert automatically.',
                category: EventCategory.CUSTOM,
                priority: 50,
                buttonActivated: true,
                ...sexualComplication('manual-wildcard', 'Add one strong complication to the encounter right now. Choose whatever would help most—rhythm, position, a physical limit, mess, control, a specific want, a prop, humor, group attention, practical risk, or nearly being caught—and make it change what the NPCs do next. Favor character-specific sexual detail over melodrama, generic escalation, another repetitive climax, or sudden tenderness.'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 1, probability: 0, cooldown: 0, initialDelay: 0 },
            },
        ],
    },
    {
        id: 'aftermath-echoes',
        version: 6,
        name: 'Aftermath & Echoes',
        description: 'Independent adult cooldown beats that notice a recent sexual scene ending through bounded local language, with optional Prompt Base, After Dark, and Scene State confirmation. The pack favors physical, practical, funny, awkward, or unresolved consequences over automatic romance.',
        tags: ['adult', 'nsfw', 'aftermath', 'keywords', 'optional state', 'continuity'],
        setName: 'Preset — Aftermath & Echoes',
        sharedInstructions: [{
            key: SEXUAL_AFTERMATH_SHARED_KEY,
            name: 'Sexual Aftermath Guardrails',
            text: SEXUAL_AFTERMATH_SHARED_TEXT,
        }],
        events: [
            {
                key: 'first-thing-they-do',
                name: 'The First Thing They Do',
                description: 'Gives an adult NPC one immediate, character-specific post-sex action without prescribing affection, regret, or emotional revelation.',
                category: EventCategory.FLAVOR,
                priority: 36,
                ...sexualAftermath('first-reaction', 'Show the first thing one relevant NPC deliberately does when the encounter eases: move away or closer, check their body, reach for something, laugh, stare, complain, clean up, reclaim space, light something, or make a practical demand. Let the action show who they are.'),
                condition: sexualAftermathRule(),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 0, intervalMax: 1, probability: 0.42, cooldown: 8, initialDelay: 0 },
            },
            {
                key: 'bodies-keep-receipt',
                name: 'Bodies Keep the Receipt',
                description: 'Carries one plausible physical consequence of the encounter into the cooldown instead of resetting every body and room to pristine condition.',
                category: EventCategory.FLAVOR,
                priority: 30,
                ...sexualAftermath('physical-residue', 'Keep one believable physical remainder in the scene: cooling sweat, soreness, oversensitivity, fatigue, thirst, scent, fluids, a mark, displaced clothes, tangled hair, an unsteady leg, a cramped muscle, a used object, or disturbed furniture. Let someone respond in character. DON’T invent an injury, pregnancy, infection, permanent mark, or emotional significance.'),
                condition: sexualAftermathRule(),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 0, intervalMax: 2, probability: 0.36, cooldown: 9, initialDelay: 0 },
            },
            {
                key: 'post-sex-mouth',
                name: 'Post-Sex Mouth',
                description: 'Lets the first spoken beat be blunt, funny, technical, awkward, satisfied, critical, or deliberately absent rather than obligatorily tender.',
                category: EventCategory.FLAVOR,
                priority: 34,
                ...sexualAftermath('first-words', 'Give one NPC the first verbal beat—or make their refusal to speak impossible to miss. They might joke, give a practical instruction, criticize, boast, ask a question, make an observation or request, keep the dirty talk going, change the subject, or choose pointed silence. Match their voice.'),
                condition: sexualAftermathRule(),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 0, intervalMax: 2, probability: 0.34, cooldown: 10, initialDelay: 0 },
            },
            {
                key: 'another-round-option',
                name: 'Another Round Is Still an Option',
                description: 'Occasionally preserves unresolved appetite without automatically restarting sex or converting desire into affection.',
                category: EventCategory.PLOT,
                priority: 26,
                ...sexualAftermath('lingering-appetite', 'If an NPC would plausibly want more, leave one small sign: lingering attention, a teasing touch, a blunt offer, refusal to get dressed, competitive dissatisfaction, checking the time, or deliberately leaving access open. Another round is an option, not a foregone conclusion. If nobody wants more, show that the encounter is firmly over instead.'),
                condition: sexualAftermathRule(),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 3, probability: 0.2, cooldown: 14, initialDelay: 1 },
            },
            {
                key: 'group-aftermath',
                name: 'Group Aftermath',
                description: 'When recent language establishes multiple adult participants, keeps the group socially and physically legible after the activity stops.',
                category: EventCategory.PLOT,
                priority: 40,
                ...sexualAftermath('group-aftermath', 'Several participants were involved. Show how they redistribute attention, space, objects, cleanup, privacy, jokes, friction, or plans after the sex eases. Keep every person distinct; their reactions do not need to match. DON’T collapse them into a sudden cuddle pile, invent jealousy, assume equal satisfaction, or forget someone who was there.'),
                condition: allStateRules(
                    sexualAftermathRule(),
                    keywordRule([
                        'both of you',
                        'both of them',
                        'the three of us',
                        'all three of us',
                        'all of us',
                        'take turns',
                        'taking turns',
                        'took turns',
                        'watch us',
                        'watch them',
                        'watched us',
                        'watched them',
                        'join us',
                        'joins them',
                        'joined us',
                        'joined them',
                        'the three of them',
                        'all three of them',
                        'between the two of them',
                        'between both of them',
                    ], KeywordScope.RECENT, { keywordLookback: 5 }),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 0, intervalMax: 2, probability: 0.45, cooldown: 10, initialDelay: 0 },
            },
            {
                key: 'control-residue',
                name: 'Control Does Not Reset Cleanly',
                description: 'Carries a scene-specific power or initiative imbalance into one post-sex choice without turning it into ownership or a new relationship status.',
                category: EventCategory.PLOT,
                priority: 38,
                ...sexualAftermath('control-residue', 'Let the scene’s established balance of initiative or control affect one choice after sex: who moves first, gives an instruction, refuses help, handles cleanup, claims an object, decides whether to stay, restores formal distance, or finds that their authority ended with the act. Keep it limited to the actual dynamic. Let any shift in control end or continue according to the established dynamic.'),
                condition: sexualAftermathRule(),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 0, intervalMax: 2, probability: 0.28, cooldown: 11, initialDelay: 0 },
            },
            {
                key: 'get-dressed-act-normal',
                name: 'Get Dressed, Act Normal',
                description: 'Moves the story back toward duties, secrecy, travel, work, danger, or ordinary routine while preserving physical continuity.',
                category: EventCategory.WORLD,
                priority: 32,
                ...sexualAftermath('return-to-plot', 'Bring one practical reality back: clothes, cleanup, time, privacy, work, duty, travel, danger, someone nearby, a promise, a task, or the need to look normal. Let an NPC start that transition in character. Keep bodies, clothing, objects, and positions continuous. DON’T manufacture an interruption, discovery, punishment, guilt, or relationship talk just to move the plot.'),
                condition: sexualAftermathRule(),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 4, probability: 0.3, cooldown: 12, initialDelay: 1 },
            },
            {
                key: 'evidence-left-behind',
                name: 'Evidence Left Behind',
                description: 'Once per chat, establishes and captures one specific, plausible trace that can matter again later.',
                category: EventCategory.PLOT,
                priority: 42,
                ...sexualAftermath('evidence', 'Leave behind one specific, believable trace: an object out of place, a stain, scent, mark, damaged item, forgotten clothing, changed room detail, message, or noise someone may remember. Nobody has to discover it now, and it does not guarantee exposure. Keep exactly what it is straight for later. After the narrative output: <!--DE:eroticAftermathTrace:SHORT DESCRIPTION OF THE TRACE-->'),
                capture: { enabled: true, varName: 'eroticAftermathTrace' },
                condition: sexualAftermathRule(),
                schedule: { type: ScheduleType.ONE_SHOT, intervalMin: 0, intervalMax: 2, probability: 0.55, cooldown: 0, initialDelay: 0 },
            },
            {
                key: 'evidence-returns',
                name: 'The Evidence Returns',
                description: 'Later brings the captured trace back as a concrete continuity echo without guaranteeing scandal or discovery.',
                requires: ['evidence-left-behind'],
                category: EventCategory.PLOT,
                priority: 44,
                text: '<sexual_aftermath type="echo">Bring this earlier trace back in a concrete way: {{getvar::eroticAftermathTrace}}. Someone may notice it, misread it, recognize it, hide it, remove it, question it, use it, or stumble over it during another task. Keep the exact trace and who could know about it straight. Keep discovery and interpretation contingent on who can encounter the trace.</sexual_aftermath>',
                condition: { type: ConditionType.HAS_FIRED, targetKey: 'evidence-left-behind' },
                schedule: { type: ScheduleType.ONE_SHOT, intervalMin: 6, intervalMax: 14, probability: 0.65, cooldown: 0, initialDelay: 5 },
            },
            {
                key: 'manual-aftermath',
                name: 'Manual Aftermath Wildcard',
                description: 'Adds a send-bar button for one immediate, scene-specific aftermath beat while remaining inert automatically.',
                category: EventCategory.CUSTOM,
                priority: 50,
                buttonActivated: true,
                ...sexualAftermath('manual-wildcard', 'Add one strong aftermath beat the scene can use right now. Choose what fits—body, cleanup, first words, humor, lingering appetite, distance, group dynamics, leftover power, evidence, practical responsibilities, or a return to the larger plot. Make an NPC do something specific. Favor continuity and character over generic cuddling, instant regret, melodrama, romantic validation, or another forced climax.'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 1, probability: 0, cooldown: 0, initialDelay: 0 },
            },
        ],
    },
    {
        id: 'bodies-and-pairings',
        version: 2,
        name: 'Bodies & Pairings',
        description: 'Editable NSFW physical-context routers for the focused character’s established body, m/m, m/f, f/f, or other pairings, and solo, paired, or group participation. It keeps anatomy, positioning, limits, and practical consequences coherent without forcing romance or deciding the player’s response.',
        tags: ['adult', 'nsfw', 'prompt routing', 'bodies', 'pairings', 'group scenes', 'physical continuity'],
        setName: 'Preset — Bodies & Pairings',
        stateBindings: [
            {
                key: 'base',
                label: 'Prompt Base',
                path: 'nsfw',
                preferredSources: ['sa_prompt_base'],
            },
            {
                key: 'nsfw',
                label: 'Prompt NSFW',
                path: 'participantConfiguration',
                preferredSources: ['sa_prompt_nsfw'],
            },
        ],
        routers: [
            {
                key: 'physical-context-outlet',
                name: 'Physical Context',
                description: 'Writes the shared physically coherent NSFW baseline into {{de_nsfw_physical}}.',
                mode: PromptRouterMode.STACK,
                injection: { mode: InjectionMode.MACRO, macroName: 'nsfw_physical' },
                layers: [{
                    name: 'Active sexual context',
                    priority: 10,
                    text: '<nsfw_physicality>Keep track of where everyone is, what their hands, mouths, and limbs are doing, and any clothing, condoms, toys, or furniture involved. Bodies should not teleport between positions. Sex can be awkward, tiring, messy, or physically limited; use lube, preparation, breaks, cleanup, and recovery when the actual act calls for them. Do not invent anatomy, preferences, contraception, protection, or limits that have not been established. Orgasms do not need to happen together—or at all—and they do not automatically end the scene. </nsfw_physicality>',
                    condition: stateRule('base', 'nsfw', 'eq', true),
                }],
            },
            {
                key: 'focus-body-outlet',
                name: 'Focus Body',
                description: 'Selects body-aware guidance for {{de_nsfw_focus_body}} without treating identity as a complete anatomy chart.',
                mode: PromptRouterMode.EXCLUSIVE,
                injection: { mode: InjectionMode.MACRO, macroName: 'nsfw_focus_body' },
                layers: [
                    {
                        name: 'Male focus character',
                        priority: 10,
                        text: '<nsfw_focus_body>The focus character is male. Use what the story has actually established about his body; “male” is not a full anatomy sheet. If he has a cock, balls, and/or prostate, keep erections, precum/cum, sensitivity, overstimulation, and refractory periods physically consistent. Do not assume what equipment he has, whether he is fertile, what role he takes, or how dominant or enduring he is just because he is a man.</nsfw_focus_body>',
                        condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'characterSex', 'eq', 'male')),
                    },
                    {
                        name: 'Female focus character',
                        priority: 10,
                        text: '<nsfw_focus_body>The focus character is female. Use what the story has actually established about her body; “female” is not a full anatomy sheet. If she has a pussy/vulva, vagina, clit, and/or uterus, keep lubrication, sensitivity, overstimulation, muscle fatigue, and pregnancy risk physically consistent. Do not assume what equipment she has, whether she is fertile, what role she takes, or how submissive or enduring she is just because she is a woman.</nsfw_focus_body>',
                        condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'characterSex', 'eq', 'female')),
                    },
                    {
                        name: 'Nonbinary focus character',
                        priority: 10,
                        text: '<nsfw_focus_body>The focus character is nonbinary. Use their established body, pronouns, and preferred words. Being nonbinary does not tell you what genitals they have, whether they are fertile, what role they take, or what kind of sex they like. Describe only what the story has established and what is physically happening now.</nsfw_focus_body>',
                        condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'characterSex', 'eq', 'nonbinary')),
                    },
                    {
                        name: 'Intersex focus character',
                        priority: 10,
                        text: '<nsfw_focus_body>The focus character is intersex. Use the exact anatomy and words already established for them. Do not simplify their body into a male or female template, or invent whatever equipment would make the current act easier to write. Their sex characteristics do not decide their identity, fertility, role, or preferences.</nsfw_focus_body>',
                        condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'characterSex', 'eq', 'intersex')),
                    },
                    {
                        name: 'Genderless focus character',
                        priority: 10,
                        text: '<nsfw_focus_body>The focus character is genderless. Do not write them as a man or woman. Use their established body, pronouns, sexual language, and physical limits; do not invent anatomy or force them into a familiar male/female role.</nsfw_focus_body>',
                        condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'characterSex', 'eq', 'genderless')),
                    },
                    {
                        name: 'Unknown focus body',
                        priority: 10,
                        text: '<nsfw_focus_body>The focus character\'s sex or anatomy is unclear. Stay with visible actions and body details the story has already established. Do not invent genitals, fertility, identity, pronouns, sexual role, or physical abilities just to complete a familiar sex scene.</nsfw_focus_body>',
                        condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'characterSex', 'eq', 'unknown')),
                    },
                ],
            },
            {
                key: 'pairing-context-outlet',
                name: 'Pairing Context',
                description: 'Selects configuration-aware physical guidance for {{de_nsfw_pairing_context}}.',
                mode: PromptRouterMode.EXCLUSIVE,
                injection: { mode: InjectionMode.MACRO, macroName: 'nsfw_pairing_context' },
                layers: [
                    {
                        name: 'M/M pairing',
                        priority: 10,
                        text: '<nsfw_pairing_context>For an m/m scene, do not decide who tops or bottoms from personality or masculinity. Sex does not have to mean penetration; oral, handjobs, frotting, toys, and other established acts are valid. If anal penetration happens, account for preparation, lube, positioning, pace, pain or tearing risk, protection, prostate stimulation, fatigue, oversensitivity, and refractory periods. Penetration and simultaneous orgasms are never required.</nsfw_pairing_context>',
                        condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'pairingType', 'eq', 'm/m')),
                    },
                    {
                        name: 'M/F pairing',
                        priority: 10,
                        text: '<nsfw_pairing_context>For an m/f scene, do not default to penis-in-vagina sex or traditional gender roles. Oral, handjobs, fingering, grinding, toys, anal, and other established acts are just as valid. Pregnancy is only possible when the actual bodies and act make it possible; keep condoms, contraception, preparation, and lube consistent with the story. Account for fatigue, oversensitivity, refractory periods, and orgasms that happen at different times—or not at all.</nsfw_pairing_context>',
                        condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'pairingType', 'eq', 'm/f')),
                    },
                    {
                        name: 'F/F pairing',
                        priority: 10,
                        text: '<nsfw_pairing_context>For an f/f scene, do not default to scissoring or make both bodies react the same way. Use hands, mouths, grinding, different positions, and established toys or barriers with clear physical detail. Account for lube, reach, leverage, muscle fatigue, oversensitivity, and orgasms that happen at different times—or not at all. Do not invent a penis, penetration, or interchangeable bodies to make the scene easier to write.</nsfw_pairing_context>',
                        condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'pairingType', 'eq', 'f/f')),
                    },
                    {
                        name: 'Other or unclear pairing',
                        priority: 10,
                        text: '<nsfw_pairing_context>This scene does not fit cleanly into m/m, m/f, or f/f—or there is not enough information to tell. Use the bodies, identities, words, preferences, and limits the story has actually established. Keep the action physically clear without inventing anatomy or squeezing everyone into a binary script.</nsfw_pairing_context>',
                        condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'pairingType', 'eq', 'other_or_unclear')),
                    },
                ],
            },
            {
                key: 'participant-context-outlet',
                name: 'Participant Context',
                description: 'Selects solo, paired, group, or deliberately uncertain participation guidance for {{de_nsfw_participant_context}}.',
                mode: PromptRouterMode.EXCLUSIVE,
                injection: { mode: InjectionMode.MACRO, macroName: 'nsfw_participant_context' },
                layers: [
                    {
                        name: 'Solo activity',
                        priority: 10,
                        text: '<nsfw_participant_context>One adult is sexually active, with no other confirmed participant. Keep the action centered on that person and whatever parts of their body, objects, and surroundings they can actually use. Watching, receiving a message, or being propositioned does not make someone a participant.</nsfw_participant_context>',
                        condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'participantConfiguration', 'eq', 'solo')),
                    },
                    {
                        name: 'Two participants',
                        priority: 10,
                        text: '<nsfw_participant_context>Two adults are sexually active. Keep track of their positions, what each person can reach, and who starts each action. Their desire, ability, pace, reactions, satisfaction, and orgasms do not need to match.</nsfw_participant_context>',
                        condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'participantConfiguration', 'eq', 'pair')),
                    },
                    {
                        name: 'Group activity',
                        priority: 10,
                        text: '<nsfw_participant_context>Three or more adults are sexually active. Keep track of who is touching whom, what everyone can reach or see, where their attention goes, and who currently has the initiative. People can pause, watch, switch partners, receive unequal attention, react differently, or orgasm at different times; do not turn the group into one synchronized body or leave established participants floating in the background. Being present, aroused, invited, or watching is not the same as joining.</nsfw_participant_context>',
                        condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'participantConfiguration', 'eq', 'group')),
                    },
                    {
                        name: 'Unclear participation',
                        priority: 10,
                        text: '<nsfw_participant_context>It is not clear whether this is solo, paired, or group activity. Only describe people and actions the story has actually established. Presence, watching, fantasy, an invitation, arousal, or standing nearby does not make someone a participant—especially {{user}}.</nsfw_participant_context>',
                        condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'participantConfiguration', 'eq', 'unclear')),
                    },
                ],
            },
        ],
    },
    {
        id: 'first-times-changed-boundaries',
        version: 3,
        name: 'First Times & Changed Boundaries',
        description: 'Character-specific first-time beats and later consequences for explicitly established or revised sexual boundaries. Prompt Base supplies the stable focus character, so each enabled Event remembers the right person instead of spending globally.',
        tags: ['adult', 'nsfw', 'first times', 'boundaries', 'continuity', 'relationship milestones'],
        setName: 'Preset — First Times & Changed Boundaries',
        sharedInstructions: [
            { key: FIRST_TIME_SHARED_KEY, name: 'First Time Continuity', text: FIRST_TIME_SHARED_TEXT },
            { key: CHANGED_BOUNDARY_SHARED_KEY, name: 'Changed Boundary Continuity', text: CHANGED_BOUNDARY_SHARED_TEXT },
        ],
        stateBindings: [
            {
                key: 'base',
                label: 'Prompt Base',
                path: 'focusCharacter',
                description: 'Provides the current focused character as the stable per-subject key.',
                preferredSources: ['sa_prompt_base'],
            },
            {
                key: 'nsfw',
                label: 'Prompt NSFW',
                path: 'firstTimeTogether',
                description: 'Provides evidence-gated first-time, experience, and close-friend context.',
                preferredSources: ['sa_prompt_nsfw'],
            },
            {
                key: 'relationship',
                label: 'Relationship Ledger',
                path: 'characters.$subject.milestones',
                description: 'Provides exact established and revised-boundary milestones for later consequences.',
                preferredSources: ['sa_relationship_ledger'],
            },
        ],
        events: [
            {
                key: 'nobody-knows-the-script',
                name: 'Nobody Knows the Script',
                description: 'Lets a first encounter expose one wrong assumption and create room for an adjustment.',
                category: EventCategory.FLAVOR,
                priority: 43,
                subject: stateValueSubject('base', 'focusCharacter'),
                oncePerSubject: true,
                ...firstTimeBeat('wrong-assumption', 'Let {{subject}} make, notice, or correct one small wrong assumption about how this would go: pace, positioning, preferred words, confidence, a practical detail, or what the other person already knows. Give {{subject}} a concrete response: ask, clarify, adjust, laugh it off, slow down, or try another approach.'),
                condition: allStateRules(
                    stateRule('base', 'nsfw', 'eq', true),
                    stateRule('nsfw', 'firstTimeTogether', 'eq', true),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 3, probability: 0.42, cooldown: 0, initialDelay: 0 },
            },
            {
                key: 'the-bluff-slips',
                name: 'The Bluff Slips',
                description: 'Lets the focused character’s established inexperience show without reducing them to helplessness or shyness.',
                category: EventCategory.FLAVOR,
                priority: 45,
                subject: stateValueSubject('base', 'focusCharacter'),
                oncePerSubject: true,
                ...firstTimeBeat('inexperience-shows', 'Let {{subject}}\'s lack of prior sexual experience show through one character-specific tell: a bluff, an overconfident guess, a practical mistake, a direct question, deliberate observation, copied advice, unexpected caution, or eager experimentation. Inexperience does not make {{subject}} childlike, passive, innocent, submissive, frightened, or incapable.'),
                condition: allStateRules(
                    stateRule('base', 'nsfw', 'eq', true),
                    anyStateRules(
                        stateRule('nsfw', 'virginity', 'eq', 'virgin_character'),
                        stateRule('nsfw', 'virginity', 'eq', 'both'),
                    ),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 3, probability: 0.48, cooldown: 0, initialDelay: 0 },
            },
            {
                key: 'say-it-plainly',
                name: 'Say It Plainly',
                description: 'Gives the focused character one honest preference, uncertainty, or limit to voice in their own manner.',
                category: EventCategory.PLOT,
                priority: 48,
                subject: stateValueSubject('base', 'focusCharacter'),
                oncePerSubject: true,
                ...firstTimeBeat('plain-communication', 'Have {{subject}} plainly communicate one thing that matters right now: a preference, uncertainty, limit, condition, question, practical concern, or request. Phrase it in {{subject}}\'s own voice; blunt, teasing, formal, hesitant, clinical, demanding, or matter-of-fact can all work. Leave the question open.'),
                condition: allStateRules(
                    stateRule('base', 'nsfw', 'eq', true),
                    stateRule('nsfw', 'firstTimeTogether', 'eq', true),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 3, probability: 0.46, cooldown: 0, initialDelay: 0 },
            },
            {
                key: 'laugh-and-recover',
                name: 'Laugh and Recover',
                description: 'Allows a physical or social awkward beat to become character texture rather than failure.',
                category: EventCategory.FLAVOR,
                priority: 38,
                subject: stateValueSubject('base', 'focusCharacter'),
                oncePerSubject: true,
                ...firstTimeBeat('humor-and-recovery', 'Let one imperfect detail happen—a missed cue, awkward angle, uncooperative clothing, noise, cramp, collision, misplaced confidence, or badly timed remark—and let {{subject}} respond in a way that sounds like them. Humor may ease, sharpen, or complicate the moment; let embarrassment fit the characters.'),
                condition: allStateRules(
                    stateRule('base', 'nsfw', 'eq', true),
                    stateRule('nsfw', 'firstTimeTogether', 'eq', true),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 2, intervalMax: 4, probability: 0.34, cooldown: 0, initialDelay: 0 },
            },
            {
                key: 'friends-in-new-territory',
                name: 'Friends in New Territory',
                description: 'Carries an established close friendship into unfamiliar sexual territory without deciding what the relationship becomes.',
                category: EventCategory.PLOT,
                priority: 47,
                subject: stateValueSubject('base', 'focusCharacter'),
                oncePerSubject: true,
                ...firstTimeBeat('friends-crossing-a-line', 'Let the established friendship between {{subject}} and {{user}} matter through one recognizable habit, private joke, old expectation, familiar kindness, known irritation, or moment of startling unfamiliarity. The friendship can help, hinder, or simply color what happens. Let the friendship’s established terms continue to matter.'),
                condition: allStateRules(
                    stateRule('base', 'nsfw', 'eq', true),
                    stateRule('nsfw', 'firstTimeTogether', 'eq', true),
                    stateRule('nsfw', 'closeFriends', 'eq', true),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 3, probability: 0.5, cooldown: 0, initialDelay: 0 },
            },
            {
                key: 'a-pause-changes-the-pace',
                name: 'A Pause Changes the Pace',
                description: 'Lets the focused character reconsider, check, redirect, slow, or stop without scripting the player.',
                category: EventCategory.PLOT,
                priority: 50,
                subject: stateValueSubject('base', 'focusCharacter'),
                oncePerSubject: true,
                ...firstTimeBeat('pace-change', 'Give {{subject}} a reason to pause and change the immediate pace: uncertainty, a physical constraint, a new question, an unexpected reaction, a practical interruption, or simply wanting something different. {{subject}} may check in, redirect, slow down, take a break, or stop. Keep the pause specific to its cause.'),
                condition: allStateRules(
                    stateRule('base', 'nsfw', 'eq', true),
                    stateRule('nsfw', 'firstTimeTogether', 'eq', true),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 3, probability: 0.4, cooldown: 0, initialDelay: 0 },
            },
            {
                key: 'a-stated-limit-matters',
                name: 'A Stated Limit Matters',
                description: 'Lets an explicitly established sexual boundary shape a later choice without inventing its contents.',
                category: EventCategory.PLOT,
                priority: 52,
                subject: stateValueSubject('base', 'focusCharacter'),
                oncePerSubject: true,
                ...changedBoundaryBeat('established-boundary', 'Let an explicitly established sexual boundary involving {{subject}} affect one concrete choice now: what they propose, refuse, avoid, prepare, clarify, or check. Use only terms already present in canon. Respecting a boundary can be quiet and practical; do not turn it into a test, reward, loophole, or proof of virtue.'),
                condition: allStateRules(
                    stateRule('base', 'nsfw', 'eq', true),
                    relationshipMilestone('sexual boundary explicitly established'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 2, probability: 1, cooldown: 0, initialDelay: 0 },
            },
            {
                key: 'the-terms-have-changed',
                name: 'The Terms Have Changed',
                description: 'Makes an explicit boundary revision visible without erasing the old terms or broadening the new ones.',
                category: EventCategory.PLOT,
                priority: 54,
                subject: stateValueSubject('base', 'focusCharacter'),
                oncePerSubject: true,
                ...changedBoundaryBeat('revised-boundary', 'Let an explicitly revised sexual boundary involving {{subject}} alter one concrete interaction. Keep the old term and the exact direction of change straight: broader, narrower, conditional, temporary, or replaced are not interchangeable. The revision applies only as far as canon says and is not blanket consent.'),
                condition: allStateRules(
                    stateRule('base', 'nsfw', 'eq', true),
                    relationshipMilestone('sexual boundary explicitly revised'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 2, probability: 1, cooldown: 0, initialDelay: 0 },
            },
            {
                key: 'the-relationship-has-new-terms',
                name: 'The Relationship Has New Terms',
                description: 'Carries an explicit post-intimacy relationship redefinition forward without treating sex itself as the cause.',
                category: EventCategory.PLOT,
                priority: 55,
                subject: stateValueSubject('base', 'focusCharacter'),
                oncePerSubject: true,
                ...changedBoundaryBeat('relationship-redefined', 'Show one ordinary consequence of the explicitly redefined relationship between {{subject}} and {{user}}: changed language, expectations, privacy, public behavior, logistics, access, or a newly relevant point of friction. The redefinition—not sex by itself—is the authority. It may be closer, more distant, casual, formal, conditional, temporary, or something else canon actually established.'),
                condition: allStateRules(
                    relationshipMilestone('sexual intimacy established'),
                    relationshipMilestone('relationship redefined after sexual intimacy'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 2, probability: 1, cooldown: 0, initialDelay: 0 },
            },
        ],
    },
    {
        id: 'dirty-messages',
        version: 2,
        name: 'Dirty Messages',
        description: 'Private adult communication opportunities for off-screen characters. Each presentation turns the same neutral cue into its own setting-appropriate surface, and SuperAgents preserves the character\'s choice to communicate or withhold.',
        tags: ['adult', 'nsfw', 'private communication', 'off-screen', 'phone', 'autonomy', 'presentation-aware'],
        setName: 'Preset — Dirty Messages',
        subjectBinding: {
            label: 'Who may privately contact {{user}}',
            description: 'Rotates fairly through eligible off-screen characters in Parallel Off-Screen state. The active SuperAgents presentation and the character still decide whether any communication is possible or appropriate.',
            allowStateSource: true,
            default: {
                mode: SubjectMode.STATE_SOURCE,
                providerId: 'superagents',
                source: 'sa_parallel',
                collectionPath: 'characters',
                selection: 'least-recent',
            },
        },
        stateBindings: [
            {
                key: 'parallel',
                label: 'Parallel character state',
                path: 'characters.$subject.status',
                description: 'Provides off-screen status, availability, and current contact intent.',
                preferredSources: ['sa_parallel'],
            },
            {
                key: 'relationship',
                label: 'Relationship Ledger',
                path: 'characters.$subject.attraction',
                description: 'Provides attraction, comfort, familiarity, and explicit intimacy or boundary milestones.',
                preferredSources: ['sa_relationship_ledger'],
            },
        ],
        events: [
            {
                key: 'blunt-invitation',
                name: 'A Blunt Invitation',
                description: 'Lets a strongly attracted off-screen character consider making one direct, character-specific invitation without presuming the player\'s answer.',
                category: EventCategory.PLOT,
                priority: 38,
                text: '',
                actions: [{
                    type: 'superagents.phone',
                    behavior: 'consider',
                    recipient: { mode: 'subject', value: '' },
                    reason: dirtyMessageCue('{{subject}} may make one direct sexual or suggestive invitation that fits their established desire, confidence, and relationship with {{user}}. Keep the proposal specific enough to answer, but do not assume access, mutual desire, acceptance, or any broader permission. Desire may be blunt, playful, formal, awkward, practical, selfish, or restrained without becoming romance.'),
                }],
                condition: allStateRules(
                    stateRule('parallel', 'characters.$subject.status', 'eq', 'off-screen'),
                    stateRule('parallel', 'characters.$subject.availability', 'neq', 'unreachable'),
                    stateRule('relationship', 'characters.$subject.attraction', 'gte', 60),
                    anyStateRules(
                        stateRule('relationship', 'characters.$subject.comfort', 'gte', 30),
                        stateRule('relationship', 'characters.$subject.familiarity', 'gte', 40),
                    ),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 12, intervalMax: 24, probability: 0.3, cooldown: 18, initialDelay: 8 },
            },
            {
                key: 'unfinished-business',
                name: 'Unfinished Business',
                description: 'Lets an established interrupted encounter, proposition, or charged exchange resurface without inventing one.',
                category: EventCategory.PLOT,
                priority: 36,
                text: '',
                actions: [{
                    type: 'superagents.phone',
                    behavior: 'consider',
                    recipient: { mode: 'subject', value: '' },
                    reason: dirtyMessageCue('A real encounter, proposition, or charged exchange involving {{subject}} and {{user}} may have left unfinished business. Only use one specific loose end already established in canon. {{subject}} may reopen it, clarify it, challenge it, postpone it, or deliberately leave it unresolved; do not invent a prior promise, act, or agreement.'),
                }],
                condition: allStateRules(
                    stateRule('parallel', 'characters.$subject.status', 'eq', 'off-screen'),
                    stateRule('parallel', 'characters.$subject.availability', 'neq', 'unreachable'),
                    anyStateRules(
                        stateRule('relationship', 'characters.$subject.milestones', 'contains', 'sexual intimacy established'),
                        allStateRules(
                            stateRule('relationship', 'characters.$subject.attraction', 'gte', 45),
                            stateRule('relationship', 'characters.$subject.familiarity', 'gte', 30),
                        ),
                    ),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 14, intervalMax: 28, probability: 0.28, cooldown: 20, initialDelay: 10 },
            },
            {
                key: 'loaded-follow-up',
                name: 'A Loaded Follow-Up',
                description: 'Lets a character with established shared sexual history make one specific callback in their own register.',
                category: EventCategory.FLAVOR,
                priority: 30,
                text: '',
                actions: [{
                    type: 'superagents.phone',
                    behavior: 'consider',
                    recipient: { mode: 'subject', value: '' },
                    reason: dirtyMessageCue('{{subject}} and {{user}} have established sexual history. {{subject}} may make one loaded follow-up rooted in an exact encounter, remark, preference, joke, consequence, or unresolved detail already in canon. It can tease, provoke, complain, boast, ask, or stay deliberately understated. Shared history is not blanket consent, romance, satisfaction, or permission to invent what happened.'),
                }],
                condition: allStateRules(
                    stateRule('parallel', 'characters.$subject.status', 'eq', 'off-screen'),
                    stateRule('parallel', 'characters.$subject.availability', 'neq', 'unreachable'),
                    stateRule('relationship', 'characters.$subject.milestones', 'contains', 'sexual intimacy established'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 10, intervalMax: 22, probability: 0.34, cooldown: 16, initialDelay: 8 },
            },
            {
                key: 'practical-question',
                name: 'A Practical Question',
                description: 'Creates room for an established intimate connection to ask one concrete question about logistics, preferences, or boundaries.',
                category: EventCategory.PLOT,
                priority: 40,
                text: '',
                actions: [{
                    type: 'superagents.phone',
                    behavior: 'consider',
                    recipient: { mode: 'subject', value: '' },
                    reason: dirtyMessageCue('{{subject}} may ask {{user}} one concrete question about timing, privacy, access, protection, contraception, health, preferences, boundaries, preparation, cleanup, or another practical detail that the established connection makes reasonable to discuss. Ask rather than answer for {{user}}. Do not invent a risk, prior agreement, body fact, preference, or changed boundary to justify the question.'),
                }],
                condition: allStateRules(
                    stateRule('parallel', 'characters.$subject.status', 'eq', 'off-screen'),
                    stateRule('parallel', 'characters.$subject.availability', 'neq', 'unreachable'),
                    anyStateRules(
                        stateRule('relationship', 'characters.$subject.milestones', 'contains', 'sexual intimacy established'),
                        stateRule('relationship', 'characters.$subject.milestones', 'contains', 'sexual boundary explicitly established'),
                        stateRule('relationship', 'characters.$subject.milestones', 'contains', 'sexual boundary explicitly revised'),
                    ),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 14, intervalMax: 30, probability: 0.3, cooldown: 22, initialDelay: 10 },
            },
            {
                key: 'terrible-timing',
                name: 'Terrible Timing',
                description: 'Lets a provocative private communication arrive only when the current context makes its timing genuinely awkward and plausible.',
                category: EventCategory.FLAVOR,
                priority: 34,
                text: '',
                actions: [{
                    type: 'superagents.phone',
                    behavior: 'consider',
                    recipient: { mode: 'subject', value: '' },
                    reason: dirtyMessageCue('If a provocative private communication from {{subject}} could plausibly reach {{user}} at a genuinely inconvenient, awkward, distracting, public, dangerous, or high-stakes moment established in the current scene, {{subject}} may initiate it now. They may know the timing is bad, exploit it, or be completely unaware. Do not invent witnesses, expose private contents to bystanders, create an interruption, or bypass realistic delivery limits merely to force the joke.'),
                }],
                condition: allStateRules(
                    stateRule('parallel', 'characters.$subject.status', 'eq', 'off-screen'),
                    stateRule('parallel', 'characters.$subject.availability', 'neq', 'unreachable'),
                    anyStateRules(
                        stateRule('relationship', 'characters.$subject.milestones', 'contains', 'sexual intimacy established'),
                        allStateRules(
                            stateRule('relationship', 'characters.$subject.attraction', 'gte', 55),
                            stateRule('relationship', 'characters.$subject.comfort', 'gte', 30),
                        ),
                    ),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 16, intervalMax: 32, probability: 0.24, cooldown: 24, initialDelay: 12 },
            },
            {
                key: 'almost-too-honest',
                name: 'Almost Too Honest',
                description: 'Lets attraction produce an unusually candid private thought while preserving the character\'s option to soften or withhold it.',
                category: EventCategory.FLAVOR,
                priority: 32,
                text: '',
                actions: [{
                    type: 'superagents.phone',
                    behavior: 'consider',
                    recipient: { mode: 'subject', value: '' },
                    reason: dirtyMessageCue('{{subject}} may communicate something unusually candid about their desire, curiosity, memory, fantasy, frustration, or intention toward {{user}}. Keep it true to what {{subject}} could admit and to what canon supports. They may state it plainly, disguise it, soften it, redirect it, or withhold it entirely. Sexual honesty is not automatically a love confession, relationship proposal, demand, or promise.'),
                }],
                condition: allStateRules(
                    stateRule('parallel', 'characters.$subject.status', 'eq', 'off-screen'),
                    stateRule('parallel', 'characters.$subject.availability', 'neq', 'unreachable'),
                    stateRule('relationship', 'characters.$subject.attraction', 'gte', 50),
                    anyStateRules(
                        stateRule('relationship', 'characters.$subject.comfort', 'gte', 25),
                        stateRule('relationship', 'characters.$subject.familiarity', 'gte', 30),
                    ),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 14, intervalMax: 28, probability: 0.26, cooldown: 20, initialDelay: 10 },
            },
        ],
        tracks: [],
    },
    {
        id: 'adaptive-prompt-starter',
        version: 4,
        name: 'Adaptive Prompt Kit',
        description: 'A practical example of staged prompt composition. Prompt Base always classifies the scene; Prompt NSFW is called only when Base says it is needed. Each concise fragment has its own macro outlet for placement in an ordinary preset.',
        tags: ['prompt routing', 'macros', 'conditional agents', 'example'],
        setName: 'Preset — Adaptive Prompt Kit',
        stateBindings: [
            {
                key: 'base',
                label: 'Prompt Base',
                path: 'nsfw',
                preferredSources: ['sa_prompt_base'],
            },
            {
                key: 'nsfw',
                label: 'Prompt NSFW',
                path: 'characterSex',
                preferredSources: ['sa_prompt_nsfw'],
            },
        ],
        routers: [
            {
                key: 'author-outlet',
                name: 'Author Style Outlet',
                description: 'Writes the classified author into {{de_author}}.',
                mode: PromptRouterMode.EXCLUSIVE,
                injection: { mode: InjectionMode.MACRO, macroName: 'author' },
                layers: [{
                    name: 'Selected author',
                    priority: 10,
                    text: '<author_style>Write this response in the style of {{conditionValue}}. If they wrote in another language, use the style of their English translations.</author_style>',
                    condition: stateRule('base', 'author', 'exists', ''),
                }],
            },
            {
                key: 'focus-character-outlet',
                name: 'Focus Character Outlet',
                description: 'Writes the classified focus character into {{de_focus_character}}.',
                mode: PromptRouterMode.EXCLUSIVE,
                injection: { mode: InjectionMode.MACRO, macroName: 'focus_character' },
                layers: [{
                    name: 'Selected focus character',
                    priority: 10,
                    text: '<focus_character>The focus character for this response is {{conditionValue}}. Stay close to what they notice, feel, decide, say, and do. Other characters can still act, but this character should carry the scene.</focus_character>',
                    condition: stateRule('base', 'focusCharacter', 'exists', ''),
                }],
            },
            {
                key: 'character-mood-outlet',
                name: 'Character Mood Outlet',
                description: 'Selects one mood direction and exposes it as {{de_character_mood}}. Neutral intentionally produces nothing.',
                mode: PromptRouterMode.EXCLUSIVE,
                injection: { mode: InjectionMode.MACRO, macroName: 'character_mood' },
                layers: [
                    {
                        name: 'Sad',
                        priority: 10,
                        text: '<character_mood>The focus character is sad. Let it affect what they notice, how much energy they have, what they avoid, and how they talk. Depending on the character, they might become quiet, pessimistic, short-tempered, numb, or clingy; do not make every sad person cry or confess.</character_mood>',
                        condition: stateRule('base', 'mood', 'eq', 'sad'),
                    },
                    {
                        name: 'Angry',
                        priority: 10,
                        text: '<character_mood>The focus character is angry. Let it affect their judgment, attention, dialogue, and choices. They might become cold, petty, reckless, sharp, cruel, or openly furious depending on who they are; not every angry character needs to shout.</character_mood>',
                        condition: stateRule('base', 'mood', 'eq', 'angry'),
                    },
                    {
                        name: 'Afraid',
                        priority: 10,
                        text: '<character_mood>The focus character is afraid. Fear should affect what they notice and what they are willing to risk. They might freeze, flee, panic, make paranoid assumptions, hide it behind anger, or lash out; do not reduce fear to trembling and stammering.</character_mood>',
                        condition: stateRule('base', 'mood', 'eq', 'afraid'),
                    },
                    {
                        name: 'Romantic',
                        priority: 10,
                        text: '<character_mood>The focus character feels romantic. Let that show through character-specific tenderness, hope, awkwardness, yearning, or attention. Let the degree of openness fit the character.</character_mood>',
                        condition: stateRule('base', 'mood', 'eq', 'romantic'),
                    },
                    {
                        name: 'Sexy',
                        priority: 10,
                        text: '<character_mood>The focus character is sexually interested. Let it affect what catches their eye, their body language, and the choices they make; they can flirt, proposition, or initiate when it fits them. Let the scene set the pace.</character_mood>',
                        condition: stateRule('base', 'mood', 'eq', 'sexy'),
                    },
                ],
            },
            {
                key: 'impaired-outlet',
                name: 'Impairment Outlet',
                description: 'Exposes active impairment as {{de_character_impaired}}.',
                mode: PromptRouterMode.STACK,
                injection: { mode: InjectionMode.MACRO, macroName: 'character_impaired' },
                layers: [{ name: 'Impaired', priority: 10, text: '<character_condition>The focus character is impaired. Keep the effects of whatever they took consistent: their coordination, judgment, memory, inhibitions, speech, or reaction time may change depending on the substance and amount. Do not make them conveniently sober when the plot needs it, and do not treat impairment as automatic sexual consent.</character_condition>', condition: stateRule('base', 'impaired', 'eq', true) }],
            },
            {
                key: 'injured-outlet',
                name: 'Recent Injury Outlet',
                description: 'Exposes a recent injury as {{de_character_injured}}.',
                mode: PromptRouterMode.STACK,
                injection: { mode: InjectionMode.MACRO, macroName: 'character_injured' },
                layers: [{ name: 'Recently injured', priority: 10, text: '<character_condition>The focus character is injured. Keep the pain, limited movement, treatment, and risk of making it worse consistent; do not forget the injury as soon as they need to fight, run, or have sex. It should affect the scene without becoming their only trait.</character_condition>', condition: stateRule('base', 'injured', 'eq', true) }],
            },
            {
                key: 'violence-outlet',
                name: 'Violence Outlet',
                description: 'Exposes active violence as {{de_violence}}.',
                mode: PromptRouterMode.STACK,
                injection: { mode: InjectionMode.MACRO, macroName: 'violence' },
                layers: [{ name: 'Violence', priority: 10, text: '<violence>Write violence as actual action, not vague commotion. Keep positions clear and use the characters’ skill, mistakes, surroundings, and whatever is within reach. Hits should have consequences and major characters can get hurt; do not turn every movement into slow motion or every injury into gore unless the story calls for it.</violence>', condition: stateRule('base', 'violence', 'eq', true) }],
            },
            {
                key: 'nsfw-core-outlet',
                name: 'NSFW Core Outlet',
                description: 'Exposes the shared NSFW baseline as {{de_nsfw_core}}.',
                mode: PromptRouterMode.STACK,
                injection: { mode: InjectionMode.MACRO, macroName: 'nsfw_core' },
                layers: [{ name: 'NSFW', priority: 10, text: '<sexuality>Write sex clearly and explicitly, using blunt words instead of vague euphemisms. Take your time with the physical action and character-specific reactions; do not race everyone toward penetration or orgasm.</sexuality>', condition: stateRule('base', 'nsfw', 'eq', true) }],
            },
            {
                key: 'nsfw-character-sex-outlet',
                name: 'NSFW Character Sex Outlet',
                description: 'Selects anatomy/identity guidance as {{de_nsfw_character_sex}}.',
                mode: PromptRouterMode.EXCLUSIVE,
                injection: { mode: InjectionMode.MACRO, macroName: 'nsfw_character_sex' },
                layers: [
                    { name: 'Male', priority: 10, text: '<nsfw_character>The focus character is male. Use the body and sexual language already established for him; do not treat “male” as a complete anatomy sheet or assume his role, fertility, dominance, or stamina.</nsfw_character>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'characterSex', 'eq', 'male')) },
                    { name: 'Female', priority: 10, text: '<nsfw_character>The focus character is female. Use the body and sexual language already established for her; do not treat “female” as a complete anatomy sheet or assume her role, fertility, submission, or stamina.</nsfw_character>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'characterSex', 'eq', 'female')) },
                    { name: 'Genderless', priority: 10, text: '<nsfw_character>The focus character is genderless. Do not write them as a man or woman. Use only their established body, pronouns, sexual language, and physical limits.</nsfw_character>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'characterSex', 'eq', 'genderless')) },
                    { name: 'Nonbinary', priority: 10, text: '<nsfw_character>The focus character is nonbinary. Use their established identity, pronouns, body, and preferred words; being nonbinary does not tell you what genitals they have or what kind of sex they like.</nsfw_character>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'characterSex', 'eq', 'nonbinary')) },
                    { name: 'Intersex', priority: 10, text: '<nsfw_character>The focus character is intersex. Use the exact body and language already established for them. Do not simplify them into a male or female template, or invent whatever anatomy would make the scene easier to write.</nsfw_character>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'characterSex', 'eq', 'intersex')) },
                    { name: 'Unknown', priority: 10, text: '<nsfw_character>The focus character\'s anatomy is unclear. Stay with visible actions and body details the story has already established; do not invent genitals, fertility, identity, or sexual role.</nsfw_character>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'characterSex', 'eq', 'unknown')) },
                ],
            },
            {
                key: 'nsfw-pairing-outlet',
                name: 'NSFW Pairing Outlet',
                description: 'Selects body-configuration guidance as {{de_nsfw_pairing}}.',
                mode: PromptRouterMode.EXCLUSIVE,
                injection: { mode: InjectionMode.MACRO, macroName: 'nsfw_pairing' },
                layers: [
                    { name: 'M/M', priority: 10, text: '<nsfw_pairing>For an m/m scene, do not decide who tops or bottoms from personality or masculinity. Oral, handjobs, frotting, toys, and other acts are valid; if anal happens, use preparation and lube and keep pain, protection, prostate sensitivity, fatigue, and refractory periods realistic.</nsfw_pairing>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'pairingType', 'eq', 'm/m')) },
                    { name: 'M/F', priority: 10, text: '<nsfw_pairing>For an m/f scene, do not default to penis-in-vagina sex or traditional gender roles. Oral, handjobs, fingering, toys, anal, and other acts are valid. Pregnancy risk only applies when the actual bodies and act make it possible; keep contraception, condoms, preparation, lube, fatigue, and refractory periods consistent.</nsfw_pairing>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'pairingType', 'eq', 'm/f')) },
                    { name: 'F/F', priority: 10, text: '<nsfw_pairing>For an f/f scene, do not default to scissoring or make both bodies react the same way. Use hands, mouths, grinding, different positions, and established toys or barriers. Keep lube, reach, muscle fatigue, oversensitivity, and staggered orgasms physically consistent.</nsfw_pairing>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'pairingType', 'eq', 'f/f')) },
                    { name: 'Other or unclear', priority: 10, text: '<nsfw_pairing>This scene does not fit cleanly into m/m, m/f, or f/f—or there is not enough information to tell. Use the bodies, identities, words, preferences, and limits the story has actually established; do not invent anatomy or squeeze everyone into a binary script.</nsfw_pairing>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'pairingType', 'eq', 'other_or_unclear')) },
                ],
            },
            {
                key: 'nsfw-virginity-outlet',
                name: 'NSFW Virginity Outlet',
                description: 'Selects virginity guidance as {{de_nsfw_virginity}}.',
                mode: PromptRouterMode.EXCLUSIVE,
                injection: { mode: InjectionMode.MACRO, macroName: 'nsfw_virginity' },
                layers: [
                    { name: 'Virgin character', priority: 10, text: '<nsfw_addendum>The focus character has no prior sexual experience. Let that matter without turning them helpless or childlike: they might bluff, ask questions, imitate what they think they know, make mistakes, become careful, or be surprisingly eager depending on who they are.</nsfw_addendum>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'virginity', 'eq', 'virgin_character')) },
                    { name: 'Virgin user', priority: 10, text: '<nsfw_addendum>{{user}} has no prior sexual experience. The focus character only knows this if {{user}} told them or they have another believable reason to know. Let the character respond in their own way.</nsfw_addendum>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'virginity', 'eq', 'virgin_user')) },
                    { name: 'Both virgins', priority: 10, text: '<nsfw_addendum>Neither the focus character nor {{user}} has prior sexual experience. Let that affect confidence, communication, pacing, and practical mistakes, but do not make them identical or automatically shy and tender.</nsfw_addendum>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'virginity', 'eq', 'both')) },
                ],
            },
            {
                key: 'nsfw-first-time-outlet',
                name: 'NSFW First Time Together Outlet',
                description: 'Exposes first-time-together guidance as {{de_nsfw_first_time}}.',
                mode: PromptRouterMode.STACK,
                injection: { mode: InjectionMode.MACRO, macroName: 'nsfw_first_time' },
                layers: [{ name: 'First time together', priority: 10, text: '<nsfw_addendum>This is the first time the focus character and {{user}} have had sex together. Even if they are experienced separately, they do not automatically know each other\'s body, preferences, limits, or habits. Let discovery, communication, wrong guesses, and adjustment matter. A first time does not need to be tender, romantic, awkward, or life-changing.</nsfw_addendum>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'firstTimeTogether', 'eq', true)) }],
            },
            {
                key: 'nsfw-close-friends-outlet',
                name: 'NSFW Close Friends Outlet',
                description: 'Exposes the close-friends dynamic as {{de_nsfw_close_friends}}.',
                mode: PromptRouterMode.STACK,
                injection: { mode: InjectionMode.MACRO, macroName: 'nsfw_close_friends' },
                layers: [{ name: 'Close friends', priority: 10, text: '<nsfw_addendum>The focus character and {{user}} are close friends. Their history can make sex easier, funnier, more awkward, more competitive, or unexpectedly strange depending on who they are. Keep their usual way of talking to each other.</nsfw_addendum>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'closeFriends', 'eq', true)) }],
            },
            {
                key: 'nsfw-family-outlet',
                name: 'NSFW Family Outlet',
                description: 'Exposes the family dynamic as {{de_nsfw_family}}.',
                mode: PromptRouterMode.STACK,
                injection: { mode: InjectionMode.MACRO, macroName: 'nsfw_family' },
                layers: [{ name: 'Family', priority: 10, text: '<nsfw_addendum>The focus character and {{user}} are family. Keep their actual family dynamic and the taboo present: familiarity, hierarchy, rivalry, resentment, affection, secrecy, and practical risk can all matter depending on the story.</nsfw_addendum>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'family', 'eq', true)) }],
            },
        ],
    },
    {
        id: 'phone-story-beats',
        version: 2,
        name: 'Phone Story Beats',
        description: 'Optional off-screen communication beats powered by SuperAgents Phone. Each component is independent, editable, and installed disabled.',
        tags: ['phone', 'off-screen', 'communication'],
        setName: 'Preset — Phone Story Beats',
        events: [
            {
                key: 'off-screen-check-in',
                name: 'Off-Screen Check-In',
                description: 'Occasionally lets the active character consider a natural check-in when they are plausibly away from the user.',
                category: EventCategory.FLAVOR,
                priority: 15,
                text: '',
                actions: [{
                    type: 'superagents.phone',
                    behavior: 'consider',
                    recipient: { mode: 'active-character', value: '' },
                    reason: '{{char}} may have a natural reason to check in with {{user}} while they are apart. Only send a text if they are actually off-screen from each other and the timing, relationship, and message sound like {{char}}.',
                }],
                schedule: { type: ScheduleType.RECURRING, intervalMin: 8, intervalMax: 16, probability: 0.35, cooldown: 12, initialDelay: 6 },
            },
            {
                key: 'unfinished-conversation',
                name: 'Unfinished Conversation',
                description: 'Gives an unresolved exchange or emotional loose end one chance to surface through a text.',
                category: EventCategory.PLOT,
                priority: 25,
                text: '',
                actions: [{
                    type: 'superagents.phone',
                    behavior: 'consider',
                    recipient: { mode: 'active-character', value: '' },
                    reason: '{{char}} may text about one specific conversation, question, promise, disagreement, or emotional loose end that is still unfinished. Use something already in the story; DON’T invent unfinished business just to produce a message.',
                }],
                schedule: { type: ScheduleType.ONE_SHOT, intervalMin: 10, intervalMax: 20, probability: 0.55, cooldown: 0, initialDelay: 18 },
            },
            {
                key: 'urgent-practical-message',
                name: 'Urgent Practical Message',
                description: 'Rarely guarantees a Phone attempt about a concrete, setting-appropriate development that needs the user’s attention.',
                category: EventCategory.WORLD,
                priority: 45,
                text: '',
                actions: [{
                    type: 'superagents.phone',
                    behavior: 'send',
                    recipient: { mode: 'active-character', value: '' },
                    reason: '{{char}} has a concrete, urgent, practical reason to text {{user}}. Keep the message concise and give {{user}} something they can act on. DON’T invent a catastrophe or decide what {{user}} does about it.',
                }],
                schedule: { type: ScheduleType.ONE_SHOT, intervalMin: 18, intervalMax: 35, probability: 0.35, cooldown: 0, initialDelay: 35 },
            },
        ],
    },
    {
        id: 'lives-beyond-the-scene',
        version: 4,
        name: 'Lives Beyond the Scene',
        description: 'Surfaces character initiative, competing obligations, off-screen consequences, approaching intersections, and optional own-life Phone updates from validated Parallel Off-Screen state.',
        tags: ['initiative', 'off-screen life', 'autonomy', 'social world', 'phone'],
        setName: 'Preset — Lives Beyond the Scene',
        subjectBinding: {
            label: 'Whose independent life may surface',
            description: 'At runtime, each Event checks all characters in Parallel Off-Screen, chooses only from those who satisfy its conditions, and rotates fairly among them. You can still choose a fixed character instead.',
            allowStateSource: true,
            default: {
                mode: SubjectMode.STATE_SOURCE,
                providerId: 'superagents',
                source: 'sa_parallel',
                collectionPath: 'characters',
                selection: 'least-recent',
            },
        },
        stateBindings: [
            {
                key: 'parallel',
                label: 'Parallel character state',
                path: 'characters.$subject.status',
                description: 'Validated independent-life state produced by SuperAgents Parallel Off-Screen.',
                preferredSources: ['sa_parallel'],
            },
        ],
        events: [
            {
                key: 'independent-agenda',
                name: 'Independent Agenda',
                description: 'While present, lets the subject take one proportionate step toward an established goal of their own.',
                category: EventCategory.FLAVOR,
                priority: 25,
                text: '<character_initiative subject="{{subject}}">Use {{subject}}’s CURRENT PARALLEL CHARACTER STATE. If the scene gives them an opening, let {{subject}} take one small, concrete step toward their goal or next action. Match the elapsed time, personality, availability, and canon. It does not have to involve {{user}}; it might be an invitation, boundary, request, refusal, departure, or NPC-to-NPC interaction. DON’T choose {{user}}’s response or finish a major irreversible outcome without setup.</character_initiative>',
                condition: allStateRules(
                    stateRule('parallel', 'characters.$subject.status', 'eq', 'present'),
                    stateRule('parallel', 'characters.$subject.nextAction', 'exists', ''),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 10, intervalMax: 18, probability: 0.4, cooldown: 14, initialDelay: 8 },
            },
            {
                key: 'competing-obligation',
                name: 'Competing Obligation',
                description: 'Allows an established duty, plan, or relationship to limit the subject’s availability without manufacturing drama.',
                category: EventCategory.FLAVOR,
                priority: 30,
                text: '<character_initiative subject="{{subject}}">{{subject}} has their own schedule, goal, and current activity. Let one of those put a believable limit on this interaction. They may delay, split their attention, say no, leave, reschedule, protect another commitment, or ask for an accommodation. Make it sound like {{subject}} and leave room to negotiate. DON’T invent a crisis, punish {{user}}, or treat affection as unlimited availability.</character_initiative>',
                condition: allStateRules(
                    stateRule('parallel', 'characters.$subject.status', 'eq', 'present'),
                    anyStateRules(
                        stateRule('parallel', 'characters.$subject.availability', 'eq', 'limited'),
                        stateRule('parallel', 'characters.$subject.availability', 'eq', 'busy'),
                    ),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 14, intervalMax: 24, probability: 0.3, cooldown: 18, initialDelay: 12 },
            },
            {
                key: 'offscreen-consequence',
                name: 'Off-Screen Consequence',
                description: 'Lets a small result of prior off-screen activity become perceptible through an appropriate channel.',
                category: EventCategory.WORLD,
                priority: 35,
                text: '<offscreen_consequence subject="{{subject}}">Use {{subject}}’s CURRENT PARALLEL CHARACTER STATE. Show one small consequence only if the current viewpoint has a believable way to notice it. Private information needs direct disclosure. Shared information needs the right social connection. Public information can arrive through posts, notices, witnesses, or ordinary observation. Hidden information stays hidden. Show evidence, changed availability, rumor, a message, or another concrete effect instead of explaining everything from above. Keep uncertainty intact and DON’T choose {{user}}’s reaction.</offscreen_consequence>',
                condition: allStateRules(
                    anyStateRules(
                        stateRule('parallel', 'characters.$subject.status', 'eq', 'off-screen'),
                        stateRule('parallel', 'characters.$subject.status', 'eq', 'approaching-scene'),
                    ),
                    stateRule('parallel', 'characters.$subject.visibility', 'neq', 'hidden'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 18, intervalMax: 30, probability: 0.3, cooldown: 24, initialDelay: 16 },
            },
            {
                key: 'approaching-intersection',
                name: 'Approaching Intersection',
                description: 'Gives an imminent tracked thread one restrained chance to intersect the active scene.',
                category: EventCategory.PLOT,
                priority: 55,
                text: '<offscreen_intersection subject="{{subject}}">What {{subject}} is doing off-screen is about to cross into the current scene. Show the next observable edge: an arrival, contact, evidence, a third party, or a consequence. DON’T teleport anyone, skip required travel, resolve the whole thread, or choose for {{user}}. If the viewpoint cannot see the intersection yet, show only a believable warning sign.</offscreen_intersection>',
                condition: anyStateRules(
                    stateRule('parallel', 'characters.$subject.status', 'eq', 'approaching-scene'),
                    stateRule('parallel', 'characters.$subject.relevance', 'eq', 'imminent'),
                ),
                schedule: { type: ScheduleType.ONE_SHOT, intervalMin: 4, intervalMax: 10, probability: 0.75, cooldown: 0, initialDelay: 2 },
            },
            {
                key: 'own-life-update',
                name: 'Own-Life Update',
                description: 'Lets an absent subject consider texting because of their own activity, goal, or social life—not merely to check on the user.',
                category: EventCategory.FLAVOR,
                priority: 20,
                text: '',
                actions: [{
                    type: 'superagents.phone',
                    behavior: 'consider',
                    recipient: { mode: 'subject', value: '' },
                    reason: '{{subject}} may have a reason from their own life to contact {{user}}. Use their current activity, goal, next action, availability, contact intent, visibility, and social targets. A text might share a development, invitation, practical update, complaint, small win, question, photo-worthy moment, or social situation. Respect privacy and timing. DON’T text just because they miss {{user}}; send nothing if contact does not fit.',
                }],
                condition: allStateRules(
                    anyStateRules(
                        stateRule('parallel', 'characters.$subject.status', 'eq', 'off-screen'),
                        stateRule('parallel', 'characters.$subject.status', 'eq', 'approaching-scene'),
                    ),
                    anyStateRules(
                        stateRule('parallel', 'characters.$subject.contactIntent', 'eq', 'maybe'),
                        stateRule('parallel', 'characters.$subject.contactIntent', 'eq', 'likely'),
                        stateRule('parallel', 'characters.$subject.contactIntent', 'eq', 'urgent'),
                    ),
                    stateRule('parallel', 'characters.$subject.availability', 'neq', 'unreachable'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 12, intervalMax: 24, probability: 0.35, cooldown: 18, initialDelay: 10 },
            },
        ],
        tracks: [],
    },
    {
        id: 'social-ripples',
        version: 2,
        name: 'Social Ripples',
        description: 'Lets shareable edges of independent character lives surface through SuperAgents Feed, with privacy-aware posting and plausible social responses.',
        tags: ['feed', 'social world', 'off-screen life', 'privacy', 'relationships'],
        setName: 'Preset — Social Ripples',
        subjectBinding: {
            label: 'Whose social life may surface',
            description: 'Rotates fairly through active Parallel Off-Screen characters. Feed still makes the final publish/withhold decision.',
            allowStateSource: true,
            default: {
                mode: SubjectMode.STATE_SOURCE,
                providerId: 'superagents',
                source: 'sa_parallel',
                collectionPath: 'characters',
                selection: 'least-recent',
            },
        },
        stateBindings: [{
            key: 'parallel',
            label: 'Parallel character state',
            path: 'characters.$subject.status',
            description: 'Validated independent-life state produced by SuperAgents Parallel Off-Screen.',
            preferredSources: ['sa_parallel'],
        }],
        events: [
            {
                key: 'shareable-edge',
                name: 'Shareable Edge',
                description: 'Asks an off-screen subject whether one edge of their current life is something they would genuinely share.',
                category: EventCategory.FLAVOR,
                priority: 18,
                text: '',
                actions: [{
                    type: 'superagents.feed',
                    behavior: 'consider',
                    recipient: { mode: 'subject', value: '' },
                    reason: '{{subject}} may share one real piece of their life right now. Use their current activity, goal, next action, availability, visibility, and social targets. The post can be mundane, funny, indirect, pretty, proud, guarded, practical, or strategic. It does not need to mention {{user}}. Respect privacy, and post nothing if {{subject}} would keep this to themself.',
                }],
                condition: allStateRules(
                    anyStateRules(
                        stateRule('parallel', 'characters.$subject.status', 'eq', 'off-screen'),
                        stateRule('parallel', 'characters.$subject.status', 'eq', 'approaching-scene'),
                    ),
                    stateRule('parallel', 'characters.$subject.visibility', 'neq', 'hidden'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 12, intervalMax: 24, probability: 0.38, cooldown: 18, initialDelay: 10 },
            },
            {
                key: 'social-afterglow',
                name: 'Social Afterglow',
                description: 'Gives a socially connected subject a restrained chance to post and receive plausible responses from their own circle.',
                category: EventCategory.FLAVOR,
                priority: 16,
                text: '',
                actions: [{
                    type: 'superagents.feed',
                    behavior: 'consider',
                    recipient: { mode: 'subject', value: '' },
                    reason: '{{subject}} may make a Feed post rooted in their current life and written in their own voice. DON’T paraphrase the state tracker. Only established social targets who could plausibly see it may comment, and zero comments is normal. DON’T bend every reaction toward {{user}}, manufacture romantic competition, or expose private information.',
                }],
                condition: allStateRules(
                    stateRule('parallel', 'characters.$subject.socialTargets', 'exists', ''),
                    stateRule('parallel', 'characters.$subject.visibility', 'neq', 'hidden'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 18, intervalMax: 32, probability: 0.28, cooldown: 24, initialDelay: 16 },
            },
        ],
        tracks: [],
    },
    {
        id: 'social-web-ripples',
        version: 2,
        name: 'Social Web Ripples',
        description: 'Turns active NPC-to-NPC obligations, friction, alliances, and social pressure into durable story motion without assuming romance or exposing private knowledge.',
        tags: ['social web', 'relationships', 'npc', 'long-term plots', 'pressure'],
        setName: 'Preset — Social Web Ripples',
        subjectBinding: {
            label: 'Which relationship may move',
            description: 'Rotates through active directional edges in Social Web Ledger. The edge source becomes {{subject}} and its target becomes {{counterpart}}.',
            allowStateSource: true,
            default: {
                mode: SubjectMode.STATE_SOURCE,
                providerId: 'superagents',
                source: 'sa_social_web',
                collectionPath: 'relationships',
                subjectPath: 'source',
                counterpartPath: 'target',
                selection: 'least-recent',
            },
        },
        stateBindings: [{
            key: 'web',
            label: 'Social relationship state',
            path: 'relationships.$subject.pressure',
            description: 'Validated directional relationship state produced by SuperAgents Social Web Ledger.',
            preferredSources: ['sa_social_web'],
        }],
        events: [
            {
                key: 'favor-comes-due',
                name: 'Favor Comes Due',
                description: 'Lets an established obligation begin affecting choices when the relationship is already under pressure.',
                category: EventCategory.PLOT,
                priority: 38,
                text: '<social_web_event edge="{{subject}}→{{counterpart}}">{{subject}} owes {{counterpart}} something. Let that obligation produce one concrete demand, concession, delay, invitation, refusal, or split loyalty. Current pressure: {{subjectState.currentPressure}}. Keep the established power balance and both characters’ agency. DON’T invent what a secret contains or decide {{user}}’s response.</social_web_event>',
                condition: allStateRules(
                    stateRule('web', 'relationships.$subject.obligation', 'gte', 60),
                    stateRule('web', 'relationships.$subject.pressure', 'gte', 45),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 12, intervalMax: 24, probability: 0.42, cooldown: 18, initialDelay: 8 },
            },
            {
                key: 'private-friction-shows',
                name: 'Private Friction Shows',
                description: 'Allows sustained private tension to leak through behavior only when the scene has a plausible way to reveal it.',
                category: EventCategory.FLAVOR,
                priority: 32,
                text: '<social_web_event edge="{{subject}}→{{counterpart}}">If the viewpoint can plausibly notice, let some friction between {{subject}} and {{counterpart}} slip through in timing, wording, avoidance, stiff formality, a changed choice, or another visible detail. Public stance: {{subjectState.publicStance}}. Private stance: {{subjectState.privateStance}}. Respect visibility={{subjectState.visibility}}. Hidden facts stay hidden; private facts need the right access.</social_web_event>',
                condition: allStateRules(
                    stateRule('web', 'relationships.$subject.tension', 'gte', 55),
                    stateRule('web', 'relationships.$subject.pressure', 'gte', 40),
                    stateRule('web', 'relationships.$subject.visibility', 'neq', 'hidden'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 10, intervalMax: 22, probability: 0.38, cooldown: 16, initialDelay: 8 },
            },
            {
                key: 'fault-line-opens',
                name: 'Fault Line Opens',
                description: 'Uses high tension and low trust as a delayed complication rather than instantly forcing betrayal or confrontation.',
                category: EventCategory.PLOT,
                priority: 46,
                text: '<social_web_event edge="{{subject}}→{{counterpart}}">{{subject}} has low trust and high tension toward {{counterpart}}. Turn that into one story complication using the current pressure ({{subjectState.currentPressure}}) and last real shift ({{subjectState.lastShift}}). It might be caution, fact-checking, coalition-building, refusal, crossed plans, or confrontation. DON’T force cruelty, betrayal, disclosure, or reconciliation.</social_web_event>',
                condition: allStateRules(
                    stateRule('web', 'relationships.$subject.tension', 'gte', 70),
                    stateRule('web', 'relationships.$subject.trust', 'lt', 35),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 18, intervalMax: 34, probability: 0.32, cooldown: 26, initialDelay: 14 },
            },
            {
                key: 'alliance-moves',
                name: 'Alliance Moves',
                description: 'Lets a trusted, close relationship produce help, coordination, or a meaningful constraint of its own.',
                category: EventCategory.WORLD,
                priority: 34,
                text: '<social_web_event edge="{{subject}}→{{counterpart}}">Let the bond between {{subject}} and {{counterpart}} actually do something: coordination, advocacy, a warning, access, protection, compromise, or a shared limitation. Use their bond types ({{subjectState.bondTypes}}), current pressure ({{subjectState.currentPressure}}), and power balance. Keep the effect proportionate. Their relationship does not exist only to serve {{user}}.</social_web_event>',
                condition: allStateRules(
                    stateRule('web', 'relationships.$subject.trust', 'gte', 65),
                    stateRule('web', 'relationships.$subject.closeness', 'gte', 50),
                    stateRule('web', 'relationships.$subject.pressure', 'gte', 35),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 14, intervalMax: 28, probability: 0.36, cooldown: 20, initialDelay: 10 },
            },
        ],
        tracks: [],
    },
    {
        id: 'knowledge-pressure',
        version: 2,
        name: 'Knowledge Pressure',
        description: 'Turns established suspicion, investigation, concealment, strained cover stories, and reachable evidence into story motion without automatically exposing protected truth.',
        tags: ['knowledge', 'secrets', 'investigation', 'continuity', 'safe disclosure'],
        setName: 'Preset — Knowledge Pressure',
        stateBindings: [{
            key: 'knowledge',
            label: 'Knowledge Ledger',
            path: 'facts.$subject.perspectives',
            description: 'Uses SuperAgents capability checks and disclosure-safe candidate projections rather than raw fact records.',
            preferredSources: ['sa_knowledge'],
        }],
        events: [
            {
                key: 'suspicion-sharpens',
                name: 'Suspicion Sharpens',
                description: 'Lets an existing suspicion gain one observable, non-confirming detail.',
                category: EventCategory.FLAVOR,
                priority: 34,
                subject: knowledgeSubject('knowledge'),
                text: '<knowledge_pressure capability="notice" record="{{subjectState.recordId}}" actor="{{subject}}">Let {{subject}} notice one small inconsistency backed by canon. Their recorded position ({{subjectState.position}}) is the most they may infer. Show an observable clue or guarded reaction. Only include a private thought if the current viewpoint already has access to {{subject}}’s inner experience. DON’T confirm the truth, quote protected ledger text, hand out new knowledge, complete a reveal prerequisite, or expose the record to another viewpoint.</knowledge_pressure>',
                condition: knowledgeRule('knowledge', 'notice'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 10, intervalMax: 20, probability: 0.36, cooldown: 16, initialDelay: 8 },
            },
            {
                key: 'quiet-investigation',
                name: 'Quiet Investigation',
                description: 'Allows a character with an established investigate intent to take one reversible step.',
                category: EventCategory.PLOT,
                priority: 42,
                subject: knowledgeSubject('knowledge'),
                text: '<knowledge_pressure capability="investigate" record="{{subjectState.recordId}}" actor="{{subject}}">Let {{subject}} take one small, reversible step based only on position={{subjectState.position}} and access={{subjectState.access}}. They may ask, compare, watch, verify, or look for a plausible source. Show the step only if the scene or viewpoint can perceive it; otherwise let it remain off-screen without explaining it from above. DON’T give them the answer, invent evidence, finish the investigation, complete a reveal prerequisite, or disclose the protected truth.</knowledge_pressure>',
                condition: knowledgeRule('knowledge', 'investigate'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 14, intervalMax: 28, probability: 0.34, cooldown: 22, initialDelay: 10 },
            },
            {
                key: 'guarded-behavior',
                name: 'Guarded Behavior',
                description: 'Lets an informed character conceal or protect information through behavior without explaining the secret.',
                category: EventCategory.FLAVOR,
                priority: 32,
                subject: knowledgeSubject('knowledge'),
                text: '<knowledge_pressure capability="conceal" record="{{subjectState.recordId}}" actor="{{subject}}">Let {{subject}} take one subtle precaution that fits disclosureIntent={{subjectState.disclosureIntent}}. They might protect access, redirect a question, check their privacy, delay a choice, or avoid a dangerous topic. DON’T explain what they are protecting, treat caution as guilt, force them to lie, or reveal the protected truth from an omniscient viewpoint.</knowledge_pressure>',
                condition: knowledgeRule('knowledge', 'conceal'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 12, intervalMax: 24, probability: 0.32, cooldown: 18, initialDelay: 8 },
            },
            {
                key: 'cover-story-strains',
                name: 'Cover Story Strains',
                description: 'Creates a discrepancy around an established cover story while preserving uncertainty.',
                category: EventCategory.PLOT,
                priority: 44,
                subject: knowledgeSubject('knowledge'),
                text: '<knowledge_pressure capability="cover-strain" record="{{subjectState.recordId}}" actor="{{subject}}">Put one small crack in an established cover story: a mismatch, omission, timing problem, or social inconsistency the current viewpoint can actually observe. Keep {{subject}} at position={{subjectState.position}}. The crack can raise a question, but it does not prove the hidden truth or identify the lie. DON’T quote hidden ledger text or force confrontation, confession, or discovery.</knowledge_pressure>',
                condition: knowledgeRule('knowledge', 'cover-strain'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 18, intervalMax: 34, probability: 0.28, cooldown: 26, initialDelay: 14 },
            },
            {
                key: 'evidence-within-reach',
                name: 'Evidence Within Reach',
                description: 'Makes a gated route toward evidence plausible without granting, interpreting, or confirming it.',
                category: EventCategory.PLOT,
                priority: 48,
                subject: knowledgeSubject('knowledge'),
                text: '<knowledge_pressure capability="approach-evidence" record="{{subjectState.recordId}}" actor="{{subject}}">If the scene or viewpoint can plausibly support it, put one route toward evidence within {{subject}}’s reach: access they could request, a witness they could contact, a place they could visit, or a contradiction they could check. This is an opportunity only. DON’T claim they obtained, understood, verified, or proved anything; complete no reveal prerequisite, expose no protected truth, and DON’T decide whether {{subject}} acts.</knowledge_pressure>',
                condition: knowledgeRule('knowledge', 'approach-evidence'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 22, intervalMax: 40, probability: 0.24, cooldown: 32, initialDelay: 16 },
            },
        ],
        tracks: [],
    },
    {
        id: 'commitment-consequences',
        version: 3,
        name: 'Commitment Consequences',
        description: 'Turns explicit Calendar status changes into bounded story consequences and can capture a concrete replacement plan established in the resulting narration without rewriting the original history.',
        tags: ['calendar', 'commitments', 'consequences', 'deadlines', 'branch aware'],
        setName: 'Preset — Commitment Consequences',
        dependencies: [{
            kind: 'calendar',
            name: 'Calendar / Commitments',
            detail: 'Uses the active branch’s explicit commitment status from SuperAgents Calendar.',
        }],
        subjectBinding: {
            label: 'Which commitment changed',
            description: 'Rotates through visible Calendar records. The commitment title becomes {{subject}} and the full safe projection remains available through {{subjectState.field}}.',
            allowStateSource: true,
            default: calendarCommitmentSubject(),
        },
        events: [
            {
                key: 'postponement-has-a-cost',
                name: 'Postponement Has a Cost',
                description: 'Lets an explicitly postponed commitment alter logistics, expectations, or pressure without treating postponement as abandonment.',
                category: EventCategory.PLOT,
                priority: 40,
                oncePerSubject: true,
                text: '<calendar_consequence status="postponed">“{{subject}}” is postponed. Let the delay create one believable logistical, emotional, social, or strategic complication tied to its known people, place, and timing ({{subjectState.timeLabel}}). DON’T invent who asked for the delay, why it happened, whether anyone is offended, or whether the commitment will eventually be kept.</calendar_consequence>',
                condition: calendarRule('postponed'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 2, probability: 1, cooldown: 0, initialDelay: 0 },
            },
            {
                key: 'missed-commitment-echoes',
                name: 'Missed Commitment Echoes',
                description: 'Allows a commitment explicitly marked missed to produce a bounded consequence without inventing blame or the unseen failure itself.',
                category: EventCategory.PLOT,
                priority: 48,
                oncePerSubject: true,
                text: '<calendar_consequence status="missed">“{{subject}}” was missed. Its recorded timing is {{subjectState.timeLabel}}. Give that one concrete consequence: a practical obstacle, follow-up, changed expectation, social pressure, or lost opportunity supported by canon. DON’T invent why it was missed, assign blame, reveal unknown off-screen facts, force forgiveness or anger, or decide {{user}}’s response.</calendar_consequence>',
                condition: calendarRule('missed'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 2, probability: 1, cooldown: 0, initialDelay: 0 },
            },
            {
                key: 'cancellation-redirects-plans',
                name: 'Cancellation Redirects Plans',
                description: 'Lets an explicitly cancelled commitment change the available path without inventing a canceller, motive, or substitute plan.',
                category: EventCategory.WORLD,
                priority: 42,
                oncePerSubject: true,
                text: '<calendar_consequence status="cancelled">“{{subject}}” was cancelled. Its recorded timing is {{subjectState.timeLabel}}. Show one immediate change in availability, coordination, opportunity, or expectations. Keep the recorded people and setting. DON’T invent who cancelled, supply a motive, assume relief or resentment, or automatically replace it with another commitment.</calendar_consequence>',
                condition: calendarRule('cancelled'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 2, probability: 1, cooldown: 0, initialDelay: 0 },
            },
            {
                key: 'completion-leaves-a-trace',
                name: 'Completion Leaves a Trace',
                description: 'Acknowledges an explicitly completed commitment through a bounded aftermath without fabricating how it was completed or what it proves relationally.',
                category: EventCategory.FLAVOR,
                priority: 34,
                oncePerSubject: true,
                text: '<calendar_consequence status="completed">“{{subject}}” is complete. Its recorded timing is {{subjectState.timeLabel}}. Leave one modest trace: changed availability, a receipt or reminder, a practical next step, an observable response from someone involved, or the end of a logistical pressure. DON’T invent how it happened, add unearned success, prove trust or devotion, or decide {{user}}’s feelings.</calendar_consequence>',
                condition: calendarRule('completed'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 2, probability: 1, cooldown: 0, initialDelay: 0 },
            },
        ],
        tracks: [],
    },
    {
        id: 'staged-relationship-arc',
        version: 12,
        name: 'Relationship Progression',
        description: 'A menu of editable relationship models: romantic awareness, love under constraint, slow trust through earned access, consequence/accountability paths after betrayal, and conflicts between sincere devotion and binding duty. Canonical gates prevent scores from inventing reciprocation, forgiveness, repair, or a choice between commitments.',
        tags: ['relationship', 'romance', 'trust', 'betrayal', 'accountability', 'boundaries', 'constraints', 'devotion', 'duty', 'milestones', 'gradual change'],
        setName: 'Preset — Relationship Progression',
        stateBindings: [
            {
                key: 'affection',
                label: 'Affection',
                path: 'characters.$subject.affection',
                description: 'Lets Slow Trust preserve warmth without treating it as access or safety.',
                preferredSources: ['sa_relationship_ledger'],
            },
            {
                key: 'attraction',
                label: 'Attraction',
                path: 'characters.$subject.attraction',
                description: 'Used to select the current attraction stage.',
                preferredSources: ['sa_relationship_ledger'],
            },
            {
                key: 'trust',
                label: 'Trust',
                path: 'characters.$subject.trust',
                description: 'Distinguishes guarded attraction from safer emotional attachment.',
                preferredSources: ['sa_relationship_ledger'],
            },
            {
                key: 'comfort',
                label: 'Comfort',
                path: 'characters.$subject.comfort',
                description: 'Measures how easy it currently feels to be unguarded without granting blanket access.',
                preferredSources: ['sa_relationship_ledger'],
            },
            {
                key: 'familiarity',
                label: 'Familiarity',
                path: 'characters.$subject.familiarity',
                description: 'Represents accumulated shared history; it cannot substitute for trust.',
                preferredSources: ['sa_relationship_ledger'],
            },
            {
                key: 'milestones',
                label: 'Relationship milestones',
                path: 'characters.$subject.milestones',
                description: 'Confirms confessions, constraints, vulnerability, betrayal, accountability, forgiveness, repair, devotion, duty, and costly choices only after they occur in canon.',
                preferredSources: ['sa_relationship_ledger'],
            },
        ],
        events: [
            {
                key: 'constraint-exacts-cost',
                name: 'Constraint Exacts a Cost',
                description: 'Makes an already-established obstacle matter in a concrete but non-terminal way.',
                category: EventCategory.PLOT,
                priority: 42,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<constraint_beat type="cost">The established barrier around {{subject}}’s love for {{user}} costs them something now. Let it affect timing, access, reputation, duty, distance, safety, or what {{subject}} will risk. Use the actual obstacle in canon. DON’T invent another barrier, weaken or solve this one, force a confession, assume {{user}} feels the same, or choose for {{user}}.</constraint_beat>',
                condition: allStateRules(
                    stateRule('milestones', 'characters.$subject.milestones', 'contains', 'love acknowledged'),
                    stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint established'),
                    notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint resolved'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 14, intervalMax: 26, probability: 0.32, cooldown: 20, initialDelay: 8 },
            },
            {
                key: 'constraint-faces-a-test',
                name: 'Constraint Faces a Test',
                description: 'Turns a canonically challenged barrier into a bounded choice or consequence without crossing it automatically.',
                category: EventCategory.PLOT,
                priority: 46,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<constraint_beat type="test">The relationship barrier has already been challenged. Give {{subject}} one immediate choice, contradiction, or cost that tests its current terms. Keep the obstacle unless the story actually changes it. DON’T force defiance, surrender, confession, separation, reconciliation, or a decision from {{user}}. A test can sharpen or expose the problem without solving it.</constraint_beat>',
                condition: allStateRules(
                    stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint challenged'),
                    notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint transformed'),
                    notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint resolved'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 18, intervalMax: 32, probability: 0.28, cooldown: 26, initialDelay: 12 },
            },
            {
                key: 'changed-terms-take-effect',
                name: 'Changed Terms Take Effect',
                description: 'Shows what a transformed—but not necessarily removed—constraint now permits and forbids.',
                category: EventCategory.PLOT,
                priority: 44,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<constraint_beat type="changed-terms">The relationship barrier has changed shape or terms. Show one practical result for {{subject}}: an opening, a new limit, a shifted obligation, or a different risk. Changed does not mean solved. DON’T assume the relationship is public, mutual, sexual, exclusive, or free of consequences, and DON’T decide how {{user}} responds.</constraint_beat>',
                condition: allStateRules(
                    stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint transformed'),
                    notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint resolved'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 20, intervalMax: 36, probability: 0.25, cooldown: 30, initialDelay: 14 },
            },
            {
                key: 'betrayal-consequence-returns',
                name: 'Betrayal Consequence Returns',
                description: 'Lets one specific consequence of the canonical betrayal affect the present without replaying or escalating it arbitrarily.',
                category: EventCategory.PLOT,
                priority: 48,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<betrayal_beat type="consequence">Let the established betrayal affect the present in one concrete way: changed access, fact-checking, reputation, alliances, routine, confidence, grief, anger, or a practical cost tied to what actually happened. DON’T invent another betrayal, inflate the original harm, force a confrontation, decide {{user}}’s feelings, or treat lingering consequences as proof that forgiveness or reconciliation must happen.</betrayal_beat>',
                condition: allStateRules(
                    betrayalEstablishedRule(),
                    noRelationshipMilestone('relationship redefined after betrayal'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 12, intervalMax: 24, probability: 0.34, cooldown: 18, initialDelay: 6 },
            },
            {
                key: 'betrayal-confrontation-opening',
                name: 'Confrontation Opening',
                description: 'Creates an opportunity to address the betrayal without supplying either party’s words, motives, or verdict.',
                category: EventCategory.PLOT,
                priority: 52,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<betrayal_beat type="confrontation-opening">Create one believable opening where the established betrayal could be named, questioned, or deliberately avoided. Keep straight who betrayed whom and what each person knows. If {{user}} is responsible, DON’T make them speak, confess, apologize, or choose. If {{subject}} is responsible, they may evade, minimize, stay silent, or move toward accountability as their character and canon support.</betrayal_beat>',
                condition: allStateRules(
                    betrayalEstablishedRule(),
                    noRelationshipMilestone('betrayal confronted'),
                    noRelationshipMilestone('relationship redefined after betrayal'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 16, intervalMax: 30, probability: 0.28, cooldown: 24, initialDelay: 10 },
            },
            {
                key: 'accountability-meets-a-choice',
                name: 'Accountability Meets a Choice',
                description: 'Tests whether responsibility becomes concrete after confrontation while preserving the persona’s agency.',
                category: EventCategory.PLOT,
                priority: 54,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<betrayal_beat type="accountability-choice">The betrayal has been confronted, but nobody has canonically accepted accountability yet. Use one present detail to separate acknowledgment from excuses, remorse from self-protection, or explanation from responsibility. DON’T manufacture absolution or condemnation. If {{user}} is responsible, show only the situation and {{subject}}’s response; never write {{user}}’s admission, apology, intent, or decision.</betrayal_beat>',
                condition: allStateRules(
                    relationshipMilestone('betrayal confronted'),
                    noRelationshipMilestone('accountability accepted'),
                    noRelationshipMilestone('relationship redefined after betrayal'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 18, intervalMax: 34, probability: 0.27, cooldown: 28, initialDelay: 12 },
            },
            {
                key: 'restitution-must-be-concrete',
                name: 'Restitution Must Be Concrete',
                description: 'Turns accepted responsibility into an observable cost or follow-through rather than instant repaired trust.',
                category: EventCategory.PLOT,
                priority: 50,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<betrayal_beat type="restitution">Accountability was accepted, but repair still needs proof. Put one reasonable opportunity, cost, boundary, or piece of follow-through on the table so restitution can be seen. The attempt may fail, be refused, stay incomplete, or help without restoring the old relationship. If {{user}} is responsible, DON’T perform the repair for them. Effort is not automatic forgiveness, trust, access, reconciliation, or reunion.</betrayal_beat>',
                condition: allStateRules(
                    relationshipMilestone('accountability accepted'),
                    noRelationshipMilestone('restitution demonstrated'),
                    noRelationshipMilestone('relationship redefined after betrayal'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 20, intervalMax: 38, probability: 0.25, cooldown: 30, initialDelay: 14 },
            },
            {
                key: 'redefined-terms-are-tested',
                name: 'Redefined Terms Are Tested',
                description: 'Shows whether the relationship’s canonically chosen new shape works under ordinary pressure.',
                category: EventCategory.PLOT,
                priority: 46,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<betrayal_beat type="new-terms">The relationship has new terms after the betrayal. Let one ordinary situation test the actual arrangement: no contact, formal distance, limited cooperation, cautious repair, changed intimacy, or whatever canon established. Keep the chosen outcome and DON’T decide {{user}}’s participation or response. Emotional history alone is not a reason to steer them back toward romance, friendship, forgiveness, punishment, or reunion.</betrayal_beat>',
                condition: relationshipMilestone('relationship redefined after betrayal'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 22, intervalMax: 42, probability: 0.22, cooldown: 34, initialDelay: 16 },
            },
            {
                key: 'duty-calls-at-personal-cost',
                name: 'Duty Calls at a Personal Cost',
                description: 'Lets an established obligation make a concrete demand without deciding that duty outranks devotion.',
                category: EventCategory.PLOT,
                priority: 44,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<devotion_duty_beat type="duty-cost">An established duty makes a real demand on {{subject}} now. It costs time, access, safety, reputation, honesty, resources, or an opportunity connected to {{user}}. Treat both the duty and the devotion as sincere. DON’T invent a new oath or institution, declare the commitments incompatible before canon does, force {{subject}} to choose, or decide {{user}}’s reaction.</devotion_duty_beat>',
                condition: allStateRules(
                    relationshipMilestone('devotion established'),
                    relationshipMilestone('duty established'),
                    noRelationshipMilestone('devotion and duty reconciled'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 14, intervalMax: 28, probability: 0.3, cooldown: 22, initialDelay: 8 },
            },
            {
                key: 'conflicting-loyalties-come-due',
                name: 'Conflicting Loyalties Come Due',
                description: 'Makes an established devotion-duty conflict require an immediate response without supplying the choice.',
                category: EventCategory.PLOT,
                priority: 50,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<devotion_duty_beat type="conflict-due">{{subject}}’s devotion to {{user}} and an established duty now pull in different directions. Bring them to one clear decision point, deadline, divided-attention cost, or incompatible demand. Show what each commitment asks and what cannot be preserved in this moment. DON’T choose for {{subject}}, speak or decide for {{user}}, manufacture betrayal, or make either commitment secretly false for an easy answer.</devotion_duty_beat>',
                condition: allStateRules(
                    relationshipMilestone('devotion and duty conflict established'),
                    noRelationshipMilestone('duty chosen over devotion'),
                    noRelationshipMilestone('devotion chosen over duty'),
                    noRelationshipMilestone('devotion and duty renegotiated'),
                    noRelationshipMilestone('devotion and duty reconciled'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 16, intervalMax: 30, probability: 0.28, cooldown: 24, initialDelay: 10 },
            },
            {
                key: 'third-party-demands-clarity',
                name: 'A Third Party Demands Clarity',
                description: 'Lets someone with legitimate standing press the conflict without turning them into an arbitrary villain.',
                category: EventCategory.SOCIAL,
                priority: 46,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<devotion_duty_beat type="third-party">Someone already connected to {{subject}}’s duty notices a real inconsistency, risk, divided loyalty, or unmet obligation. Let them ask for clarification, reassurance, boundaries, or action that fits their role. Give them real stakes and their own point of view; DON’T use them as a disposable obstacle. Don’t reveal secrets they could not know, force an ultimatum, choose for {{subject}}, or decide {{user}}’s response.</devotion_duty_beat>',
                condition: allStateRules(
                    relationshipMilestone('devotion and duty conflict established'),
                    noRelationshipMilestone('devotion and duty renegotiated'),
                    noRelationshipMilestone('devotion and duty reconciled'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 20, intervalMax: 36, probability: 0.24, cooldown: 28, initialDelay: 14 },
            },
            {
                key: 'choice-leaves-a-remainder',
                name: 'The Choice Leaves a Remainder',
                description: 'Preserves the concrete consequences of a canonical choice without treating the losing commitment as insincere.',
                category: EventCategory.PLOT,
                priority: 48,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<devotion_duty_beat type="choice-consequence">A choice between devotion and duty was already made. Let one remnant of the path not chosen affect the present: grief, obligation, lost access, political or family fallout, relief, resentment, practical repair, changed trust, or a promise that still matters. DON’T reverse the choice, erase its cost, call the unchosen commitment false, force regret, or decide {{user}}’s judgment.</devotion_duty_beat>',
                condition: allStateRules(
                    anyStateRules(
                        relationshipMilestone('duty chosen over devotion'),
                        relationshipMilestone('devotion chosen over duty'),
                    ),
                    noRelationshipMilestone('devotion and duty reconciled'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 18, intervalMax: 34, probability: 0.26, cooldown: 26, initialDelay: 12 },
            },
            {
                key: 'renegotiated-terms-are-tested',
                name: 'Renegotiated Terms Are Tested',
                description: 'Tests a canonically negotiated arrangement without assuming it solved every conflict or cost.',
                category: EventCategory.PLOT,
                priority: 46,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<devotion_duty_beat type="renegotiated-test">{{subject}} now carries devotion and duty under changed terms. Put one ordinary pressure on the real arrangement: disclosure rules, divided time, recusal, delegated authority, boundaries, public conduct, contingency plans, or another established term. Keep what the agreement allows and forbids straight. DON’T make the test automatically fail or succeed, declare everything reconciled, or decide {{user}}’s cooperation.</devotion_duty_beat>',
                condition: allStateRules(
                    relationshipMilestone('devotion and duty renegotiated'),
                    noRelationshipMilestone('devotion and duty reconciled'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 22, intervalMax: 40, probability: 0.22, cooldown: 32, initialDelay: 16 },
            },
        ],
        tracks: [{
            key: 'romantic-awakening-track',
            name: 'Romantic Awakening',
            description: 'An editable example using validated attraction, trust, and canonical milestones from one or more state agents. Its thresholds demonstrate hysteresis and branching; they are not universal relationship rules.',
            transitionMode: TrackTransitionMode.STICKY,
            subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
            states: [
                {
                    name: 'Stage 1 — Rationalized Pull',
                    priority: 10,
                    minDuration: 2,
                    text: '<relationship_state>\n{{subject}} feels a noticeable pull toward {{user}} but does not accept it as romantic. {{subject}} rationalizes it as friendship, curiosity, protectiveness, rivalry, physical interest, or circumstance—whichever fits established characterization. The feeling may color attention and reactions, but it does not justify a confession, possessiveness, assumed intimacy, or behavior that treats a relationship as established.\n</relationship_state>',
                    condition: allStateRules(
                        stateRule('attraction', 'characters.$subject.attraction', 'gte', 20),
                        stateRule('attraction', 'characters.$subject.attraction', 'lt', 55),
                    ),
                    exitCondition: anyStateRules(
                        stateRule('attraction', 'characters.$subject.attraction', 'lt', 10),
                        stateRule('attraction', 'characters.$subject.attraction', 'gte', 60),
                    ),
                },
                {
                    name: 'Stage 2A — Guarded Fixation',
                    priority: 25,
                    minDuration: 2,
                    text: '<relationship_state>\n{{subject}} is strongly drawn to {{user}}, but insufficient trust makes that attraction feel risky, destabilizing, or difficult to interpret. {{subject}} may watch closely, test intentions, retreat after vulnerable moments, or experience conflicted jealousy according to established characterization. Attraction does not erase suspicion or grant {{user}} access, trust, consent, or commitment. Do not turn this tension into cruelty or coercion unless the existing character and scene independently support it.\n</relationship_state>',
                    condition: allStateRules(
                        stateRule('attraction', 'characters.$subject.attraction', 'gte', 50),
                        stateRule('trust', 'characters.$subject.trust', 'lt', 35),
                    ),
                    exitCondition: anyStateRules(
                        stateRule('attraction', 'characters.$subject.attraction', 'lt', 40),
                        allStateRules(
                            stateRule('attraction', 'characters.$subject.attraction', 'gte', 50),
                            stateRule('trust', 'characters.$subject.trust', 'gte', 45),
                        ),
                    ),
                },
                {
                    name: 'Stage 2B — Growing Attachment',
                    priority: 30,
                    minDuration: 2,
                    text: '<relationship_state>\n{{subject}} can no longer dismiss their attraction to {{user}}, and sufficient trust lets the feeling develop as attachment rather than only tension. {{subject}} may seek time together, replay meaningful interactions, show selective vulnerability, or imagine greater closeness in ways consistent with personality and circumstance. {{subject}} has not necessarily named the feeling as love and must not assume reciprocation, confession, exclusivity, or an established relationship.\n</relationship_state>',
                    condition: allStateRules(
                        stateRule('attraction', 'characters.$subject.attraction', 'gte', 50),
                        stateRule('trust', 'characters.$subject.trust', 'gte', 35),
                    ),
                    exitCondition: anyStateRules(
                        stateRule('attraction', 'characters.$subject.attraction', 'lt', 40),
                        stateRule('trust', 'characters.$subject.trust', 'lt', 20),
                        allStateRules(
                            stateRule('attraction', 'characters.$subject.attraction', 'gte', 75),
                            stateRule('trust', 'characters.$subject.trust', 'gte', 45),
                        ),
                    ),
                },
                {
                    name: 'Stage 3 — Acknowledged Desire',
                    priority: 40,
                    minDuration: 2,
                    text: '<relationship_state>\n{{subject}} privately accepts that their attraction to {{user}} is real and emotionally important. {{subject}} may deliberately pursue closeness or move toward honest disclosure when the immediate scene supports it, while remaining shaped by established personality and boundaries. No confession or mutual relationship has been established unless it exists in canon. Do not invent reciprocation, consent, dating, a kiss, sex, exclusivity, or any other milestone from high scores alone.\n</relationship_state>',
                    condition: allStateRules(
                        stateRule('attraction', 'characters.$subject.attraction', 'gte', 75),
                        stateRule('trust', 'characters.$subject.trust', 'gte', 45),
                    ),
                    exitCondition: anyStateRules(
                        stateRule('attraction', 'characters.$subject.attraction', 'lt', 60),
                        stateRule('trust', 'characters.$subject.trust', 'lt', 30),
                        allStateRules(
                            stateRule('attraction', 'characters.$subject.attraction', 'gte', 80),
                            stateRule('trust', 'characters.$subject.trust', 'gte', 55),
                            stateRule('milestones', 'characters.$subject.milestones', 'contains', 'confessed attraction'),
                        ),
                    ),
                },
                {
                    name: 'Milestone — Attraction Voiced',
                    priority: 50,
                    minDuration: 2,
                    text: '<relationship_state>\nCanon records that {{subject}} has voiced their attraction to {{user}}. That disclosure remains part of the relationship history even if current feelings become conflicted, withdrawn, regretful, or strained. The confession establishes only that it was spoken: do not assume {{user}} reciprocated or invent dating, a kiss, sex, exclusivity, commitment, or any later milestone unless it separately occurred in the story.\n</relationship_state>',
                    condition: allStateRules(
                        stateRule('attraction', 'characters.$subject.attraction', 'gte', 80),
                        stateRule('trust', 'characters.$subject.trust', 'gte', 55),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'confessed attraction'),
                    ),
                    exitCondition: {
                        ...stateRule('milestones', 'characters.$subject.milestones', 'contains', 'confessed attraction'),
                        invert: true,
                    },
                },
                { name: 'No active attraction state', isFallback: true, priority: -100, text: '' },
            ]
        },
        {
            key: 'love-under-constraint-track',
            name: 'Love Under Constraint',
            description: 'For a character who already recognizes their love. The changing state belongs to the canonically established obstacle—not to discovery of the feeling or presumed reciprocation.',
            transitionMode: TrackTransitionMode.STICKY,
            subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
            states: [
                {
                    name: 'Mode — Love Held Within the Boundary',
                    priority: 20,
                    minDuration: 2,
                    text: '<relationship_constraint>\n{{subject}} already recognizes their love for {{user}}, and a specific canonical constraint still governs what they can safely, ethically, or practically do about it. Do not replay this as romantic confusion or make the feeling rise merely to create progress. Let affection appear through restraint, redirected tenderness, difficult priorities, guarded choices, or acceptance of cost according to characterization. Preserve the actual obstacle; do not invent reciprocation, disclosure, defiance, consent, or a relationship status for {{user}}.\n</relationship_constraint>',
                    condition: allStateRules(
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'love acknowledged'),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint established'),
                        notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint challenged'),
                        notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint transformed'),
                        notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint resolved'),
                    ),
                    exitCondition: anyStateRules(
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint challenged'),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint transformed'),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint resolved'),
                    ),
                },
                {
                    name: 'Mode — Boundary Under Pressure',
                    priority: 30,
                    minDuration: 2,
                    text: '<relationship_constraint>\n{{subject}}\'s acknowledged love remains constrained, but canon has now tested the old arrangement. Show the tension through choices with visible tradeoffs: hesitation, negotiation, selective honesty, protective distance, compromise, or a refusal that costs something. A challenge does not mean the barrier has fallen. Do not force {{subject}} to cross it, force {{user}} to wait or reciprocate, or treat suffering as proof that the relationship must happen.\n</relationship_constraint>',
                    condition: allStateRules(
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'love acknowledged'),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint challenged'),
                        notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint transformed'),
                        notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint resolved'),
                    ),
                    exitCondition: anyStateRules(
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint transformed'),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint resolved'),
                    ),
                },
                {
                    name: 'Mode — Constraint on New Terms',
                    priority: 40,
                    minDuration: 2,
                    text: '<relationship_constraint>\nThe canonical obstacle around {{subject}}\'s acknowledged love has changed form or terms. Honor what the story specifically changed and what still remains. Let {{subject}} adjust behavior, risk, disclosure, contact, or expectations to the new reality without treating transformation as disappearance. Do not infer that love is reciprocated, that a relationship has begun, or that prior duties and consequences no longer matter.\n</relationship_constraint>',
                    condition: allStateRules(
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'love acknowledged'),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint transformed'),
                        notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint resolved'),
                    ),
                    exitCondition: stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint resolved'),
                },
                {
                    name: 'Milestone — Constraint Resolved, Choice Remains',
                    priority: 50,
                    minDuration: 2,
                    text: '<relationship_constraint>\nCanon records that the prior constraint on {{subject}}\'s acknowledged love has been resolved. Its removal creates possibility, not an automatic outcome. Preserve any history, cost, changed feelings, new obligations, or caution produced by the barrier. {{subject}} may now make choices that were previously unavailable, but do not invent a confession, reciprocation, consent, reunion, commitment, or decision for {{user}} unless it separately occurs in the story.\n</relationship_constraint>',
                    condition: allStateRules(
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'love acknowledged'),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint resolved'),
                    ),
                    exitCondition: notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint resolved'),
                },
                { name: 'No active constrained-love state', isFallback: true, priority: -100, text: '' },
            ],
        },
        {
            key: 'slow-trust-track',
            name: 'Slow Trust',
            description: 'Progresses verified safety, permission, and vulnerability. Affection may accumulate behind the boundary, but it never unlocks access on its own.',
            transitionMode: TrackTransitionMode.STICKY,
            subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
            states: [
                {
                    name: 'Stage — Boundaries Intact',
                    priority: 10,
                    minDuration: 2,
                    text: '<slow_trust>\n{{subject}} does not yet have enough evidence to treat {{user}} as reliably safe. Keep interaction within character-specific boundaries: role-appropriate topics, controlled settings, limited dependence, and no assumed access to private space, touch, history, secrets, or unguarded emotion. This may be cordial rather than hostile. Repeated proximity and high affection elsewhere do not count as permission.\n</slow_trust>',
                    condition: anyStateRules(
                        stateRule('trust', 'characters.$subject.trust', 'lt', 30),
                        stateRule('familiarity', 'characters.$subject.familiarity', 'lt', 20),
                    ),
                    exitCondition: anyStateRules(
                        allStateRules(
                            stateRule('trust', 'characters.$subject.trust', 'gte', 35),
                            stateRule('familiarity', 'characters.$subject.familiarity', 'gte', 25),
                        ),
                        allStateRules(
                            stateRule('affection', 'characters.$subject.affection', 'gte', 60),
                            stateRule('trust', 'characters.$subject.trust', 'lt', 45),
                        ),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                    ),
                },
                {
                    name: 'Stage — Reliability Under Test',
                    priority: 20,
                    minDuration: 2,
                    text: '<slow_trust>\n{{subject}} has seen enough consistency to test limited reliance on {{user}}. Show progress through small, observable permissions: less formal conversation, a low-stakes request, remembered preferences, tolerating quiet company, or sharing something non-critical. Each permission is specific rather than a universal upgrade. Do not grant private-space access, core vulnerability, unconditional belief, touch, forgiveness, or intimacy merely because trust is improving.\n</slow_trust>',
                    condition: allStateRules(
                        stateRule('trust', 'characters.$subject.trust', 'gte', 25),
                        stateRule('trust', 'characters.$subject.trust', 'lt', 60),
                        stateRule('familiarity', 'characters.$subject.familiarity', 'gte', 20),
                    ),
                    exitCondition: anyStateRules(
                        stateRule('trust', 'characters.$subject.trust', 'lt', 15),
                        allStateRules(
                            stateRule('affection', 'characters.$subject.affection', 'gte', 60),
                            stateRule('trust', 'characters.$subject.trust', 'lt', 45),
                        ),
                        allStateRules(
                            stateRule('trust', 'characters.$subject.trust', 'gte', 60),
                            stateRule('comfort', 'characters.$subject.comfort', 'gte', 40),
                            stateRule('familiarity', 'characters.$subject.familiarity', 'gte', 40),
                        ),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                    ),
                },
                {
                    name: 'Branch — Fondness Behind the Boundary',
                    priority: 45,
                    minDuration: 2,
                    text: '<slow_trust>\n{{subject}} feels substantial affection for {{user}}, but trust is not yet strong enough to make deeper access safe. Preserve both truths. Warmth may appear as attention, concern, loyalty, gifts, humor, or restrained longing while private space, protected history, touch, dependence, and vulnerable disclosure remain limited by {{subject}}\'s actual boundaries. Affection is retained rather than erased, but it cannot be cashed in as trust, consent, or entitlement.\n</slow_trust>',
                    condition: allStateRules(
                        stateRule('affection', 'characters.$subject.affection', 'gte', 60),
                        stateRule('trust', 'characters.$subject.trust', 'lt', 45),
                        notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                    ),
                    exitCondition: anyStateRules(
                        stateRule('affection', 'characters.$subject.affection', 'lt', 45),
                        stateRule('trust', 'characters.$subject.trust', 'gte', 50),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                    ),
                },
                {
                    name: 'Stage — Selective Access',
                    priority: 50,
                    minDuration: 2,
                    text: '<slow_trust>\n{{subject}} now experiences {{user}} as sufficiently reliable for selective access. Let this change concrete behavior: a deliberately chosen invitation, more candid disagreement, an unpolished moment, a bounded personal disclosure, or reliance in one established area. Access remains granular and revocable; do not generalize one permission into every private space, secret, touch boundary, dependency, or kind of intimacy.\n</slow_trust>',
                    condition: allStateRules(
                        stateRule('trust', 'characters.$subject.trust', 'gte', 55),
                        stateRule('comfort', 'characters.$subject.comfort', 'gte', 40),
                        stateRule('familiarity', 'characters.$subject.familiarity', 'gte', 40),
                    ),
                    exitCondition: anyStateRules(
                        stateRule('trust', 'characters.$subject.trust', 'lt', 40),
                        stateRule('comfort', 'characters.$subject.comfort', 'lt', 30),
                        allStateRules(
                            stateRule('trust', 'characters.$subject.trust', 'gte', 75),
                            stateRule('comfort', 'characters.$subject.comfort', 'gte', 60),
                            stateRule('familiarity', 'characters.$subject.familiarity', 'gte', 55),
                            stateRule('milestones', 'characters.$subject.milestones', 'contains', 'shared meaningful vulnerability'),
                        ),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                    ),
                },
                {
                    name: 'Milestone — Chosen Vulnerability',
                    priority: 60,
                    minDuration: 2,
                    text: '<slow_trust>\nCanon records that {{subject}} deliberately allowed {{user}} to witness or receive something meaningfully vulnerable, and present trust and comfort support that access. Let the relationship remember the specificity of what was entrusted and how {{user}} responded. This does not unlock every secret, erase boundaries, establish romance, guarantee future disclosure, or make {{subject}} dependent or perfectly secure.\n</slow_trust>',
                    condition: allStateRules(
                        stateRule('trust', 'characters.$subject.trust', 'gte', 75),
                        stateRule('comfort', 'characters.$subject.comfort', 'gte', 60),
                        stateRule('familiarity', 'characters.$subject.familiarity', 'gte', 55),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'shared meaningful vulnerability'),
                    ),
                    exitCondition: anyStateRules(
                        stateRule('trust', 'characters.$subject.trust', 'lt', 55),
                        stateRule('comfort', 'characters.$subject.comfort', 'lt', 45),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                    ),
                },
                {
                    name: 'Rupture — Access Withdrawn',
                    priority: 80,
                    minDuration: 2,
                    text: '<slow_trust>\nCanon records that {{subject}}\'s trust in {{user}} was broken, and current trust is low. Withdraw or narrow the specific access affected by the breach: changed routines, verification, distance, guarded topics, revoked invitations, anger, grief, or practical boundaries according to what happened. Prior affection and vulnerability remain history but are not a claim on forgiveness. Do not restore access because of apologies, high affection, or score recovery alone.\n</slow_trust>',
                    condition: allStateRules(
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                        stateRule('trust', 'characters.$subject.trust', 'lt', 45),
                    ),
                    exitCondition: stateRule('trust', 'characters.$subject.trust', 'gte', 45),
                },
                {
                    name: 'Repair — Reliability Re-Proven',
                    priority: 75,
                    minDuration: 2,
                    text: '<slow_trust>\n{{subject}} is testing whether reliability can be rebuilt after a canonical breach. Progress should be slower and more evidence-heavy than first trust: repeated follow-through, respect for revoked permissions, accurate accountability, and room for mixed feelings. Restore access one permission at a time. Improved meters do not declare repair complete; only canon may establish that trust has been re-earned.\n</slow_trust>',
                    condition: allStateRules(
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                        stateRule('trust', 'characters.$subject.trust', 'gte', 45),
                        notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust re-earned'),
                    ),
                    exitCondition: anyStateRules(
                        stateRule('trust', 'characters.$subject.trust', 'lt', 30),
                        allStateRules(
                            stateRule('trust', 'characters.$subject.trust', 'gte', 60),
                            stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust re-earned'),
                        ),
                    ),
                },
                {
                    name: 'Milestone — Trust Re-Earned, History Retained',
                    priority: 90,
                    minDuration: 2,
                    text: '<slow_trust>\nCanon records that {{subject}} considers trust in {{user}} meaningfully re-earned after a breach. Restored permissions may now coexist with sensitivities, verification habits, changed boundaries, or consequences that remain. Repair is not amnesia, obedience, romantic consent, or proof that every former access level returned. If current trust falls sharply again, let the present rupture outrank this historical milestone.\n</slow_trust>',
                    condition: allStateRules(
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust re-earned'),
                        stateRule('trust', 'characters.$subject.trust', 'gte', 60),
                    ),
                    exitCondition: stateRule('trust', 'characters.$subject.trust', 'lt', 50),
                },
                { name: 'No active slow-trust state', isFallback: true, priority: -100, text: '' },
            ],
        },
        {
            key: 'after-betrayal-track',
            name: 'After Betrayal',
            description: 'Tracks consequences, confrontation, accountability, restitution, forgiveness, and the relationship’s eventual new terms as separate canonical developments.',
            transitionMode: TrackTransitionMode.STICKY,
            subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
            states: [
                {
                    name: 'Aftermath — Character Broke the Bond',
                    priority: 30,
                    minDuration: 2,
                    text: '<after_betrayal>\nCanon establishes that {{subject}} betrayed {{user}} in a relationship-relevant way. Preserve what {{subject}} actually did, knew, intended, and now understands; do not rewrite the betrayal as a harmless misunderstanding merely to restore warmth. Their response may include guilt, justification, fear, grief, avoidance, self-protection, remorse, or continued conviction according to characterization. Do not invent {{user}}\'s hurt, forgiveness, confrontation, continued contact, or desire for repair.\n</after_betrayal>',
                    condition: allStateRules(
                        relationshipMilestone('betrayal by character established'),
                        noRelationshipMilestone('betrayal by persona established'),
                        noRelationshipMilestone('betrayal confronted'),
                        noRelationshipMilestone('relationship redefined after betrayal'),
                    ),
                    exitCondition: anyStateRules(
                        relationshipMilestone('betrayal by persona established'),
                        relationshipMilestone('betrayal confronted'),
                        relationshipMilestone('accountability accepted'),
                        relationshipMilestone('relationship redefined after betrayal'),
                    ),
                },
                {
                    name: 'Aftermath — Persona Broke the Bond',
                    priority: 30,
                    minDuration: 2,
                    text: '<after_betrayal>\nCanon establishes that {{user}} betrayed {{subject}} in a relationship-relevant way. Let {{subject}} reinterpret prior events and change access, reliance, expectations, or contact according to the specific breach and their characterization. Their reaction need not be loud, immediate, permanent, or forgiving. Do not invent {{user}}\'s motive, remorse, apology, defense, feelings, or willingness to repair, and do not use {{subject}}\'s affection as a reason to waive consequences.\n</after_betrayal>',
                    condition: allStateRules(
                        relationshipMilestone('betrayal by persona established'),
                        noRelationshipMilestone('betrayal by character established'),
                        noRelationshipMilestone('betrayal confronted'),
                        noRelationshipMilestone('relationship redefined after betrayal'),
                    ),
                    exitCondition: anyStateRules(
                        relationshipMilestone('betrayal by character established'),
                        relationshipMilestone('betrayal confronted'),
                        relationshipMilestone('accountability accepted'),
                        relationshipMilestone('relationship redefined after betrayal'),
                    ),
                },
                {
                    name: 'Aftermath — Mutual Breach, Unequal Harms',
                    priority: 35,
                    minDuration: 2,
                    text: '<after_betrayal>\nCanon establishes betrayals by both {{subject}} and {{user}}. Preserve each action, motive, sequence, and consequence separately: mutual wrongdoing does not make the harms equal, cancel responsibility, or create automatic moral symmetry. {{subject}} may feel injured and accountable at once. Do not decide {{user}}\'s interpretation, combine the breaches into one vague conflict, or use shared fault to force reconciliation.\n</after_betrayal>',
                    condition: allStateRules(
                        relationshipMilestone('betrayal by character established'),
                        relationshipMilestone('betrayal by persona established'),
                        noRelationshipMilestone('betrayal confronted'),
                        noRelationshipMilestone('relationship redefined after betrayal'),
                    ),
                    exitCondition: anyStateRules(
                        relationshipMilestone('betrayal confronted'),
                        relationshipMilestone('accountability accepted'),
                        relationshipMilestone('relationship redefined after betrayal'),
                    ),
                },
                {
                    name: 'Stage — Betrayal Confronted, Accountability Open',
                    priority: 50,
                    minDuration: 2,
                    text: '<after_betrayal>\nThe betrayal has been confronted in canon, but responsibility and meaning remain contested or incomplete. Keep explanation, acknowledgment, remorse, justification, and accountability distinct. {{subject}} may answer, evade, listen, counter-accuse, set boundaries, or remain uncertain according to their role and characterization. Do not supply {{user}}\'s position or treat confrontation itself as confession, apology, forgiveness, repair, or closure.\n</after_betrayal>',
                    condition: allStateRules(
                        relationshipMilestone('betrayal confronted'),
                        noRelationshipMilestone('accountability accepted'),
                        noRelationshipMilestone('relationship redefined after betrayal'),
                    ),
                    exitCondition: anyStateRules(
                        relationshipMilestone('accountability accepted'),
                        relationshipMilestone('relationship redefined after betrayal'),
                    ),
                },
                {
                    name: 'Stage — Accountability Accepted, Repair Not Begun',
                    priority: 60,
                    minDuration: 2,
                    text: '<after_betrayal>\nCanon records that the responsible party accepted accountability for the betrayal. That acknowledgment matters, but it does not restore trust, access, safety, reputation, intimacy, or the former relationship. Let consequences remain present while the difference between words and repair becomes visible. Do not treat remorse as restitution or oblige the harmed party to offer contact, forgiveness, comfort, or another chance.\n</after_betrayal>',
                    condition: allStateRules(
                        relationshipMilestone('accountability accepted'),
                        noRelationshipMilestone('restitution attempted'),
                        noRelationshipMilestone('restitution demonstrated'),
                        noRelationshipMilestone('forgiveness expressed'),
                        noRelationshipMilestone('relationship redefined after betrayal'),
                    ),
                    exitCondition: anyStateRules(
                        relationshipMilestone('restitution attempted'),
                        relationshipMilestone('restitution demonstrated'),
                        relationshipMilestone('forgiveness expressed'),
                        relationshipMilestone('relationship redefined after betrayal'),
                    ),
                },
                {
                    name: 'Stage — Restitution Under Observation',
                    priority: 65,
                    minDuration: 2,
                    text: '<after_betrayal>\nA concrete attempt at restitution has begun, but its meaning and reliability are not yet proven. Show repair through observable follow-through, respect for boundaries, accepted cost, changed behavior, or restoration of what can actually be restored. Attempts may be imperfect, refused, self-serving, sincere, interrupted, or insufficient. Do not convert effort into demonstrated change, forgiveness, restored trust, renewed access, or reunion before canon does.\n</after_betrayal>',
                    condition: allStateRules(
                        relationshipMilestone('restitution attempted'),
                        noRelationshipMilestone('restitution demonstrated'),
                        noRelationshipMilestone('forgiveness expressed'),
                        noRelationshipMilestone('relationship redefined after betrayal'),
                    ),
                    exitCondition: anyStateRules(
                        relationshipMilestone('restitution demonstrated'),
                        relationshipMilestone('forgiveness expressed'),
                        relationshipMilestone('relationship redefined after betrayal'),
                    ),
                },
                {
                    name: 'Stage — Restitution Demonstrated, Outcome Open',
                    priority: 70,
                    minDuration: 2,
                    text: '<after_betrayal>\nCanon contains sustained evidence that restitution changed something real. Preserve what was repaired and what cannot be undone. Demonstrated change may make trust or contact possible, but it does not entitle the responsible party to forgiveness, renewed intimacy, the previous relationship, or any particular verdict. Let {{subject}} act from the actual role they hold in the betrayal while leaving {{user}}\'s choices untouched.\n</after_betrayal>',
                    condition: allStateRules(
                        relationshipMilestone('restitution demonstrated'),
                        noRelationshipMilestone('forgiveness expressed'),
                        noRelationshipMilestone('relationship redefined after betrayal'),
                    ),
                    exitCondition: anyStateRules(
                        relationshipMilestone('forgiveness expressed'),
                        relationshipMilestone('relationship redefined after betrayal'),
                    ),
                },
                {
                    name: 'Branch — Forgiveness Without Restoration',
                    priority: 80,
                    minDuration: 2,
                    text: '<after_betrayal>\nThe harmed party has canonically expressed forgiveness, but the relationship has not yet been redefined. Treat forgiveness as one choice about blame, anger, or release—not as restored trust, forgotten harm, returned access, reconciliation, romance, contact, or reunion. {{subject}} may feel relief, grief, gratitude, suspicion, emptiness, or uncertainty according to their role. The future relationship remains open until canon establishes its terms.\n</after_betrayal>',
                    condition: allStateRules(
                        relationshipMilestone('forgiveness expressed'),
                        noRelationshipMilestone('relationship redefined after betrayal'),
                    ),
                    exitCondition: relationshipMilestone('relationship redefined after betrayal'),
                },
                {
                    name: 'Milestone — Relationship Redefined, Betrayal Retained',
                    priority: 90,
                    minDuration: 2,
                    text: '<after_betrayal>\nCanon has established the relationship\'s new terms after betrayal. Follow the specific outcome: ended contact, estrangement, formal distance, limited cooperation, cautious rebuilding, changed intimacy, restored partnership with boundaries, or another arrangement actually chosen in the story. Preserve the betrayal and its consequences as history without making them the only remaining trait. Redefinition does not imply forgiveness, and forgiveness does not require restoration.\n</after_betrayal>',
                    condition: relationshipMilestone('relationship redefined after betrayal'),
                    exitCondition: noRelationshipMilestone('relationship redefined after betrayal'),
                },
                { name: 'No active after-betrayal state', isFallback: true, priority: -100, text: '' },
            ],
        },
        {
            key: 'devotion-vs-duty-track',
            name: 'Devotion vs Duty',
            description: 'Tracks two sincere commitments as they align, conflict, produce a costly choice, or acquire new terms without treating either as fake or morally predetermined.',
            transitionMode: TrackTransitionMode.STICKY,
            subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
            states: [
                {
                    name: 'Mode — Devotion and Duty Aligned',
                    priority: 20,
                    minDuration: 2,
                    text: '<devotion_vs_duty>\nCanon establishes both {{subject}}\'s durable devotion to {{user}} and a concrete duty beyond that bond. For now, the commitments can coexist: duty may shape time, conduct, disclosure, priorities, or risk without requiring a choice. Let both influence behavior in specific ways. Devotion need not be romantic, and duty need not be cold or externally imposed. Do not invent conflict merely because two commitments exist.\n</devotion_vs_duty>',
                    condition: allStateRules(
                        relationshipMilestone('devotion established'),
                        relationshipMilestone('duty established'),
                        noRelationshipMilestone('devotion and duty conflict established'),
                        noRelationshipMilestone('duty chosen over devotion'),
                        noRelationshipMilestone('devotion chosen over duty'),
                        noRelationshipMilestone('devotion and duty renegotiated'),
                        noRelationshipMilestone('devotion and duty reconciled'),
                    ),
                    exitCondition: anyStateRules(
                        relationshipMilestone('devotion and duty conflict established'),
                        relationshipMilestone('duty chosen over devotion'),
                        relationshipMilestone('devotion chosen over duty'),
                        relationshipMilestone('devotion and duty renegotiated'),
                        relationshipMilestone('devotion and duty reconciled'),
                    ),
                },
                {
                    name: 'Mode — Divided Allegiance',
                    priority: 40,
                    minDuration: 2,
                    text: '<devotion_vs_duty>\nCanon has made {{subject}}\'s devotion to {{user}} and an established duty impossible to satisfy fully at the same time. Preserve what each commitment specifically requires, who bears each cost, and how {{subject}} understands the conflict. They may delay, compartmentalize, seek exceptions, disclose selectively, bargain, or endure divided loyalty according to characterization. Do not make either commitment secretly false, force a choice, or supply {{user}}\'s wishes.\n</devotion_vs_duty>',
                    condition: allStateRules(
                        relationshipMilestone('devotion and duty conflict established'),
                        noRelationshipMilestone('duty chosen over devotion'),
                        noRelationshipMilestone('devotion chosen over duty'),
                        noRelationshipMilestone('devotion and duty renegotiated'),
                        noRelationshipMilestone('devotion and duty reconciled'),
                    ),
                    exitCondition: anyStateRules(
                        relationshipMilestone('duty chosen over devotion'),
                        relationshipMilestone('devotion chosen over duty'),
                        relationshipMilestone('devotion and duty renegotiated'),
                        relationshipMilestone('devotion and duty reconciled'),
                    ),
                },
                {
                    name: 'Branch — Duty Chosen, Devotion Retained',
                    priority: 55,
                    minDuration: 2,
                    text: '<devotion_vs_duty>\nCanon records that {{subject}} chose an established duty when it directly conflicted with devotion to {{user}}. Honor the action and its consequences without declaring the devotion false, shallow, or ended unless canon separately does so. Duty may bring conviction, grief, distance, relief, shame, necessity, or loss according to what was chosen. Do not manufacture {{user}}\'s forgiveness, condemnation, continued availability, or understanding.\n</devotion_vs_duty>',
                    condition: allStateRules(
                        relationshipMilestone('duty chosen over devotion'),
                        noRelationshipMilestone('devotion and duty renegotiated'),
                        noRelationshipMilestone('devotion and duty reconciled'),
                    ),
                    exitCondition: anyStateRules(
                        relationshipMilestone('devotion and duty renegotiated'),
                        relationshipMilestone('devotion and duty reconciled'),
                    ),
                },
                {
                    name: 'Branch — Devotion Chosen, Duty Consequences Active',
                    priority: 55,
                    minDuration: 2,
                    text: '<devotion_vs_duty>\nCanon records that {{subject}} chose devotion to {{user}} when it directly conflicted with an established duty. Preserve the duty as a real commitment with real stakeholders and consequences; choosing devotion does not retroactively make the obligation corrupt, trivial, or unwanted. Let fallout follow the actual office, oath, family, faction, cause, dependents, or role involved. Do not assume {{user}} requested, welcomes, rewards, or reciprocates the sacrifice.\n</devotion_vs_duty>',
                    condition: allStateRules(
                        relationshipMilestone('devotion chosen over duty'),
                        noRelationshipMilestone('devotion and duty renegotiated'),
                        noRelationshipMilestone('devotion and duty reconciled'),
                    ),
                    exitCondition: anyStateRules(
                        relationshipMilestone('devotion and duty renegotiated'),
                        relationshipMilestone('devotion and duty reconciled'),
                    ),
                },
                {
                    name: 'Branch — Both Choices Made, Costs Compound',
                    priority: 60,
                    minDuration: 2,
                    text: '<devotion_vs_duty>\nCanon records that {{subject}} chose duty over devotion in one direct conflict and devotion over duty in another. Preserve the order, circumstances, stakeholders, and costs of both decisions; the later choice does not cancel the earlier one or prove a final hierarchy of commitments. {{subject}} may now face compounded consequences, changed credibility, grief, relief, or pressure to establish durable terms. Do not flatten the history into indecision or hypocrisy, force reconciliation, or decide {{user}}\'s verdict.\n</devotion_vs_duty>',
                    condition: allStateRules(
                        relationshipMilestone('duty chosen over devotion'),
                        relationshipMilestone('devotion chosen over duty'),
                        noRelationshipMilestone('devotion and duty renegotiated'),
                        noRelationshipMilestone('devotion and duty reconciled'),
                    ),
                    exitCondition: anyStateRules(
                        relationshipMilestone('devotion and duty renegotiated'),
                        relationshipMilestone('devotion and duty reconciled'),
                    ),
                },
                {
                    name: 'Mode — Commitments on Renegotiated Terms',
                    priority: 70,
                    minDuration: 2,
                    text: '<devotion_vs_duty>\nCanon has established new terms intended to let {{subject}} carry devotion and duty differently: boundaries, disclosure, recusal, delegation, divided time, changed office, limited contact, contingency plans, or another specific arrangement. Follow those terms rather than treating negotiation as vague compromise. The arrangement can help, fail, or remain costly; it does not prove that every stakeholder consented or that the conflict is resolved.\n</devotion_vs_duty>',
                    condition: allStateRules(
                        relationshipMilestone('devotion and duty renegotiated'),
                        noRelationshipMilestone('devotion and duty reconciled'),
                    ),
                    exitCondition: relationshipMilestone('devotion and duty reconciled'),
                },
                {
                    name: 'Milestone — Devotion and Duty Reconciled, Costs Retained',
                    priority: 90,
                    minDuration: 2,
                    text: '<devotion_vs_duty>\nCanon establishes that the prior conflict between {{subject}}\'s devotion and duty has been materially reconciled. Preserve the specific solution and the history that made it necessary. Reconciliation may integrate the commitments, release or fulfill the duty, transform the bond, or create durable boundaries; it does not erase losses, guarantee approval, establish romance, or oblige {{user}} to remain in the relationship.\n</devotion_vs_duty>',
                    condition: relationshipMilestone('devotion and duty reconciled'),
                    exitCondition: noRelationshipMilestone('devotion and duty reconciled'),
                },
                { name: 'No active devotion-duty state', isFallback: true, priority: -100, text: '' },
            ],
        }],
    },
    {
        id: 'layered-social-bond',
        version: 3,
        name: 'Layered Social Bond',
        description: 'A non-romance bond model built from two small tracks: relational safety and everyday closeness. Trust, familiarity, comfort, affection, respect, and canonical ruptures can diverge instead of collapsing into one score.',
        tags: ['relationship', 'friendship', 'trust', 'slow burn', 'social dynamics'],
        setName: 'Preset — Layered Social Bond',
        stateBindings: [
            {
                key: 'familiarity',
                label: 'Familiarity',
                path: 'characters.$subject.familiarity',
                description: 'Shared history and how well the character knows the subject.',
                preferredSources: ['sa_relationship_ledger'],
            },
            {
                key: 'trust',
                label: 'Trust',
                path: 'characters.$subject.trust',
                description: 'Belief in the subject’s word and sense of interpersonal safety.',
                preferredSources: ['sa_relationship_ledger'],
            },
            {
                key: 'comfort',
                label: 'Comfort',
                path: 'characters.$subject.comfort',
                description: 'Ease, relaxation, and willingness to be unguarded around the subject.',
                preferredSources: ['sa_relationship_ledger'],
            },
            {
                key: 'affection',
                label: 'Affection',
                path: 'characters.$subject.affection',
                description: 'Platonic warmth and fondness; this does not imply attraction.',
                preferredSources: ['sa_relationship_ledger'],
            },
            {
                key: 'respect',
                label: 'Respect',
                path: 'characters.$subject.respect',
                description: 'Esteem for the subject’s judgment, competence, or character.',
                preferredSources: ['sa_relationship_ledger'],
            },
            {
                key: 'milestones',
                label: 'Relationship milestones',
                path: 'characters.$subject.milestones',
                description: 'Durable canon such as trust being broken or a rupture being reconciled.',
                preferredSources: ['sa_relationship_ledger'],
            },
        ],
        events: [],
        tracks: [
            {
                key: 'relational-safety-track',
                name: 'Relational Safety',
                description: 'Tracks guardedness, earned trust, rupture, and repair without declaring friendship or romance on score alone.',
                transitionMode: TrackTransitionMode.STICKY,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                states: [
                    {
                        name: 'Stage — Guarded Distance',
                        priority: 10,
                        minDuration: 2,
                        text: '<bond_state>\n{{subject}} does not yet feel securely known by or safe with {{user}}. Keep personal disclosure, reliance, and access proportionate to established history. This may appear as formality, observation, testing, deflection, or practical-only cooperation according to personality; it does not automatically mean hostility. A high affection or attraction score elsewhere does not override low familiarity or trust.\n</bond_state>',
                        condition: anyStateRules(
                            stateRule('familiarity', 'characters.$subject.familiarity', 'lt', 25),
                            stateRule('trust', 'characters.$subject.trust', 'lt', 25),
                        ),
                        exitCondition: anyStateRules(
                            allStateRules(
                                stateRule('familiarity', 'characters.$subject.familiarity', 'gte', 35),
                                stateRule('trust', 'characters.$subject.trust', 'gte', 35),
                            ),
                            stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                        ),
                    },
                    {
                        name: 'Stage — Tested Rapport',
                        priority: 20,
                        minDuration: 2,
                        text: '<bond_state>\n{{subject}} has enough experience with {{user}} for a cautious working rapport. Let familiarity show through remembered details, less formal speech, small requests, limited personal disclosure, or low-stakes initiative that fits characterization. Trust is still being tested: do not grant deep secrets, unconditional loyalty, forgiveness, or assumed intimacy merely because interactions have become easier.\n</bond_state>',
                        condition: allStateRules(
                            stateRule('familiarity', 'characters.$subject.familiarity', 'gte', 25),
                            stateRule('trust', 'characters.$subject.trust', 'gte', 30),
                        ),
                        exitCondition: anyStateRules(
                            stateRule('familiarity', 'characters.$subject.familiarity', 'lt', 15),
                            stateRule('trust', 'characters.$subject.trust', 'lt', 20),
                            allStateRules(
                                stateRule('familiarity', 'characters.$subject.familiarity', 'gte', 55),
                                stateRule('trust', 'characters.$subject.trust', 'gte', 55),
                                stateRule('comfort', 'characters.$subject.comfort', 'gte', 45),
                            ),
                            stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                        ),
                    },
                    {
                        name: 'Stage — Earned Safety',
                        priority: 30,
                        minDuration: 2,
                        text: '<bond_state>\n{{subject}} experiences {{user}} as a known and comparatively safe person. They may rely on {{user}}, share unpolished feelings, allow quiet companionship, or initiate contact in personality-consistent ways. Preserve boundaries and independent priorities: earned safety is not obedience, romantic consent, exclusivity, or immunity from future disappointment.\n</bond_state>',
                        condition: allStateRules(
                            stateRule('familiarity', 'characters.$subject.familiarity', 'gte', 55),
                            stateRule('trust', 'characters.$subject.trust', 'gte', 55),
                            stateRule('comfort', 'characters.$subject.comfort', 'gte', 45),
                        ),
                        exitCondition: anyStateRules(
                            stateRule('trust', 'characters.$subject.trust', 'lt', 40),
                            stateRule('comfort', 'characters.$subject.comfort', 'lt', 30),
                            stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                        ),
                    },
                    {
                        name: 'Rupture — Trust Broken',
                        priority: 60,
                        minDuration: 2,
                        text: '<bond_state>\nCanon records that trust between {{subject}} and {{user}} was broken, and current trust remains low. Let the rupture have specific consequences: guarded interpretation, reduced access, changed routines, verification, anger, grief, distance, or practical boundaries according to what actually happened and who {{subject}} is. Do not erase prior affection or history, but do not convert either into forgiveness.\n</bond_state>',
                        condition: allStateRules(
                            stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                            stateRule('trust', 'characters.$subject.trust', 'lt', 35),
                        ),
                        exitCondition: stateRule('trust', 'characters.$subject.trust', 'gte', 35),
                    },
                    {
                        name: 'Repair — Cautious Rebuilding',
                        priority: 55,
                        minDuration: 2,
                        text: '<bond_state>\n{{subject}} is cautiously rebuilding trust with {{user}} after a canonical rupture. Improvement should appear through small, testable permissions and consistent follow-through rather than an instant return to the old relationship. Mixed warmth, vigilance, hope, resentment, and setbacks may coexist. Do not declare the rupture resolved until reconciliation actually occurs in canon.\n</bond_state>',
                        condition: allStateRules(
                            stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                            stateRule('trust', 'characters.$subject.trust', 'gte', 35),
                            stateRule('trust', 'characters.$subject.trust', 'lt', 65),
                        ),
                        exitCondition: anyStateRules(
                            stateRule('trust', 'characters.$subject.trust', 'lt', 25),
                            stateRule('trust', 'characters.$subject.trust', 'gte', 65),
                        ),
                    },
                    {
                        name: 'Milestone — Reconciled, Not Erased',
                        priority: 70,
                        minDuration: 2,
                        text: '<bond_state>\nCanon records that {{subject}} and {{user}} reconciled after a breach of trust. The relationship may again permit reliance and closeness, but the rupture remains part of their shared history and can shape boundaries, sensitivities, and what reassurance means. Reconciliation is not amnesia, submission, romantic consent, or proof that every consequence disappeared.\n</bond_state>',
                        condition: allStateRules(
                            stateRule('milestones', 'characters.$subject.milestones', 'contains', 'reconciled after betrayal'),
                            stateRule('trust', 'characters.$subject.trust', 'gte', 65),
                        ),
                        exitCondition: anyStateRules(
                            {
                                ...stateRule('milestones', 'characters.$subject.milestones', 'contains', 'reconciled after betrayal'),
                                invert: true,
                            },
                            stateRule('trust', 'characters.$subject.trust', 'lt', 45),
                        ),
                    },
                    { name: 'No active safety state', isFallback: true, priority: -100, text: '' },
                ],
            },
            {
                key: 'everyday-closeness-track',
                name: 'Everyday Closeness',
                description: 'Layers the bond’s daily texture over relational safety, allowing warmth, comfort, and respect to disagree.',
                transitionMode: TrackTransitionMode.STICKY,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                states: [
                    {
                        name: 'Texture — Polite Distance',
                        priority: 10,
                        minDuration: 2,
                        text: '<bond_texture>\nIn ordinary interactions, {{subject}} keeps some personal distance from {{user}}. Favor role-appropriate courtesy, practical topics, and measured reactions over instant vulnerability or constant attention. Familiarity may still exist; this state only says that warmth and ease are currently limited.\n</bond_texture>',
                        condition: allStateRules(
                            stateRule('affection', 'characters.$subject.affection', 'lt', 40),
                            stateRule('comfort', 'characters.$subject.comfort', 'lt', 35),
                        ),
                        exitCondition: anyStateRules(
                            stateRule('affection', 'characters.$subject.affection', 'gte', 50),
                            stateRule('comfort', 'characters.$subject.comfort', 'gte', 45),
                        ),
                    },
                    {
                        name: 'Texture — Warm but Self-Conscious',
                        priority: 25,
                        minDuration: 2,
                        text: '<bond_texture>\n{{subject}} feels genuine fondness for {{user}}, but closeness is not yet effortless. Show warmth through character-specific small acts, attention, awkward initiative, selective sharing, or retreat after exposure. Affection here is platonic warmth unless attraction and canonical events separately establish romance.\n</bond_texture>',
                        condition: allStateRules(
                            stateRule('affection', 'characters.$subject.affection', 'gte', 45),
                            stateRule('comfort', 'characters.$subject.comfort', 'lt', 45),
                        ),
                        exitCondition: anyStateRules(
                            stateRule('affection', 'characters.$subject.affection', 'lt', 35),
                            stateRule('comfort', 'characters.$subject.comfort', 'gte', 55),
                        ),
                    },
                    {
                        name: 'Texture — Easy Companionship',
                        priority: 30,
                        minDuration: 2,
                        text: '<bond_texture>\n{{subject}} and {{user}} have an easy everyday rhythm. Let it surface through shorthand, remembered preferences, comfortable silence, mundane check-ins, shared habits, teasing, or unforced offers of time—whichever fits their established personalities. Ease does not require romance and should not flatten conflict, obligations, or separate lives.\n</bond_texture>',
                        condition: allStateRules(
                            stateRule('affection', 'characters.$subject.affection', 'gte', 50),
                            stateRule('comfort', 'characters.$subject.comfort', 'gte', 55),
                            stateRule('familiarity', 'characters.$subject.familiarity', 'gte', 40),
                        ),
                        exitCondition: anyStateRules(
                            stateRule('affection', 'characters.$subject.affection', 'lt', 40),
                            stateRule('comfort', 'characters.$subject.comfort', 'lt', 40),
                            stateRule('familiarity', 'characters.$subject.familiarity', 'lt', 30),
                        ),
                    },
                    {
                        name: 'Texture — Respectful Reserve',
                        priority: 35,
                        minDuration: 2,
                        text: '<bond_texture>\n{{subject}} respects {{user}} more than they feel personally warm or relaxed around them. Show serious attention to {{user}}’s competence, judgment, or principles while preserving emotional reserve and independent disagreement. Respect alone does not grant friendship, trust, affection, obedience, or intimacy.\n</bond_texture>',
                        condition: allStateRules(
                            stateRule('respect', 'characters.$subject.respect', 'gte', 65),
                            stateRule('affection', 'characters.$subject.affection', 'lt', 35),
                        ),
                        exitCondition: anyStateRules(
                            stateRule('respect', 'characters.$subject.respect', 'lt', 50),
                            stateRule('affection', 'characters.$subject.affection', 'gte', 45),
                        ),
                    },
                    {
                        name: 'Texture — Fond but Wary',
                        priority: 45,
                        minDuration: 2,
                        text: '<bond_texture>\n{{subject}} cares about {{user}} while still doubting their reliability or safety. Let concern, protectiveness, attention, frustration, verification, and reluctance coexist rather than forcing a single warm or cold attitude. Fondness does not cancel mistrust, and mistrust does not prove the fondness false.\n</bond_texture>',
                        condition: allStateRules(
                            stateRule('affection', 'characters.$subject.affection', 'gte', 60),
                            stateRule('trust', 'characters.$subject.trust', 'lt', 35),
                        ),
                        exitCondition: anyStateRules(
                            stateRule('affection', 'characters.$subject.affection', 'lt', 45),
                            stateRule('trust', 'characters.$subject.trust', 'gte', 45),
                        ),
                    },
                    { name: 'No active closeness texture', isFallback: true, priority: -100, text: '' },
                ],
            },
        ],
    },
]);

export function resolvePresetEventKeys(preset, selectedKeys = null) {
    if (!preset) return [];
    const definitions = [
        ...(preset.events || []),
        ...(preset.tracks || []),
        ...(preset.routers || []),
        ...(preset.scripts || []),
    ];
    const requested = new Set(selectedKeys ?? definitions.map(definition => definition.key));
    let changed = true;
    while (changed) {
        changed = false;
        for (const definition of definitions) {
            if (!requested.has(definition.key)) continue;
            for (const dependency of (definition.requires || [])) {
                if (!requested.has(dependency)) {
                    requested.add(dependency);
                    changed = true;
                }
            }
        }
    }
    return definitions.map(definition => definition.key).filter(key => requested.has(key));
}

export function instantiatePresetEvents(preset, selectedKeys = null, options = {}) {
    if (!preset) throw new Error('Unknown Dynamic Events preset.');
    const selection = new Set(resolvePresetEventKeys(preset, selectedKeys));
    const fallbackSource = options.stateSource || 'sa_relationship_ledger';
    const stateSources = options.stateSources && typeof options.stateSources === 'object'
        ? options.stateSources
        : {};
    const ids = new Map();
    const events = [];
    for (const definition of (preset.events || []).filter(event => selection.has(event.key))) {
        const event = createEvent();
        ids.set(definition.key, event.id);
        Object.assign(event, {
            ...definition,
            key: undefined,
            description: undefined,
            requires: undefined,
            enabled: false,
            sourcePresetId: preset.id,
            sourcePresetVersion: preset.version,
            subject: instantiatePresetSubject(
                options.subject || definition.subject || preset.subjectBinding?.default,
                stateSources,
                fallbackSource,
            ),
            injection: { ...SYSTEM_IN_CHAT, ...(definition.injection || {}) },
            sharedInstructionIds: (definition.sharedInstructionKeys || [])
                .map(key => `preset:${preset.id}:${key}`),
            schedule: { ...event.schedule, ...(definition.schedule || {}) },
            capture: { ...event.capture, ...(definition.capture || {}) },
            actions: normalizeDynamicActions(definition.actions),
            condition: instantiateCondition(definition.condition, stateSources, fallbackSource),
            phases: (definition.phases || []).map(phase => createPhase({
                ...phase,
                condition: instantiateCondition(phase.condition, stateSources, fallbackSource),
            })),
        });
        delete event.key;
        delete event.description;
        delete event.requires;
        delete event.sharedInstructionKeys;
        events.push(event);
    }
    for (const event of events) {
        const targetKey = event.condition?.targetKey;
        if (!targetKey) continue;
        event.condition.targetEventId = ids.get(targetKey) || '';
        delete event.condition.targetKey;
    }
    return events;
}

export function instantiatePresetSharedInstructions(preset, selectedKeys = null) {
    if (!preset) throw new Error('Unknown Dynamic Events preset.');
    const selection = new Set(resolvePresetEventKeys(preset, selectedKeys));
    const requested = new Set((preset.events || [])
        .filter(event => selection.has(event.key))
        .flatMap(event => event.sharedInstructionKeys || []));
    return (preset.sharedInstructions || [])
        .filter(block => requested.has(block.key))
        .map(block => createSharedInstruction({
            id: `preset:${preset.id}:${block.key}`,
            name: block.name,
            text: block.text,
            sourcePresetId: preset.id,
            sourcePresetVersion: preset.version,
        }));
}

function instantiatePresetSubject(definition, stateSources, fallbackSource) {
    const subject = createSubject(definition);
    const bindingPrefix = '$stateSource:';
    const bindingKey = String(subject.source || '').startsWith(bindingPrefix)
        ? String(subject.source).slice(bindingPrefix.length)
        : '';
    if (bindingKey) subject.source = stateSources[bindingKey] || fallbackSource;
    return subject;
}

function instantiateCondition(definition, stateSources, fallbackSource) {
    if (!definition) return createCondition();
    if (definition.type === ConditionType.GROUP) {
        return createConditionGroup({
            ...definition,
            conditions: (definition.conditions || []).map(child => instantiateCondition(child, stateSources, fallbackSource)),
        });
    }
    const bindingPrefix = '$stateSource:';
    const bindingKey = String(definition.source || '').startsWith(bindingPrefix)
        ? String(definition.source).slice(bindingPrefix.length)
        : '';
    return createCondition({
        ...definition,
        source: bindingKey
            ? (stateSources[bindingKey] || fallbackSource)
            : definition.source === '$relationshipSource' ? fallbackSource : definition.source,
    });
}

export function instantiatePresetTracks(preset, selectedKeys = null, options = {}) {
    if (!preset) throw new Error('Unknown Dynamic Events preset.');
    const selection = new Set(resolvePresetEventKeys(preset, selectedKeys));
    const fallbackSource = options.stateSource || 'sa_relationship_ledger';
    const stateSources = options.stateSources && typeof options.stateSources === 'object'
        ? options.stateSources
        : {};
    return (preset.tracks || []).filter(track => selection.has(track.key)).map(definition => {
        const track = createStateTrack({
            ...definition,
            enabled: false,
            sourcePresetId: preset.id,
            sourcePresetVersion: preset.version,
            subject: createTrackSubject(options.subject || definition.subject || preset.subjectBinding?.default),
            injection: { ...SYSTEM_IN_CHAT, ...(definition.injection || {}) },
            states: (definition.states || []).map(state => createTrackState({
                ...state,
                onEnterActions: normalizeDynamicActions(state.onEnterActions),
                condition: instantiateCondition(state.condition, stateSources, fallbackSource),
                exitCondition: instantiateCondition(state.exitCondition, stateSources, fallbackSource),
            })),
        });
        delete track.key;
        delete track.description;
        return track;
    });
}

export function instantiatePresetRouters(preset, selectedKeys = null, options = {}) {
    if (!preset) throw new Error('Unknown Dynamic Events preset.');
    const selection = new Set(resolvePresetEventKeys(preset, selectedKeys));
    const fallbackSource = options.stateSource || 'sa_relationship_ledger';
    const stateSources = options.stateSources && typeof options.stateSources === 'object'
        ? options.stateSources
        : {};
    return (preset.routers || []).filter(router => selection.has(router.key)).map(definition => {
        const router = createPromptRouter({
            ...definition,
            enabled: false,
            sourcePresetId: preset.id,
            sourcePresetVersion: preset.version,
            subject: instantiatePresetSubject(
                options.subject || definition.subject || preset.subjectBinding?.default,
                stateSources,
                fallbackSource,
            ),
            injection: { ...SYSTEM_IN_CHAT, ...(definition.injection || {}) },
            layers: (definition.layers || []).map(layer => createPromptLayer({
                ...layer,
                condition: instantiateCondition(layer.condition, stateSources, fallbackSource),
            })),
        });
        delete router.key;
        delete router.description;
        delete router.requires;
        return router;
    });
}

export function instantiatePresetScripts(preset, selectedKeys = null) {
    if (!preset) throw new Error('Unknown Dynamic Events preset.');
    const selection = new Set(resolvePresetEventKeys(preset, selectedKeys));
    return (preset.scripts || []).filter(script => selection.has(script.key)).map(definition => {
        const script = createScript();
        Object.assign(script, {
            ...definition,
            enabled: false,
            sourcePresetId: preset.id,
            sourcePresetVersion: preset.version,
            trigger: { ...script.trigger, ...(definition.trigger || {}) },
        });
        delete script.key;
        delete script.description;
        delete script.requires;
        return script;
    });
}

export function instantiatePreset(preset, options = {}) {
    if (!preset) throw new Error('Unknown Dynamic Events preset.');
    const set = createEventSet({
        name: options.setName?.trim() || preset.setName || preset.name,
        enabled: false,
        role: SetRole.PRIMARY,
        parentSetId: null,
        bindMode: BindMode.MANUAL,
        characterBindings: [],
        tagBindings: [],
        scripts: [],
        stateTracks: [],
        promptRouters: [],
        presetId: preset.id,
        presetVersion: preset.version,
    });
    set.events = instantiatePresetEvents(preset, options.selectedKeys, options);
    set.sharedInstructions = instantiatePresetSharedInstructions(preset, options.selectedKeys);
    set.stateTracks = instantiatePresetTracks(preset, options.selectedKeys, options);
    set.promptRouters = instantiatePresetRouters(preset, options.selectedKeys, options);
    set.scripts = instantiatePresetScripts(preset, options.selectedKeys);
    return set;
}

export function getPreset(presetId) {
    return BUILT_IN_PRESETS.find(preset => preset.id === presetId) ?? null;
}
