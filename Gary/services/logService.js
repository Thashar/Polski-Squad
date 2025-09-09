class LogService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.client = null; // Will be set when bot initializes
    }

    setClient(client) {
        this.client = client;
    }

    async logToChannel(message, isError = false) {
        if (!this.client || !this.config.logChannelId) {
            this.logger.warn('Log channel not configured or client not available');
            return;
        }

        try {
            const logChannel = await this.client.channels.fetch(this.config.logChannelId);
            if (logChannel) {
                const timestamp = new Date().toISOString();
                const logMessage = `\`[${timestamp}]\` ${isError ? '❌' : '✅'} ${message}`;
                
                // Ensure message doesn't exceed Discord limit
                const truncatedMessage = logMessage.length > 2000 
                    ? logMessage.substring(0, 1997) + '...'
                    : logMessage;
                
                await logChannel.send(truncatedMessage);
            }
        } catch (error) {
            this.logger.error('Failed to log to Discord channel:', error.message);
        }
    }

    async logCommand(interaction, commandName, details = '') {
        const message = `**${interaction.user.tag}** used command \`/${commandName}\` in ${interaction.channel.name}${details ? ` - ${details}` : ''}`;
        await this.logToChannel(message);
        this.logger.info(`Command used: /${commandName} by ${interaction.user.tag}${details ? ` - ${details}` : ''}`);
    }

    async logError(error, context = '') {
        const message = `**Error${context ? ` in ${context}` : ''}:** ${error.message}`;
        await this.logToChannel(message, true);
        this.logger.error(`Error${context ? ` in ${context}` : ''}:`, error);
    }

    async logInfo(message) {
        await this.logToChannel(message);
        this.logger.info(message);
    }
}

module.exports = LogService;