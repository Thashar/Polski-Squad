module.exports = {
    // Original reminder messages
    reminderMessage: (timeMessage, userMentions) =>
        `# <a:X_Uwaga:1297531538186965003> BOSS REMINDER <a:X_Uwaga:1297531538186965003>\n${timeMessage}\n\n${userMentions}`,

    // Time formatting until deadline
    formatTimeMessage: (timeUntilDeadline) => {
        if (timeUntilDeadline.totalMinutes > 0) {
            if (timeUntilDeadline.hours > 0) {
                return `<a:X_Uwaga2:1297532628395622440> **Time remaining to defeat the boss: ${timeUntilDeadline.hours}h ${timeUntilDeadline.minutes}min** <a:X_Uwaga2:1297532628395622440>`;
            } else {
                return `<a:X_Uwaga2:1297532628395622440> **Time remaining to defeat the boss: ${timeUntilDeadline.minutes}min** <a:X_Uwaga2:1297532628395622440>`;
            }
        } else {
            return `<a:X_Uwaga2:1297532628395622440> **Time to defeat the boss has passed!** <a:X_Uwaga2:1297532628395622440>`;
        }
    },

    // Error messages
    errors: {
        noPermission: 'You do not have permission to use this command!',
        noImage: 'You must attach an image for analysis!',
        invalidImage: 'Invalid image format. Supported formats: PNG, JPG, JPEG',
        ocrError: 'An error occurred during image analysis. Please try again.',
        userNotFound: 'User not found.',
        invalidPoints: 'Invalid number of points.',
        databaseError: 'A database error occurred.',
        unknownError: 'An unknown error occurred. Please try again.',
        serverNotConfigured: 'This server is not configured. Please contact the bot administrator.',
        noServerConfig: 'Bot is not configured for this server. Check servers.json configuration.'
    }
};
