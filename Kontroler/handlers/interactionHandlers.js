const { SlashCommandBuilder, REST, Routes } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Kontroler');

/**
 * Obsługuje wszystkie interakcje Discord dla Kontroler bot
 */
async function handleInteraction(interaction, config) {
    try {
        if (interaction.isChatInputCommand()) {
            switch (interaction.commandName) {
                case 'ocr-debug':
                    await handleOcrDebugCommand(interaction, config);
                    break;
                default:
                    await interaction.reply({ content: 'Nieznana komenda!', ephemeral: true });
            }
        }
    } catch (error) {
        logger.error('❌ Błąd obsługi interakcji:', error);
        
        const errorMessage = '❌ Wystąpił błąd podczas wykonywania komendy.';
        
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: errorMessage, ephemeral: true });
        } else {
            await interaction.reply({ content: errorMessage, ephemeral: true });
        }
    }
}

/**
 * Obsługuje komendę debug OCR
 */
async function handleOcrDebugCommand(interaction, config) {
    // Sprawdź uprawnienia administratora
    if (!interaction.member.permissions.has('Administrator')) {
        await interaction.reply({
            content: '❌ Nie masz uprawnień do używania tej komendy. Wymagane: **Administrator**',
            ephemeral: true
        });
        return;
    }
    
    const enabled = interaction.options.getBoolean('enabled');
    
    if (enabled === null) {
        // Sprawdź aktualny stan
        const currentState = config.ocr.detailedLogging.enabled;
        await interaction.reply({
            content: `🔍 **Szczegółowe logowanie OCR:** ${currentState ? '✅ Włączone' : '❌ Wyłączone'}`,
            ephemeral: true
        });
        return;
    }
    
    // Przełącz stan
    config.ocr.detailedLogging.enabled = enabled;
    
    const statusText = enabled ? '✅ Włączone' : '❌ Wyłączone';
    const emoji = enabled ? '🔍' : '🔇';
    
    logger.info(`${emoji} Szczegółowe logowanie OCR zostało ${enabled ? 'włączone' : 'wyłączone'} przez ${interaction.user.tag}`);
    
    await interaction.reply({
        content: `${emoji} **Szczegółowe logowanie OCR:** ${statusText}`,
        ephemeral: true
    });
}

/**
 * Rejestruje komendy slash
 */
async function registerSlashCommands(client, config) {
    const commands = [
        new SlashCommandBuilder()
            .setName('ocr-debug')
            .setDescription('Przełącz szczegółowe logowanie OCR')
            .addBooleanOption(option =>
                option.setName('enabled')
                    .setDescription('Włącz (true) lub wyłącz (false) szczegółowe logowanie')
                    .setRequired(false))
    ];

    const rest = new REST().setToken(config.token);
    
    try {
        logger.info('[COMMANDS] 🔄 Rejestracja komend slash...');
        await rest.put(
            Routes.applicationGuildCommands(config.clientId, config.guildId),
            { body: commands }
        );
        logger.info('[COMMANDS] ✅ Komendy slash zarejestrowane pomyślnie');
    } catch (error) {
        logger.error('[COMMANDS] ❌ Błąd rejestracji komend slash:', error);
    }
}

module.exports = {
    handleInteraction,
    registerSlashCommands
};