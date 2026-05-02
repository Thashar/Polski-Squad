'use strict';

const RARITY = {
    common:    { pol: 'Zwykłe',      eng: 'Common',    emoji: '⬜', color: 0x95a5a6 },
    uncommon:  { pol: 'Niepospolite', eng: 'Uncommon', emoji: '🟩', color: 0x2ecc71 },
    rare:      { pol: 'Rzadkie',     eng: 'Rare',      emoji: '🟦', color: 0x3498db },
    epic:      { pol: 'Epickie',     eng: 'Epic',      emoji: '🟪', color: 0x9b59b6 },
    legendary: { pol: 'Legendarne',  eng: 'Legendary', emoji: '🟧', color: 0xe67e22 },
    mythic:    { pol: 'Mityczne',    eng: 'Mythic',    emoji: '🔴', color: 0xe74c3c },
};

const CATEGORY_INFO = {
    score:    { pol: '🏆 Wyniki',      eng: '🏆 Scores'   },
    records:  { pol: '🔁 Rekordy',     eng: '🔁 Records'  },
    bosses:   { pol: '🐉 Bossowie',    eng: '🐉 Bosses'   },
    explorer: { pol: '🕵️ Eksplorator', eng: '🕵️ Explorer' },
    prestige: { pol: '💎 Prestiż',     eng: '💎 Prestige'  },
};

