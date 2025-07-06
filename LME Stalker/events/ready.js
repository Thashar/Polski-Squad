const { readDatabase, showDatabaseStats } = require('../database/database');
const { setupWeeklyRemoval } = require('../database/weeklyRemoval');
const { SlashCommandBuilder } = require('discord.js');
const config = require('../config/config');

module.exports = async (client) => {
    console.log('\n🎉 ==================== BOT GOTOWY ====================');
    console.log(`🤖 Bot zalogowany jako: ${client.user.tag}`);
    console.log(`📅 Czas logowania: ${new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}`);
    console.log(`🏰 Liczba serwerów: ${client.guilds.cache.size}`);
    console.log(`🎭 Rola karania: ${config.PUNISHMENT_ROLE_ID}`);
    
    console.log('\n📢 ==================== KANAŁY OSTRZEŻEŃ ====================');
    for (const [roleId, channelId] of Object.entries(config.WARNING_CHANNELS)) {
        const roleKey = Object.keys(config.TARGET_ROLES).find(key => config.TARGET_ROLES[key] === roleId);
        const roleName = config.ROLE_DISPLAY_NAMES[roleKey] || roleId;
        console.log(`🎭 ${roleName}: kanał ${channelId}`);
    }
    
    console.log('\n🔍 ==================== WZORCE WYKRYWANIA ZERA ====================');
    console.log('✅ Standardowe wzorce: 0, 0.0, 0,0');
    console.log('✅ Wzorce nawiasów: (1), [1], [1, (1');
    console.log('✅ Wzorce litery "o": o (z wykluczeniem trzycyfrowych liczb)');
    console.log('✅ Wzorzec "zo": zo (case-insensitive)');
    
    console.log('\n🗓️ ==================== NOWA LOGIKA USUWANIA PUNKTÓW ====================');
    console.log('✅ Sprawdzanie: czy ostatnie usuwanie było przed ostatnim poniedziałkiem o północy');
    console.log('✅ Następne usuwanie: zawsze ustawiane na następny poniedziałek o północy');
    
    // Ustawienie tygodniowego usuwania punktów
    await setupWeeklyRemoval();
    
    // Inicjalizacja bazy danych JSON
    console.log('\n💾 Inicjalizacja bazy danych JSON...');
    try {
        await readDatabase();
        console.log('✅ Baza danych JSON gotowa');
        await showDatabaseStats();
    } catch (error) {
        console.error('❌ Błąd podczas inicjalizacji bazy danych:', error);
    }
    
    // Rejestrowanie komend
    await registerCommands(client);
};

async function registerCommands(client) {
    console.log('\n⚙️ ==================== REJESTROWANIE KOMEND ====================');
    
    const commands = [
        new SlashCommandBuilder()
            .setName('punish')
            .setDescription('Analizuj zdjęcie i znajdź graczy z wynikiem 0')
            .addAttachmentOption(option =>
                option.setName('image')
                    .setDescription('Zdjęcie do analizy')
                    .setRequired(true)
            ),
        
        new SlashCommandBuilder()
            .setName('punishment')
            .setDescription('Wyświetl ranking punktów karnych')
            .addStringOption(option =>
                option.setName('category')
                    .setDescription('Kategoria rankingu')
                    .setRequired(true)
                    .addChoices(
                        { name: '🎮PolskiSquad⁰🎮', value: '0' },
                        { name: '⚡PolskiSquad¹⚡', value: '1' },
                        { name: '💥PolskiSquad²💥', value: '2' },
                        { name: '🔥Polski Squad🔥', value: 'main' }
                    )
            ),
        
        new SlashCommandBuilder()
            .setName('points')
            .setDescription('Dodaj lub odejmij punkty użytkownikowi')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('Użytkownik')
                    .setRequired(true)
            )
            .addIntegerOption(option =>
                option.setName('amount')
                    .setDescription('Liczba punktów (dodatnia = dodaj, ujemna = odejmij, puste = usuń użytkownika)')
                    .setRequired(false)
                    .setMinValue(-20)
                    .setMaxValue(20)
            ),
        
        new SlashCommandBuilder()
            .setName('debug-roles')
            .setDescription('Debugowanie ról na serwerze')
            .addStringOption(option =>
                option.setName('category')
                    .setDescription('Kategoria do sprawdzenia')
                    .setRequired(true)
                    .addChoices(
                        { name: '🎮PolskiSquad⁰🎮', value: '0' },
                        { name: '⚡PolskiSquad¹⚡', value: '1' },
                        { name: '💥PolskiSquad²💥', value: '2' },
                        { name: '🔥Polski Squad🔥', value: 'main' }
                    )
            )
    ];
    
    try {
        await client.application.commands.set(commands);
        console.log('✅ Komendy zarejestrowane pomyślnie');
    } catch (error) {
        console.error('❌ Błąd podczas rejestrowania komend:', error);
    }
}
