require('dotenv').config();

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
    }
};