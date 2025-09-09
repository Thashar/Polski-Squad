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
 * @param {string} allowedChannelId - ID of allowed channel
 * @returns {boolean}
 */
function isAllowedChannel(interaction, allowedChannelId) {
    return interaction.channelId === allowedChannelId;
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

/**
 * Clean and validate attachment
 * @param {Object} attachment - Discord attachment object
 * @returns {Object}
 */
function validateImageAttachment(attachment) {
    if (!attachment) {
        return { valid: false, error: 'No attachment provided' };
    }
    
    if (!attachment.contentType?.startsWith('image/')) {
        return { valid: false, error: 'Attachment is not an image' };
    }
    
    if (attachment.size > 8 * 1024 * 1024) { // 8MB limit
        return { valid: false, error: 'Image file too large (max 8MB)' };
    }
    
    return { valid: true, attachment };
}

module.exports = {
    hasPermission,
    formatNumber,
    generatePaginationId,
    isAllowedChannel,
    delay,
    truncateString,
    validateImageAttachment
};