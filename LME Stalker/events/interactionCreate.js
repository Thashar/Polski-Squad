module.exports = async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    const { commandName } = interaction;
    
    try {
        let command;
        
        switch (commandName) {
            case 'punish':
                command = require('../commands/punish');
                break;
            case 'punishment':
                command = require('../commands/punishment');
                break;
            case 'points':
                command = require('../commands/points');
                break;
            case 'debug-roles':
                command = require('../commands/debug-roles');
                break;
            default:
                console.log(`❌ Nieznana komenda: ${commandName}`);
                return;
        }
        
        if (command && command.execute) {
            console.log(`🔧 Wykonywanie komendy: ${commandName} przez ${interaction.user.tag}`);
            await command.execute(interaction);
        } else {
            console.log(`❌ Brak executora dla komendy: ${commandName}`);
        }
        
    } catch (error) {
        console.error(`❌ Błąd podczas wykonywania komendy ${commandName}:`, error);
        
        const errorMessage = '❌ Wystąpił błąd podczas wykonywania komendy!';
        
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ content: errorMessage, ephemeral: true });
        } else {
            await interaction.reply({ content: errorMessage, ephemeral: true });
        }
    }
};
