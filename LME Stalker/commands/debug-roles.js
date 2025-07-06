const { SlashCommandBuilder } = require('discord.js');
const { getMembersOfRole } = require('../utils/roleManager');
const { readWeeklyRemovalData, getNextRemovalDate } = require('../database/weeklyRemoval');
const { ERROR_MESSAGES } = require('../messages/messages');
const config = require('../config/config');

module.exports = {
    data: new SlashCommandBuilder()
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
        ),
    
    async execute(interaction) {
        await interaction.deferReply();
        
        try {
            const guild = interaction.guild;
            const category = interaction.options.getString('category');
            
            await guild.members.fetch();
