const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

module.exports = {
    token: process.env.KONKLAWE_TOKEN,
    clientId: process.env.KONKLAWE_CLIENT_ID,
    guildId: process.env.KONKLAWE_GUILD_ID,
    channels: {
        trigger: "1377549511542439976",
        start: "1377633547028005027",
        command: "1377633547028005027",
        attempts: "1377633547028005027",
        reminder: "1377633547028005027"
    },
    roles: {
        papal: "1298897770844786699",
        virtuttiPapajlari: "1387383527653376081"
    },
    timers: {
        autoResetMinutes: 15,
        reminderMinutes: 10,
        hintReminderHours: 8,
        papalRoleRemovalHours: 24
    },
    emojis: {
        medal: "<:M_Medal:1209754405373747260>",
        virtuttiPapajlari: "<:X_VirtuttiPapajlariii:1387387615229251715>",
        warning: "<a:X_Uwaga:1297531538186965003>",
        warning2: "<a:X_Uwaga2:1297532628395622440>",
        jp2roll: "<a:Y_JP2roll:1297288153622773914>"
    },
    messages: {
        defaultPassword: "Konklawe",
        habemusPapam: "# HABEMUS PAPAM!",
        passwordSet: "## {emoji} Nowe hasło zostało ustawione! {emoji}",
        hintAdded: "## {emoji} Podpowiedź została dodana! {emoji}",
        autoReset: "## {emoji} Hasło zostało automatycznie ustawione na \"Konklawe\" po {minutes} minutach bezczynności! {emoji}",
        roleRemoved: "## {emoji} Rola papieska została usunięta za brak podpowiedzi przez 24 godziny! {emoji}",
        virtuttiPapajlariAchieved: "## 🏆 {user} osiągnął 30 poprawnych odpowiedzi i otrzymuje medal Virtutti Papajlari! {emoji} 🏆",
        rankingReset: "## 🔄 Ranking został zresetowany! Nowy cykl rozpoczyna się teraz! 🔄"
    },
    achievements: {
        virtuttiPapajlariThreshold: 30
    },
    randomResponse: {
        virtuttiPapajlariChance: 100 // 1 in 100 chance (1%)
    },
    virtuttiPapajlari: {
        cooldownMinutes: 10,
        dailyLimit: 5,
        blessings: [
            "🙏 Niech Ci się zawsze trafia zielone światło na przejściach! ✨",
            "💫 Błogosławię Cię mocą nieśmiertelnych memów! 🌟",
            "👑 Niech Twój internet nigdy się nie zawiesza podczas ważnych momentów! 🕊️",
            "⭐ Błogosławię Cię łaską zawsze trafnych gifów w odpowiedzi! 💫",
            "✨ Niech Twoje baterie w telefonie zawsze mają więcej niż 20%! 🙏",
            "🌟 Niech Ci się zawsze udaje znaleźć miejsce parkingowe! 🚗",
            "🙏 Błogosławię Cię łaską nigdy nie zapomnianych haseł! 🔐",
            "💫 Niech Twoje kanapki nigdy nie spadną masłem w dół! 🥪",
            "✨ Błogosławię Cię mocą zawsze działających słuchawek! 🎧",
            "👑 Niech Ci się zawsze udaje trafić w USB za pierwszym razem! 💻",
            "🕊️ Błogosławię Cię łaską bezpiecznych aktualizacji! ⬆️",
            "⭐ Niech Twoja pizza zawsze będzie idealne! 🍕"
        ],
        virtues: [
            "Memiczność",
            "Cierpliwość na Loading",
            "Mądrość Googlowania",
            "Pokora przed Bugami",
            "Wytrwałość w Kolejkach",
            "Łaska WiFi",
            "Cnota Backup'owania",
            "Mądrość Update'ów",
            "Pokora przed Autocorrectem",
            "Świętość Dark Mode"
        ],
        papalAdvice: [
            "Módl się więcej do Google'a, synu.",
            "Potrzebujesz więcej błogosławieństwa stackoverflow.",
            "Idź i naucz się ctrl+z, dziecko.",
            "Twoja cnota wymaga więcej tutoriali na YouTube.",
            "Idź i naucz się więcej skrótów klawiszowych, dziecko.",
            "Potrzebujesz więcej medytacji nad Stack Overflow.",
            "Módl się częściej do dokumentacji, synu.",
            "Twoja dusza wymaga więcej backup'ów.",
            "Idź i przeczytaj changelog, moje dziecko.",
            "Potrzebujesz błogosławieństwa lepszych komentarzy w kodzie.",
            "Módl się za szybszy internet, synu.",
            "Twoja cnota wymaga więcej ctrl+s.",
            "Idź i naucz się git'a, dziecko.",
            "Potrzebujesz więcej debugowania w życiu."
        ]
    }
};