// check(progress, context) — progress = user's stored progress object,
// context = { scoreValue, isNewRecord, prevScoreValue, currentPosition, bossName }
const ACHIEVEMENTS = [
    // ===== WYNIKI (SCORES) =====
    {
        id: 'score_first', category: 'score', rarity: 'common', hidden: false,
        namePol: 'Pierwsze Kroki',   nameEng: 'First Steps',
        descPol: 'Prześlij swój pierwszy wynik', descEng: 'Submit your first score',
        check: (_p, ctx) => ctx.isNewRecord,
    },
    {
        id: 'score_1k', category: 'score', rarity: 'common', hidden: false,
        namePol: 'Debiutant',   nameEng: 'Beginner',
        descPol: 'Osiągnij wynik 1 000', descEng: 'Reach a score of 1,000',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 1_000,
    },
    {
        id: 'score_10k', category: 'score', rarity: 'common', hidden: false,
        namePol: 'Aspirant',   nameEng: 'Aspirant',
        descPol: 'Osiągnij wynik 10 000', descEng: 'Reach a score of 10,000',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 10_000,
    },
    {
        id: 'score_100k', category: 'score', rarity: 'common', hidden: false,
        namePol: 'Zawodnik',   nameEng: 'Contender',
        descPol: 'Osiągnij wynik 100 000', descEng: 'Reach a score of 100,000',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 100_000,
    },
    {
        id: 'score_1m', category: 'score', rarity: 'uncommon', hidden: false,
        namePol: 'Milioner',   nameEng: 'Millionaire',
        descPol: 'Osiągnij wynik 1M', descEng: 'Reach a score of 1M',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 1_000_000,
    },
    {
        id: 'score_10m', category: 'score', rarity: 'uncommon', hidden: false,
        namePol: 'Magnat',   nameEng: 'Magnate',
        descPol: 'Osiągnij wynik 10M', descEng: 'Reach a score of 10M',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 10_000_000,
    },
    {
        id: 'score_100m', category: 'score', rarity: 'uncommon', hidden: false,
        namePol: 'Potentat',   nameEng: 'Potentate',
        descPol: 'Osiągnij wynik 100M', descEng: 'Reach a score of 100M',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 100_000_000,
    },
    {
        id: 'score_1b', category: 'score', rarity: 'rare', hidden: false,
        namePol: 'Miliarder',   nameEng: 'Billionaire',
        descPol: 'Osiągnij wynik 1B', descEng: 'Reach a score of 1B',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 1_000_000_000,
    },
    {
        id: 'score_10b', category: 'score', rarity: 'rare', hidden: false,
        namePol: 'Gigant',   nameEng: 'Giant',
        descPol: 'Osiągnij wynik 10B', descEng: 'Reach a score of 10B',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 10_000_000_000,
    },
    {
        id: 'score_100b', category: 'score', rarity: 'rare', hidden: false,
        namePol: 'Lewiatan',   nameEng: 'Leviathan',
        descPol: 'Osiągnij wynik 100B', descEng: 'Reach a score of 100B',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 100_000_000_000,
    },
    {
        id: 'score_1t', category: 'score', rarity: 'epic', hidden: false,
        namePol: 'Tytan',   nameEng: 'Titan',
        descPol: 'Osiągnij wynik 1T', descEng: 'Reach a score of 1T',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 1_000_000_000_000,
    },
    {
        id: 'score_10t', category: 'score', rarity: 'epic', hidden: false,
        namePol: 'Behemot',   nameEng: 'Behemoth',
        descPol: 'Osiągnij wynik 10T', descEng: 'Reach a score of 10T',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 10_000_000_000_000,
    },
    {
        id: 'score_100t', category: 'score', rarity: 'epic', hidden: false,
        namePol: 'Kolos',   nameEng: 'Colossus',
        descPol: 'Osiągnij wynik 100T', descEng: 'Reach a score of 100T',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 100_000_000_000_000,
    },
    {
        id: 'score_1q', category: 'score', rarity: 'legendary', hidden: false,
        namePol: 'Feniks',   nameEng: 'Phoenix',
        descPol: 'Osiągnij wynik 1Q', descEng: 'Reach a score of 1Q',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 1e15,
    },
    {
        id: 'score_10q', category: 'score', rarity: 'legendary', hidden: false,
        namePol: 'Smok',   nameEng: 'Dragon',
        descPol: 'Osiągnij wynik 10Q', descEng: 'Reach a score of 10Q',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 1e16,
    },
    {
        id: 'score_100q', category: 'score', rarity: 'legendary', hidden: false,
        namePol: 'Półbóg',   nameEng: 'Demigod',
        descPol: 'Osiągnij wynik 100Q', descEng: 'Reach a score of 100Q',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 1e17,
    },
    {
        id: 'score_1qi', category: 'score', rarity: 'mythic', hidden: false,
        namePol: 'Nieśmiertelny',   nameEng: 'Immortal',
        descPol: 'Osiągnij wynik 1Qi', descEng: 'Reach a score of 1Qi',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 1e18,
    },
    {
        id: 'score_10qi', category: 'score', rarity: 'mythic', hidden: false,
        namePol: 'Transcendent',   nameEng: 'Transcendent',
        descPol: 'Osiągnij wynik 10Qi', descEng: 'Reach a score of 10Qi',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 1e19,
    },
    {
        id: 'score_1sx', category: 'score', rarity: 'mythic', hidden: false,
        namePol: 'Bóg Wyników',   nameEng: 'Score God',
        descPol: 'Osiągnij wynik 1Sx', descEng: 'Reach a score of 1Sx',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 1e21,
    },
    {
        id: 'score_1sp', category: 'score', rarity: 'mythic', hidden: false,
        namePol: 'Poza Granicami',   nameEng: 'Beyond Limits',
        descPol: 'Osiągnij wynik w nieznanej jednostce', descEng: 'Reach a score in an unknown unit',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 1e24,
    },

    // ===== REKORDY (RECORDS) =====
    {
        id: 'record_1', category: 'records', rarity: 'common', hidden: false,
        namePol: 'Przetarłem Szlak',   nameEng: 'Trail Blazer',
        descPol: 'Pobij swój pierwszy rekord', descEng: 'Beat your first record',
        check: (p, _ctx) => (p.recordCount || 0) >= 1,
    },
    {
        id: 'record_10', category: 'records', rarity: 'uncommon', hidden: false,
        namePol: 'Dziesięcioboista',   nameEng: 'Decathlete',
        descPol: 'Pobij rekord 10 razy', descEng: 'Beat your record 10 times',
        check: (p, _ctx) => (p.recordCount || 0) >= 10,
    },
    {
        id: 'record_20', category: 'records', rarity: 'uncommon', hidden: false,
        namePol: 'Weteran',   nameEng: 'Veteran',
        descPol: 'Pobij rekord 20 razy', descEng: 'Beat your record 20 times',
        check: (p, _ctx) => (p.recordCount || 0) >= 20,
    },
    {
        id: 'record_50', category: 'records', rarity: 'rare', hidden: false,
        namePol: 'Nieugięty',   nameEng: 'Relentless',
        descPol: 'Pobij rekord 50 razy', descEng: 'Beat your record 50 times',
        check: (p, _ctx) => (p.recordCount || 0) >= 50,
    },
    {
        id: 'record_100', category: 'records', rarity: 'epic', hidden: false,
        namePol: 'Stuprocentowy',   nameEng: 'Centurion',
        descPol: 'Pobij rekord 100 razy', descEng: 'Beat your record 100 times',
        check: (p, _ctx) => (p.recordCount || 0) >= 100,
    },
    {
        id: 'record_200', category: 'records', rarity: 'epic', hidden: false,
        namePol: 'Dwieście',   nameEng: 'Double Centurion',
        descPol: 'Pobij rekord 200 razy', descEng: 'Beat your record 200 times',
        check: (p, _ctx) => (p.recordCount || 0) >= 200,
    },
    {
        id: 'record_500', category: 'records', rarity: 'legendary', hidden: false,
        namePol: 'Pięćset',   nameEng: 'Five Hundred',
        descPol: 'Pobij rekord 500 razy', descEng: 'Beat your record 500 times',
        check: (p, _ctx) => (p.recordCount || 0) >= 500,
    },
    {
        id: 'record_1000', category: 'records', rarity: 'mythic', hidden: false,
        namePol: 'Tysiącznik',   nameEng: 'Millennial',
        descPol: 'Pobij rekord 1000 razy', descEng: 'Beat your record 1000 times',
        check: (p, _ctx) => (p.recordCount || 0) >= 1000,
    },
    {
        id: 'improve_100pct', category: 'records', rarity: 'rare', hidden: false,
        namePol: 'Podwójny Postęp',   nameEng: 'Double Progress',
        descPol: 'Podwój swój wynik w jednym podejściu', descEng: 'Double your score in one submission',
        check: (_p, ctx) => ctx.prevScoreValue > 0 && ctx.scoreValue >= ctx.prevScoreValue * 2,
    },
    {
        id: 'improve_200pct', category: 'records', rarity: 'legendary', hidden: false,
        namePol: 'Potrójny Postęp',   nameEng: 'Triple Progress',
        descPol: 'Potróż swój wynik w jednym podejściu', descEng: 'Triple your score in one submission',
        check: (_p, ctx) => ctx.prevScoreValue > 0 && ctx.scoreValue >= ctx.prevScoreValue * 3,
    },

    // ===== BOSSOWIE (BOSSES) =====
    {
        id: 'boss_first', category: 'bosses', rarity: 'common', hidden: false,
        namePol: 'Pierwsze Starcie',   nameEng: 'First Encounter',
        descPol: 'Wyślij wynik z dowolnego bossa', descEng: 'Submit a score from any boss',
        check: (p, _ctx) => (p.bossesEncountered || []).length >= 1,
    },
    {
        id: 'boss_3', category: 'bosses', rarity: 'uncommon', hidden: false,
        namePol: 'Łowca',   nameEng: 'Hunter',
        descPol: 'Wyślij wyniki z 3 różnych bossów', descEng: 'Submit scores from 3 different bosses',
        check: (p, _ctx) => (p.bossesEncountered || []).length >= 3,
    },
    {
        id: 'boss_hunter', category: 'bosses', rarity: 'rare', hidden: false,
        namePol: 'Łowca Bossów',   nameEng: 'Boss Hunter',
        descPol: 'Wyślij wyniki z 5 różnych bossów', descEng: 'Submit scores from 5 different bosses',
        check: (p, _ctx) => (p.bossesEncountered || []).length >= 5,
    },

    // ===== EKSPLORATOR (EXPLORER) — ukryte =====
    {
        id: 'view_10', category: 'explorer', rarity: 'common', hidden: true,
        namePol: 'Obserwator',   nameEng: 'Observer',
        descPol: 'Sprawdź ranking 10 razy', descEng: 'View the ranking 10 times',
        check: (p, _ctx) => (p.rankingViews || 0) >= 10,
    },
    {
        id: 'view_50', category: 'explorer', rarity: 'uncommon', hidden: true,
        namePol: 'Analityk',   nameEng: 'Analyst',
        descPol: 'Sprawdź ranking 50 razy', descEng: 'View the ranking 50 times',
        check: (p, _ctx) => (p.rankingViews || 0) >= 50,
    },
    {
        id: 'view_200', category: 'explorer', rarity: 'rare', hidden: true,
        namePol: 'Detektyw',   nameEng: 'Detective',
        descPol: 'Sprawdź ranking 200 razy', descEng: 'View the ranking 200 times',
        check: (p, _ctx) => (p.rankingViews || 0) >= 200,
    },
    {
        id: 'sub_first', category: 'explorer', rarity: 'common', hidden: true,
        namePol: 'Kibol',   nameEng: 'Fan',
        descPol: 'Aktywuj swoją pierwszą subskrypcję', descEng: 'Activate your first subscription',
        check: (p, _ctx) => (p.subscriptions || 0) >= 1,
    },
    {
        id: 'sub_5', category: 'explorer', rarity: 'uncommon', hidden: true,
        namePol: 'Zagorzały Kibic',   nameEng: 'Devoted Fan',
        descPol: 'Aktywuj 5 subskrypcji', descEng: 'Activate 5 subscriptions',
        check: (p, _ctx) => (p.subscriptions || 0) >= 5,
    },

    // ===== PRESTIŻ (PRESTIGE) =====
    {
        id: 'rank_top10', category: 'prestige', rarity: 'rare', hidden: false,
        namePol: 'Elita Serwera',   nameEng: 'Server Elite',
        descPol: 'Zdobądź miejsce w Top 10 serwera', descEng: 'Reach the Top 10 on the server',
        check: (_p, ctx) => ctx.currentPosition > 0 && ctx.currentPosition <= 10,
    },
    {
        id: 'rank_top3', category: 'prestige', rarity: 'epic', hidden: false,
        namePol: 'Podium',   nameEng: 'Podium',
        descPol: 'Zdobądź miejsce w Top 3 serwera', descEng: 'Reach the Top 3 on the server',
        check: (_p, ctx) => ctx.currentPosition > 0 && ctx.currentPosition <= 3,
    },
    {
        id: 'rank_top1', category: 'prestige', rarity: 'legendary', hidden: false,
        namePol: 'Mistrz Serwera',   nameEng: 'Server Champion',
        descPol: 'Zdobądź miejsce #1 na serwerze', descEng: 'Reach #1 on the server',
        check: (_p, ctx) => ctx.currentPosition === 1,
    },
    {
        id: 'big_leap', category: 'prestige', rarity: 'uncommon', hidden: false,
        namePol: 'Wielki Skok',   nameEng: 'Big Leap',
        descPol: 'Popraw wynik o ponad 50% w jednym podejściu', descEng: 'Improve your score by more than 50% in one submission',
        check: (_p, ctx) => ctx.prevScoreValue > 0 && ctx.scoreValue >= ctx.prevScoreValue * 1.5,
    },
    {
        id: 'comeback', category: 'prestige', rarity: 'rare', hidden: false,
        namePol: 'Powrót',   nameEng: 'Comeback',
        descPol: 'Pobij rekord po przerwie ponad 30 dni', descEng: 'Beat a record after a break of over 30 days',
        check: (p, _ctx) => {
            if (!p.lastRecordAt) return false;
            const daysSince = (Date.now() - new Date(p.lastRecordAt).getTime()) / (1000 * 60 * 60 * 24);
            return daysSince >= 30;
        },
    },
];

// Dynamiczny status — oddzielny od stałych osiągnięć, może być odebrany
const DYNAMIC_STATUSES = [
    {
        id: 'status_top1',
        namePol: '👑 Aktualny Lider',
        nameEng: '👑 Current Leader',
        descPol: 'Aktualnie zajmuje #1 na serwerze',
        descEng: 'Currently holds #1 on the server',
    },
];

module.exports = { ACHIEVEMENTS, RARITY, CATEGORY_INFO, DYNAMIC_STATUSES };
