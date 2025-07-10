const { SlashCommandBuilder, REST, Routes } = require('discord.js');

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
                .setName('podpowiedz')
                .setDescription('Dodaj podpowiedź do aktualnego hasła')
                .addStringOption(option =>
                    option.setName('tekst')
                        .setDescription('Treść podpowiedzi')
                        .setRequired(true)),
            new SlashCommandBuilder()
                .setName('podpowiedzi')
                .setDescription('Pokaż wszystkie aktualne podpowiedzi'),
            new SlashCommandBuilder()
                .setName('wyniki')
                .setDescription('Pokaż ranking graczy (tylko dla Ciebie)'),
            new SlashCommandBuilder()
                .setName('medale')
                .setDescription('Pokaż ranking medali Virtutti Papajlari (tylko dla Ciebie)')
        ];
    }

    /**
     * Rejestruje slash commands
     */
    async registerSlashCommands() {
        try {
            console.log('Rozpoczęto odświeżanie slash commands...');
            if (this.config.guildId) {
                await this.rest.put(Routes.applicationGuildCommands(this.config.clientId, this.config.guildId), { body: this.commands });
            } else {
                await this.rest.put(Routes.applicationCommands(this.config.clientId), { body: this.commands });
            }
            console.log('Pomyślnie odświeżono slash commands!');
        } catch (error) {
            console.error('Błąd podczas rejestracji slash commands:', error);
        }
    }
}

module.exports = CommandService;