const { PermissionFlagsBits } = require('discord.js');

/**
 * Check if user has permission to use commands
 * @param {Object} interaction - Discord interaction object
 * @param {Array} authorizedRoles - Array of authorized role IDs
 * @returns {boolean}
 */
function hasPermission(interaction, authorizedRoles) {
    if (interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return true;
    }
    
    const userRoles = interaction.member.roles.cache;
    return authorizedRoles.some(roleId => userRoles.has(roleId));
}

/**
 * Format number with comma as decimal separator
 * @param {number} num - Number to format
 * @param {number} decimals - Number of decimal places
 * @returns {string}
 */
function formatNumber(num, decimals = 1) {
    if (typeof num !== 'number' || isNaN(num)) {
        return '0';
    }
    
    const absNum = Math.abs(num);
    
    if (absNum < 1000) {
        return decimals === 0 ? num.toString() : num.toFixed(decimals);
    }
    
    if (absNum < 1000000) {
        const thousands = num / 1000;
        
        if (thousands % 1 === 0 && decimals <= 1) {
            return thousands.toString() + 'K';
        }
        
        return thousands.toFixed(decimals).replace('.', ',') + 'K';
    }
    
    if (absNum < 1000000000) {
        const millions = num / 1000000;
        
        if (millions % 1 === 0 && decimals <= 1) {
            return millions.toString() + 'M';
        }
        
        return millions.toFixed(decimals).replace('.', ',') + 'M';
    }
    
    const billions = num / 1000000000;
    
    if (billions % 1 === 0 && decimals <= 1) {
        return billions.toString() + 'B';
    }
    
    return billions.toFixed(decimals).replace('.', ',') + 'B';
}

/**
 * Generate unique pagination ID
 * @returns {string}
 */
function generatePaginationId() {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Validate if channel is allowed
 * @param {Object} interaction - Discord interaction object
 * @param {string|Array} allowedChannelIds - ID(s) of allowed channel(s)
 * @returns {boolean}
 */
function isAllowedChannel(interaction, allowedChannelIds) {
    const channelId = interaction.channelId;
    const channel = interaction.channel;

    // Normalize to array
    const allowedIds = typeof allowedChannelIds === 'string'
        ? [allowedChannelIds]
        : (Array.isArray(allowedChannelIds) ? allowedChannelIds : []);

    // Check if current channel is directly allowed
    if (allowedIds.includes(channelId)) {
        return true;
    }

    // Check if this is a thread and its parent channel is allowed
    // Only threads have parentId property set to the parent channel ID
    if (channel?.parentId && allowedIds.includes(channel.parentId)) {
        return true;
    }

    return false;
}

/**
 * Create delay promise
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise}
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Truncate string to specified length
 * @param {string} str - String to truncate
 * @param {number} length - Max length
 * @returns {string}
 */
function truncateString(str, length = 1024) {
    if (str.length <= length) return str;
    return str.substring(0, length - 3) + '...';
}


module.exports = {
    hasPermission,
    formatNumber,
    generatePaginationId,
    isAllowedChannel,
    delay,
    truncateString
};