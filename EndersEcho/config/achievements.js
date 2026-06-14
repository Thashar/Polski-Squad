'use strict';

const RARITY = {
    common:    { pol: 'Zwykłe',      eng: 'Common',    emoji: '⚪', color: 0x95a5a6 },
    uncommon:  { pol: 'Niepospolite', eng: 'Uncommon', emoji: '🟢', color: 0x2ecc71 },
    rare:      { pol: 'Rzadkie',     eng: 'Rare',      emoji: '🔵', color: 0x3498db },
    epic:      { pol: 'Epickie',     eng: 'Epic',      emoji: '🟣', color: 0x9b59b6 },
    legendary: { pol: 'Legendarne',  eng: 'Legendary', emoji: '🟠', color: 0xe67e22 },
    mythic:    { pol: 'Mityczne',    eng: 'Mythic',    emoji: '🔴', color: 0xe74c3c },
};

const CATEGORY_INFO = {
    score:    { pol: '🏆 Wyniki',      eng: '🏆 Scores'   },
    records:  { pol: '🔁 Rekordy',     eng: '🔁 Records'  },
    bosses:   { pol: '🎯 Łowy',        eng: '🎯 The Hunt' },
    explorer: { pol: '🕵️ Eksplorator', eng: '🕵️ Explorer', hidden: true },
    prestige: { pol: '💎 Prestiż',     eng: '💎 Prestige'  },
};

