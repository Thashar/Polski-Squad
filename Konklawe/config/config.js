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
            "🍫 Niech Ci dropi same toblerony! 🎁",
            "💎 Niech Ci gemy tylko przybywają! 📈",
            "💰 Niech Ci wszystkie zwroty przechodzą! ✅",
            "🎮 Niech Habby nie jebie na kasę! 🚫",
            "🎉 Niech eventy dają bez użycia gemów! 🆓",
            "🚫 Żebyś nie padał na Ops Retreat! 💪",
            "📈 Żebyś dostał awans! 🏆",
            "🛡️ Żebyś nie spadł do klanu niżej! ⬇️",
            "🛒 Żebyś wykupił cały sklep klanowy! 💸",
            "💳 Żebyś nie musiał sprzedać konta! 🚨",
            "⚡ Niech Ci wszystkie skille na EE siądą w 10 sekund! ⏱️",
            "🏅 Żebyś doszedł do Championa! 👑",
            "👔 Żeby szef nie krzyczał, żeś nierób i leser! 😤",
            "💀 Żebyś nie zbijał ostatni bossa! 🎯",
            "🚀 Żebyś nie zapomniał o booscie serwera! 💖",
            "✨ Żebyś pamiętał o przedłużeniu nitro! 🔥",
            "🔧 Żebyś nie musiał zmieniać EQ na różnych trybach gry! ⚙️",
            "📋 Żeby ZO było zawsze zrobione! ✅",
            "🗼 Żebyś stanął na 15000 poziomie PoT! 📈",
            "🔋 Niech Twoja bateria w telefonie zawsze będzie powyżej 20%! ⚡",
            "💸 Żebyś zrobił duże zakupy u Habby za 0 PLN! 🆓",
            "🌟 Niech Ci sypie Awaken Corami! 💫"
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