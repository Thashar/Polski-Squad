const { SlashCommandBuilder, REST, Routes } = require('discord.js');

const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Konklawe');
class CommandService {
    constructor(config) {
        this.config = config;
        this.rest = new REST({ version: '10' }).setToken(config.token);
        this.commands = this.createCommands();
    }

    /**
     * Tworzy definicje slash commands
     * @returns {Array} - Tablica z komendami
     */
    createCommands() {
        return [
            new SlashCommandBuilder()
                .setName('podpowiedzi')
                .setDescription('Pokaż wszystkie aktualne podpowiedzi'),
            new SlashCommandBuilder()
                .setName('statystyki')
                .setDescription('Pokaż szczegółowe statystyki gry (tylko dla Ciebie)'),
            new SlashCommandBuilder()
                .setName('blessing')
                .setDescription('Udziel błogosławieństwa innemu użytkownikowi (tylko Virtutti Papajlari)')
                .addUserOption(option =>
                    option.setName('użytkownik')
                        .setDescription('Użytkownik do błogosławienia')
                        .setRequired(true)),
            new SlashCommandBuilder()
                .setName('virtue-check')
                .setDescription('Sprawdź cnoty innego użytkownika (tylko Virtutti Papajlari)')
                .addUserOption(option =>
                    option.setName('użytkownik')
                        .setDescription('Użytkownik do sprawdzenia cnót')
                        .setRequired(true)),
            new SlashCommandBuilder()
                .setName('curse')
                .setDescription('Rzuć klątwę na innego użytkownika (tylko Virtutti Papajlari)')
                .addUserOption(option =>
                    option.setName('użytkownik')
                        .setDescription('Użytkownik do przeklęcia')
                        .setRequired(true))
        ];
    }

    /**
     * Rejestruje slash commands
     */
    async registerSlashCommands() {
        try {
            logger.info('Rozpoczęto odświeżanie slash commands...');
            if (this.config.guildId) {
                await this.rest.put(Routes.applicationGuildCommands(this.config.clientId, this.config.guildId), { body: this.commands });
            } else {
                await this.rest.put(Routes.applicationCommands(this.config.clientId), { body: this.commands });
            }
            logger.info('Pomyślnie odświeżono slash commands!');
        } catch (error) {
            logger.error('Błąd podczas rejestracji slash commands:', error);
        }
    }
}

module.exports = CommandService;