// check(progress, context) — progress = user's stored progress object,
// context = { scoreValue, isNewRecord, prevScoreValue, currentPosition, bossName }
const ACHIEVEMENTS = [
    // ===== WYNIKI (SCORES) =====
    {
        id: 'score_100k', category: 'score', rarity: 'common', hidden: false, icon: '🎯',
        namePol: 'Zawodnik',   nameEng: 'Contender',
        descPol: 'Osiągnij wynik 100K', descEng: 'Reach a score of 100K',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 100_000,
    },
    {
        id: 'score_100m', category: 'score', rarity: 'uncommon', hidden: false, icon: '💰',
        namePol: 'Potentat',   nameEng: 'Potentate',
        descPol: 'Osiągnij wynik 100M', descEng: 'Reach a score of 100M',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 100_000_000,
    },
    {
        id: 'score_100b', category: 'score', rarity: 'rare', hidden: false, icon: '🐋',
        namePol: 'Lewiatan',   nameEng: 'Leviathan',
        descPol: 'Osiągnij wynik 100B', descEng: 'Reach a score of 100B',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 100_000_000_000,
    },
    {
        id: 'score_100t', category: 'score', rarity: 'epic', hidden: false, icon: '🗿',
        namePol: 'Kolos',   nameEng: 'Colossus',
        descPol: 'Osiągnij wynik 100T', descEng: 'Reach a score of 100T',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 100_000_000_000_000,
    },
    {
        id: 'score_100q', category: 'score', rarity: 'legendary', hidden: false, icon: '⚡',
        namePol: 'Półbóg',   nameEng: 'Demigod',
        descPol: 'Osiągnij wynik 100Q', descEng: 'Reach a score of 100Q',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 1e17,
    },
    {
        id: 'score_100qi', category: 'score', rarity: 'mythic', hidden: false, icon: '🌌',
        namePol: 'Nieśmiertelny',   nameEng: 'Immortal',
        descPol: 'Osiągnij wynik 100Qi', descEng: 'Reach a score of 100Qi',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 1e20,
    },
    {
        id: 'score_100sx', category: 'score', rarity: 'mythic', hidden: false, icon: '☀️',
        namePol: 'Bóg Wyników',   nameEng: 'Score God',
        descPol: 'Osiągnij wynik 100Sx', descEng: 'Reach a score of 100Sx',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 1e23,
    },
    {
        id: 'score_100sp', category: 'score', rarity: 'mythic', hidden: false, icon: '💫',
        namePol: 'Władca Septylionów',   nameEng: 'Lord of Septillions',
        descPol: 'Osiągnij wynik 100Sp', descEng: 'Reach a score of 100Sp',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 1e26,
    },
    {
        id: 'score_100xx', category: 'score', rarity: 'mythic', hidden: false, icon: '🌀',
        namePol: 'Poza Granicami',   nameEng: 'Beyond Limits',
        descPol: 'Osiągnij wynik w nieznanej jednostce', descEng: 'Reach a score in an unknown unit',
        check: (_p, ctx) => (ctx.scoreValue || 0) >= 1e29,
    },

    // ===== REKORDY (RECORDS) =====
    {
        id: 'record_1', category: 'records', rarity: 'common', hidden: false, icon: '🔥',
        namePol: 'Przetarłem Szlak',   nameEng: 'Trail Blazer',
        descPol: 'Pobij swój pierwszy rekord', descEng: 'Beat your first record',
        check: (p, _ctx) => (p.recordCount || 0) >= 1,
    },
    {
        id: 'record_10', category: 'records', rarity: 'uncommon', hidden: false, icon: '💪',
        namePol: 'Dziesięcioboista',   nameEng: 'Decathlete',
        descPol: 'Pobij rekord 10 razy', descEng: 'Beat your record 10 times',
        check: (p, _ctx) => (p.recordCount || 0) >= 10,
    },
    {
        id: 'record_20', category: 'records', rarity: 'uncommon', hidden: false, icon: '🪖',
        namePol: 'Weteran',   nameEng: 'Veteran',
        descPol: 'Pobij rekord 20 razy', descEng: 'Beat your record 20 times',
        check: (p, _ctx) => (p.recordCount || 0) >= 20,
    },
    {
        id: 'record_50', category: 'records', rarity: 'rare', hidden: false, icon: '⚔️',
        namePol: 'Nieugięty',   nameEng: 'Relentless',
        descPol: 'Pobij rekord 50 razy', descEng: 'Beat your record 50 times',
        check: (p, _ctx) => (p.recordCount || 0) >= 50,
    },
    {
        id: 'record_100', category: 'records', rarity: 'epic', hidden: false, icon: '🛡️',
        namePol: 'Stuprocentowy',   nameEng: 'Centurion',
        descPol: 'Pobij rekord 100 razy', descEng: 'Beat your record 100 times',
        check: (p, _ctx) => (p.recordCount || 0) >= 100,
    },
    {
        id: 'record_200', category: 'records', rarity: 'epic', hidden: false, icon: '🗡️',
        namePol: 'Dwieście',   nameEng: 'Double Centurion',
        descPol: 'Pobij rekord 200 razy', descEng: 'Beat your record 200 times',
        check: (p, _ctx) => (p.recordCount || 0) >= 200,
    },
    {
        id: 'record_500', category: 'records', rarity: 'legendary', hidden: false, icon: '🌟',
        namePol: 'Pięćset',   nameEng: 'Five Hundred',
        descPol: 'Pobij rekord 500 razy', descEng: 'Beat your record 500 times',
        check: (p, _ctx) => (p.recordCount || 0) >= 500,
    },
    {
        id: 'record_1000', category: 'records', rarity: 'mythic', hidden: false, icon: '💫',
        namePol: 'Tysiącznik',   nameEng: 'Millennial',
        descPol: 'Pobij rekord 1000 razy', descEng: 'Beat your record 1000 times',
        check: (p, _ctx) => (p.recordCount || 0) >= 1000,
    },

    // ===== BOSSOWIE (BOSSES) =====
    {
        id: 'boss_first', category: 'bosses', rarity: 'common', hidden: false, icon: '👁️',
        namePol: 'Pierwsze Starcie',   nameEng: 'First Encounter',
        descPol: 'Wyślij wynik z dowolnego bossa', descEng: 'Submit a score from any boss',
        check: (p, _ctx) => (p.bossesEncountered || []).length >= 1,
    },
    {
        id: 'boss_3', category: 'bosses', rarity: 'uncommon', hidden: false, icon: '🗺️',
        namePol: 'Łowca',   nameEng: 'Hunter',
        descPol: 'Wyślij wyniki z 3 różnych bossów', descEng: 'Submit scores from 3 different bosses',
        check: (p, _ctx) => (p.bossesEncountered || []).length >= 3,
    },
    {
        id: 'boss_hunter', category: 'bosses', rarity: 'rare', hidden: false, icon: '🏹',
        namePol: 'Łowca Bossów',   nameEng: 'Boss Hunter',
        descPol: 'Wyślij wyniki z 5 różnych bossów', descEng: 'Submit scores from 5 different bosses',
        check: (p, _ctx) => (p.bossesEncountered || []).length >= 5,
    },
    {
        id: 'boss_veteran', category: 'bosses', rarity: 'epic', hidden: false, icon: '🦅',
        namePol: 'Weteran Łowów',   nameEng: 'Hunt Veteran',
        descPol: 'Wyślij wyniki z 7 różnych bossów', descEng: 'Submit scores from 7 different bosses',
        check: (p, _ctx) => (p.bossesEncountered || []).length >= 7,
    },
    {
        id: 'boss_master', category: 'bosses', rarity: 'legendary', hidden: false, icon: '⚜️',
        namePol: 'Mistrz Łowów',   nameEng: 'Master of the Hunt',
        descPol: 'Wyślij wyniki z 10 różnych bossów', descEng: 'Submit scores from 10 different bosses',
        check: (p, _ctx) => (p.bossesEncountered || []).length >= 10,
    },
    {
        id: 'boss_legend', category: 'bosses', rarity: 'mythic', hidden: false, icon: '🐉',
        namePol: 'Legenda Łowów',   nameEng: 'Legend of the Hunt',
        descPol: 'Wyślij wyniki z 13 różnych bossów', descEng: 'Submit scores from 13 different bosses',
        check: (p, _ctx) => (p.bossesEncountered || []).length >= 13,
    },

    // ===== EKSPLORATOR (EXPLORER) — ukryte =====
    {
        id: 'view_10', category: 'explorer', rarity: 'common', hidden: true, icon: '👀',
        namePol: 'Obserwator',   nameEng: 'Observer',
        descPol: 'Sprawdź ranking 10 razy', descEng: 'View the ranking 10 times',
        check: (p, _ctx) => (p.rankingViews || 0) >= 10,
    },
    {
        id: 'view_50', category: 'explorer', rarity: 'uncommon', hidden: true, icon: '🔬',
        namePol: 'Analityk',   nameEng: 'Analyst',
        descPol: 'Sprawdź ranking 50 razy', descEng: 'View the ranking 50 times',
        check: (p, _ctx) => (p.rankingViews || 0) >= 50,
    },
    {
        id: 'view_200', category: 'explorer', rarity: 'rare', hidden: true, icon: '🔍',
        namePol: 'Detektyw',   nameEng: 'Detective',
        descPol: 'Sprawdź ranking 200 razy', descEng: 'View the ranking 200 times',
        check: (p, _ctx) => (p.rankingViews || 0) >= 200,
    },
    {
        id: 'sub_first', category: 'explorer', rarity: 'common', hidden: true, icon: '📣',
        namePol: 'Kibol',   nameEng: 'Fan',
        descPol: 'Aktywuj swoją pierwszą subskrypcję', descEng: 'Activate your first subscription',
        check: (p, _ctx) => (p.subscriptions || 0) >= 1,
    },
    {
        id: 'sub_5', category: 'explorer', rarity: 'uncommon', hidden: true, icon: '❤️',
        namePol: 'Zagorzały Kibic',   nameEng: 'Devoted Fan',
        descPol: 'Aktywuj 5 subskrypcji', descEng: 'Activate 5 subscriptions',
        check: (p, _ctx) => (p.subscriptions || 0) >= 5,
    },
    {
        id: 'improve_100pct', category: 'explorer', rarity: 'legendary', hidden: true, icon: '🚀',
        namePol: 'Podwójny Postęp',   nameEng: 'Double Progress',
        descPol: 'Podwój swój wynik w jednym podejściu', descEng: 'Double your score in one submission',
        check: (_p, ctx) => ctx.prevScoreValue > 0 && ctx.scoreValue >= ctx.prevScoreValue * 2,
    },
    {
        id: 'improve_200pct', category: 'explorer', rarity: 'mythic', hidden: true, icon: '☄️',
        namePol: 'Potrójny Postęp',   nameEng: 'Triple Progress',
        descPol: 'Potróż swój wynik w jednym podejściu', descEng: 'Triple your score in one submission',
        check: (_p, ctx) => ctx.prevScoreValue > 0 && ctx.scoreValue >= ctx.prevScoreValue * 3,
    },
    {
        id: 'improve_5x', category: 'explorer', rarity: 'mythic', hidden: true, icon: '💥',
        namePol: 'Wielki Wybuch',   nameEng: 'Big Bang',
        descPol: 'Zwiększ wynik 5× w jednym podejściu', descEng: 'Multiply your score by 5 in one submission',
        check: (_p, ctx) => ctx.prevScoreValue > 0 && ctx.scoreValue >= ctx.prevScoreValue * 5,
    },
    {
        id: 'improve_tiny', category: 'explorer', rarity: 'epic', hidden: true, icon: '🪶',
        namePol: 'Na Włosku',   nameEng: 'By a Hair',
        descPol: 'Pobij rekord o mniej niż 0,5%', descEng: 'Beat your record by less than 0.5%',
        check: (_p, ctx) => ctx.prevScoreValue > 0 && ctx.scoreValue > ctx.prevScoreValue && ctx.scoreValue < ctx.prevScoreValue * 1.005,
    },
    {
        id: 'improve_micro', category: 'explorer', rarity: 'legendary', hidden: true, icon: '🔬',
        namePol: 'Chirurg',   nameEng: 'Surgeon',
        descPol: 'Pobij rekord o mniej niż 0,1%', descEng: 'Beat your record by less than 0.1%',
        check: (_p, ctx) => ctx.prevScoreValue > 0 && ctx.scoreValue > ctx.prevScoreValue && ctx.scoreValue < ctx.prevScoreValue * 1.001,
    },
    {
        id: 'comeback_60', category: 'explorer', rarity: 'rare', hidden: true, icon: '⌛',
        namePol: 'Powrót Legendy',   nameEng: 'Return of a Legend',
        descPol: 'Pobij rekord po przerwie ponad 60 dni', descEng: 'Beat a record after a break of over 60 days',
        check: (p, _ctx) => {
            if (!p.lastRecordAt) return false;
            const daysSince = (Date.now() - new Date(p.lastRecordAt).getTime()) / (1000 * 60 * 60 * 24);
            return daysSince >= 60;
        },
    },
    {
        id: 'comeback_180', category: 'explorer', rarity: 'legendary', hidden: true, icon: '🏺',
        namePol: 'Niezniszczalny',   nameEng: 'Indestructible',
        descPol: 'Pobij rekord po przerwie ponad 180 dni', descEng: 'Beat a record after a break of over 180 days',
        check: (p, _ctx) => {
            if (!p.lastRecordAt) return false;
            const daysSince = (Date.now() - new Date(p.lastRecordAt).getTime()) / (1000 * 60 * 60 * 24);
            return daysSince >= 180;
        },
    },
    {
        id: 'view_500', category: 'explorer', rarity: 'epic', hidden: true, icon: '📚',
        namePol: 'Kronikarz',   nameEng: 'Chronicler',
        descPol: 'Sprawdź ranking 500 razy', descEng: 'View the ranking 500 times',
        check: (p, _ctx) => (p.rankingViews || 0) >= 500,
    },
    {
        id: 'sub_10', category: 'explorer', rarity: 'rare', hidden: true, icon: '💙',
        namePol: 'Wielbiciel',   nameEng: 'Devotee',
        descPol: 'Aktywuj 10 subskrypcji', descEng: 'Activate 10 subscriptions',
        check: (p, _ctx) => (p.subscriptions || 0) >= 10,
    },
    {
        id: 'night_owl', category: 'explorer', rarity: 'uncommon', hidden: true, icon: '🌙',
        namePol: 'Nocna Mara',   nameEng: 'Night Owl',
        descPol: 'Pobij rekord między północą a 4:00 UTC', descEng: 'Beat a record between midnight and 4:00 UTC',
        check: (_p, _ctx) => { const h = new Date().getUTCHours(); return h >= 0 && h < 4; },
    },
    {
        id: 'throne_defender', category: 'explorer', rarity: 'rare', hidden: true, icon: '🏰',
        namePol: 'Obrońca Tronu',   nameEng: 'Throne Defender',
        descPol: 'Pobij rekord będąc na pozycji #1', descEng: 'Beat a record while holding #1',
        check: (_p, ctx) => ctx.prevScoreValue > 0 && ctx.currentPosition === 1,
    },
    {
        id: 'tsunami', category: 'explorer', rarity: 'mythic', hidden: true, icon: '🌊',
        namePol: 'Tsunami',   nameEng: 'Tsunami',
        descPol: 'Zwiększ wynik 10× w jednym podejściu', descEng: 'Multiply your score by 10× in one submission',
        check: (_p, ctx) => ctx.prevScoreValue > 0 && ctx.scoreValue >= ctx.prevScoreValue * 10,
    },
    {
        id: 'unlucky_13', category: 'explorer', rarity: 'epic', hidden: true, icon: '💀',
        namePol: 'Pechowa 13',   nameEng: 'Unlucky 13',
        descPol: 'Zajmij dokładnie 13. miejsce w rankingu', descEng: 'Rank exactly #13 on the server',
        check: (_p, ctx) => ctx.currentPosition === 13,
    },
    {
        id: 'lucky_seven', category: 'explorer', rarity: 'rare', hidden: true, icon: '🎰',
        namePol: 'Siódemka Szczęścia',   nameEng: 'Lucky Seven',
        descPol: 'Pobij rekord dokładnie 7 razy', descEng: 'Beat your record exactly 7 times',
        check: (p, _ctx) => (p.recordCount || 0) === 7,
    },
    {
        id: 'same_day', category: 'explorer', rarity: 'rare', hidden: true, icon: '⚡',
        namePol: 'Niestrudzony',   nameEng: 'Unstoppable',
        descPol: 'Pobij rekord 2 razy tego samego dnia', descEng: 'Beat your record twice in the same day',
        check: (p, _ctx) => (p.todayRecordCount || 0) >= 2,
    },
    {
        id: 'same_day_3', category: 'explorer', rarity: 'legendary', hidden: true, icon: '🌪️',
        namePol: 'Wir Siły',   nameEng: 'Whirlwind',
        descPol: 'Pobij rekord 3 razy tego samego dnia', descEng: 'Beat your record 3 times in the same day',
        check: (p, _ctx) => (p.todayRecordCount || 0) >= 3,
    },
    {
        id: 'no_record', category: 'explorer', rarity: 'common', hidden: true, icon: '📸',
        namePol: 'Dla Historii',   nameEng: 'For the Record',
        descPol: 'Dodaj screen nie pobijając rekordu', descEng: 'Submit a screenshot without beating your record',
        check: (p, _ctx) => (p.nonRecordCount || 0) >= 1,
    },
    {
        id: 'cv_approved', category: 'explorer', rarity: 'epic', hidden: true, icon: '🏛️',
        namePol: 'Oczyszczony',   nameEng: 'Cleared',
        descPol: 'Twój wynik został zatwierdzony przez admina po zgłoszeniu', descEng: 'Your score was approved by an admin after being reported',
        check: (p, _ctx) => (p.cvApprovedCount || 0) >= 1,
    },
    {
        id: 'ai_rescued', category: 'explorer', rarity: 'rare', hidden: true, icon: '🤖',
        namePol: 'Ocalony przez Admina',   nameEng: 'Admin Rescue',
        descPol: 'Twój wynik przeanalizowany przez admina po odrzuceniu przez AI', descEng: 'Your score was re-analyzed by an admin after AI rejection',
        check: (p, _ctx) => (p.aiRescuedCount || 0) >= 1,
    },
    {
        id: 'early_bird', category: 'explorer', rarity: 'uncommon', hidden: true, icon: '🐓',
        namePol: 'Ranny Ptaszek',   nameEng: 'Early Bird',
        descPol: 'Pobij rekord między 5:00 a 9:00 UTC', descEng: 'Beat a record between 5:00 and 9:00 UTC',
        check: (_p, _ctx) => { const h = new Date().getUTCHours(); return h >= 5 && h < 9; },
    },
    {
        id: 'no_record_10', category: 'explorer', rarity: 'uncommon', hidden: true, icon: '🪨',
        namePol: 'Uparty',   nameEng: 'Stubborn',
        descPol: 'Dodaj 10 screenów nie pobijając rekordu', descEng: 'Submit 10 screenshots without beating your record',
        check: (p, _ctx) => (p.nonRecordCount || 0) >= 10,
    },
    {
        id: 'new_year', category: 'explorer', rarity: 'rare', hidden: true, icon: '🎆',
        namePol: 'Nowy Rok',   nameEng: 'New Year',
        descPol: 'Pobij rekord 1 stycznia', descEng: 'Beat a record on January 1st',
        check: (_p, _ctx) => { const d = new Date(); return d.getUTCMonth() === 0 && d.getUTCDate() === 1; },
    },
    {
        id: 'sub_25', category: 'explorer', rarity: 'rare', hidden: true, icon: '💜',
        namePol: 'Ultrafan',   nameEng: 'Ultra Fan',
        descPol: 'Aktywuj 25 subskrypcji', descEng: 'Activate 25 subscriptions',
        check: (p, _ctx) => (p.subscriptions || 0) >= 25,
    },
    {
        id: 'no_record_50', category: 'explorer', rarity: 'rare', hidden: true, icon: '🎭',
        namePol: 'Masochista',   nameEng: 'Masochist',
        descPol: 'Dodaj 50 screenów nie pobijając rekordu', descEng: 'Submit 50 screenshots without beating your record',
        check: (p, _ctx) => (p.nonRecordCount || 0) >= 50,
    },
    {
        id: 'same_day_5', category: 'explorer', rarity: 'mythic', hidden: true, icon: '🏃',
        namePol: 'Maratończyk',   nameEng: 'Marathon Runner',
        descPol: 'Pobij rekord 5 razy tego samego dnia', descEng: 'Beat your record 5 times in the same day',
        check: (p, _ctx) => (p.todayRecordCount || 0) >= 5,
    },
    {
        id: 'comeback_365', category: 'explorer', rarity: 'mythic', hidden: true, icon: '🦅',
        namePol: 'Feniks',   nameEng: 'Phoenix',
        descPol: 'Wróć po 365 dniach przerwy', descEng: 'Beat a record after a break of over 365 days',
        check: (p, _ctx) => {
            if (!p.lastRecordAt) return false;
            const daysSince = (Date.now() - new Date(p.lastRecordAt).getTime()) / (1000 * 60 * 60 * 24);
            return daysSince >= 365;
        },
    },
    {
        id: 'position_69', category: 'explorer', rarity: 'epic', hidden: true, icon: '😏',
        namePol: 'Nice',   nameEng: 'Nice',
        descPol: 'Zajmij dokładnie miejsce #69', descEng: 'Rank exactly #69 on the server',
        check: (_p, ctx) => ctx.currentPosition === 69,
    },
    {
        id: 'christmas', category: 'explorer', rarity: 'epic', hidden: true, icon: '🎄',
        namePol: 'Świąteczny Wojownik',   nameEng: 'Christmas Warrior',
        descPol: 'Pobij rekord 25 grudnia', descEng: 'Beat a record on December 25th',
        check: (_p, _ctx) => { const d = new Date(); return d.getUTCMonth() === 11 && d.getUTCDate() === 25; },
    },
    {
        id: 'cv_approved_3', category: 'explorer', rarity: 'legendary', hidden: true, icon: '⚖️',
        namePol: 'Nietykalny',   nameEng: 'Untouchable',
        descPol: 'Twój wynik zatwierdzony przez admina 3 razy po zgłoszeniu', descEng: 'Your score was approved by an admin 3 times after being reported',
        check: (p, _ctx) => (p.cvApprovedCount || 0) >= 3,
    },
    {
        id: 'view_1000', category: 'explorer', rarity: 'legendary', hidden: true, icon: '📖',
        namePol: 'Encyklopedysta',   nameEng: 'Encyclopedist',
        descPol: 'Sprawdź ranking 1000 razy', descEng: 'View the ranking 1000 times',
        check: (p, _ctx) => (p.rankingViews || 0) >= 1000,
    },
    {
        id: 'friday_13', category: 'explorer', rarity: 'legendary', hidden: true, icon: '🕐',
        namePol: 'Pechowiec',   nameEng: 'Black Friday',
        descPol: 'Pobij rekord w piątek 13-go', descEng: 'Beat a record on Friday the 13th',
        check: (_p, _ctx) => { const d = new Date(); return d.getUTCDay() === 5 && d.getUTCDate() === 13; },
    },
    {
        id: 'profile_spy_1', category: 'explorer', rarity: 'common', hidden: true, icon: '🔍',
        namePol: 'Szpieg',   nameEng: 'Spy',
        descPol: 'Wyszukaj gracza przez /profile', descEng: 'Search for a player via /profile',
        check: (p, _ctx) => (p.profileSearches || 0) >= 1,
    },
    {
        id: 'profile_spy_10', category: 'explorer', rarity: 'uncommon', hidden: true, icon: '🕵️',
        namePol: 'Wywiadowca',   nameEng: 'Scout',
        descPol: 'Wyszukaj 10 graczy przez /profile', descEng: 'Search for 10 players via /profile',
        check: (p, _ctx) => (p.profileSearches || 0) >= 10,
    },
    {
        id: 'profile_spy_50', category: 'explorer', rarity: 'rare', hidden: true, icon: '🧐',
        namePol: 'Obserwator Profili',   nameEng: 'Profile Analyst',
        descPol: 'Wyszukaj 50 graczy przez /profile', descEng: 'Search for 50 players via /profile',
        check: (p, _ctx) => (p.profileSearches || 0) >= 50,
    },
    {
        id: 'profile_spy_100', category: 'explorer', rarity: 'epic', hidden: true, icon: '🗃️',
        namePol: 'Archiwista',   nameEng: 'Archivist',
        descPol: 'Wyszukaj 100 graczy przez /profile', descEng: 'Search for 100 players via /profile',
        check: (p, _ctx) => (p.profileSearches || 0) >= 100,
    },
    {
        id: 'profile_spy_250', category: 'explorer', rarity: 'legendary', hidden: true, icon: '👁️',
        namePol: 'Wszechwiedzący',   nameEng: 'Omniscient',
        descPol: 'Wyszukaj 250 graczy przez /profile', descEng: 'Search for 250 players via /profile',
        check: (p, _ctx) => (p.profileSearches || 0) >= 250,
    },

    // ===== PRESTIŻ (PRESTIGE) =====
    {
        id: 'rank_top10', category: 'prestige', rarity: 'rare', hidden: false, icon: '🎖️',
        namePol: 'Elita Serwera',   nameEng: 'Server Elite',
        descPol: 'Zdobądź miejsce w Top 10 serwera', descEng: 'Reach the Top 10 on the server',
        check: (_p, ctx) => ctx.currentPosition > 0 && ctx.currentPosition <= 10,
    },
    {
        id: 'rank_top3', category: 'prestige', rarity: 'epic', hidden: false, icon: '🏅',
        namePol: 'Podium',   nameEng: 'Podium',
        descPol: 'Zdobądź miejsce w Top 3 serwera', descEng: 'Reach the Top 3 on the server',
        check: (_p, ctx) => ctx.currentPosition > 0 && ctx.currentPosition <= 3,
    },
    {
        id: 'rank_top1', category: 'prestige', rarity: 'legendary', hidden: false, icon: '👑',
        namePol: 'Mistrz Serwera',   nameEng: 'Server Champion',
        descPol: 'Zdobądź miejsce #1 na serwerze', descEng: 'Reach #1 on the server',
        check: (_p, ctx) => ctx.currentPosition === 1,
    },
    {
        id: 'comeback', category: 'prestige', rarity: 'rare', hidden: false, icon: '🌅',
        namePol: 'Powrót',   nameEng: 'Comeback',
        descPol: 'Pobij rekord po przerwie ponad 30 dni', descEng: 'Beat a record after a break of over 30 days',
        check: (p, _ctx) => {
            if (!p.lastRecordAt) return false;
            const daysSince = (Date.now() - new Date(p.lastRecordAt).getTime()) / (1000 * 60 * 60 * 24);
            return daysSince >= 30;
        },
    },
    {
        id: 'rank_top20', category: 'prestige', rarity: 'uncommon', hidden: false, icon: '🎗️',
        namePol: 'Pretendent',   nameEng: 'Contender',
        descPol: 'Zdobądź miejsce w Top 20 serwera', descEng: 'Reach the Top 20 on the server',
        check: (_p, ctx) => ctx.currentPosition > 0 && ctx.currentPosition <= 20,
    },
    {
        id: 'rank_top5', category: 'prestige', rarity: 'epic', hidden: false, icon: '🥈',
        namePol: 'Finał',   nameEng: 'Finals',
        descPol: 'Zdobądź miejsce w Top 5 serwera', descEng: 'Reach the Top 5 on the server',
        check: (_p, ctx) => ctx.currentPosition > 0 && ctx.currentPosition <= 5,
    },
    {
        id: 'global_top100', category: 'prestige', rarity: 'common', hidden: false, icon: '🌍',
        namePol: 'Globalny Wojownik',   nameEng: 'Global Warrior',
        descPol: 'Wejdź w Top 100 globalnie', descEng: 'Reach the Global Top 100',
        check: (_p, ctx) => (ctx.globalPosition || 0) > 0 && ctx.globalPosition <= 100,
    },
    {
        id: 'global_top50', category: 'prestige', rarity: 'uncommon', hidden: false, icon: '🌏',
        namePol: 'Globalny Pretendent',   nameEng: 'Global Contender',
        descPol: 'Wejdź w Top 50 globalnie', descEng: 'Reach the Global Top 50',
        check: (_p, ctx) => (ctx.globalPosition || 0) > 0 && ctx.globalPosition <= 50,
    },
    {
        id: 'global_top30', category: 'prestige', rarity: 'rare', hidden: false, icon: '🌐',
        namePol: 'Globalna Czołówka',   nameEng: 'Global Top Tier',
        descPol: 'Wejdź w Top 30 globalnie', descEng: 'Reach the Global Top 30',
        check: (_p, ctx) => (ctx.globalPosition || 0) > 0 && ctx.globalPosition <= 30,
    },
    {
        id: 'global_top20', category: 'prestige', rarity: 'rare', hidden: false, icon: '✨',
        namePol: 'Elita Globalna',   nameEng: 'Global Elite',
        descPol: 'Wejdź w Top 20 globalnie', descEng: 'Reach the Global Top 20',
        check: (_p, ctx) => (ctx.globalPosition || 0) > 0 && ctx.globalPosition <= 20,
    },
    {
        id: 'global_top10', category: 'prestige', rarity: 'epic', hidden: false, icon: '🌟',
        namePol: 'Frontrunner',   nameEng: 'Frontrunner',
        descPol: 'Wejdź w Top 10 globalnie', descEng: 'Reach the Global Top 10',
        check: (_p, ctx) => (ctx.globalPosition || 0) > 0 && ctx.globalPosition <= 10,
    },
    {
        id: 'global_top3', category: 'prestige', rarity: 'legendary', hidden: false, icon: '🌌',
        namePol: 'Globalne Podium',   nameEng: 'Global Podium',
        descPol: 'Wejdź w Top 3 globalnie', descEng: 'Reach the Global Top 3',
        check: (_p, ctx) => (ctx.globalPosition || 0) > 0 && ctx.globalPosition <= 3,
    },
    {
        id: 'global_top1', category: 'prestige', rarity: 'mythic', hidden: false, icon: '👑',
        namePol: 'Władca Galaktyki',   nameEng: 'Galaxy Ruler',
        descPol: 'Zajmij #1 globalnie', descEng: 'Reach #1 globally',
        check: (_p, ctx) => ctx.globalPosition === 1,
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
