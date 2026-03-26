const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, Routes } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');
const DATA_FILE = path.join(__dirname, '../data/booster_snapshot.json');
const BOOSTER_ROLE_ID = '1191766899575500850';

class BoosterSnapshotService {
    constructor() {
        this.client = null;
        this._pendingSnapshot = null; // tymczasowy wynik skanu przed potwierdzeniem
    }

    initialize(client) {
        this.client = client;
    }

    isMyButton(customId) {
        return customId === 'booster_snapshot_confirm' || customId === 'booster_snapshot_cancel';
    }

    // ─── Skanowanie kanałów ─────────────────────────────────────────────────

    async _scanGuild(guild) {
        const channels = await guild.channels.fetch();
        const result = [];
        for (const [, channel] of channels) {
            if (!channel) continue;
            const overwrite = channel.permissionOverwrites?.cache?.get(BOOSTER_ROLE_ID);
            if (overwrite) {
                result.push({
                    channelId:   channel.id,
                    channelName: channel.name,
                    allow: overwrite.allow.bitfield.toString(),
                    deny:  overwrite.deny.bitfield.toString(),
                });
            }
        }
        return result;
    }

    // ─── Przycisk "Snapshot booster" ────────────────────────────────────────

    async handleSnapshotButton(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const snapshot = await this._scanGuild(interaction.guild);

        if (snapshot.length === 0) {
            await interaction.editReply({ content: 'Rola boostera nie ma uprawnień na żadnym kanale.' });
            return;
        }

        this._pendingSnapshot = snapshot;

        const channelList = snapshot.map(c => `<#${c.channelId}>`).join(' ');
        const content = `**Kanały z uprawnieniami dla roli boostera (${snapshot.length}):**\n${channelList}\n\nCzy zapisać dane i usunąć uprawnienia?`;

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('booster_snapshot_confirm')
                .setLabel('Zapisz dane')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('💾'),
            new ButtonBuilder()
                .setCustomId('booster_snapshot_cancel')
                .setLabel('Anuluj')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('❌'),
        );

        await interaction.editReply({ content, components: [row] });
    }

    // ─── Obsługa przycisków potwierdzenia ───────────────────────────────────

    async handleButtonClick(interaction) {
        if (interaction.customId === 'booster_snapshot_confirm') {
            await this._handleConfirm(interaction);
        } else if (interaction.customId === 'booster_snapshot_cancel') {
            await interaction.update({ content: 'Anulowano.', components: [] });
        }
    }

    async _handleConfirm(interaction) {
        await interaction.deferUpdate();

        // Użyj zapisanego wyniku skanu lub zrób nowy
        const snapshot = this._pendingSnapshot ?? await this._scanGuild(interaction.guild);
        this._pendingSnapshot = null;

        // Zapisz do pliku
        try {
            fs.writeFileSync(DATA_FILE, JSON.stringify(snapshot, null, 2));
        } catch (err) {
            logger.error('❌ BoosterSnapshot: błąd zapisu:', err.message);
            await interaction.editReply({ content: '❌ Błąd zapisu do pliku.', components: [] });
            return;
        }

        // Usuń uprawnienia z kanałów
        let removed = 0;
        for (const entry of snapshot) {
            try {
                const channel = await interaction.guild.channels.fetch(entry.channelId).catch(() => null);
                if (channel) {
                    await channel.permissionOverwrites.delete(BOOSTER_ROLE_ID, 'Snapshot booster');
                    removed++;
                }
            } catch (err) {
                logger.error(`❌ BoosterSnapshot: błąd usuwania uprawnień z #${entry.channelName}:`, err.message);
            }
        }

        logger.info(`💾 BoosterSnapshot: zapisano ${snapshot.length} kanałów, usunięto uprawnienia z ${removed}`);
        await interaction.editReply({
            content: `✅ Zapisano ${snapshot.length} kanałów i usunięto uprawnienia z ${removed} kanałów.`,
            components: []
        });
    }

    // ─── Przycisk "Booster back" ─────────────────────────────────────────────

    async handleBoosterBack(interaction) {
        await interaction.deferReply({ ephemeral: true });

        if (!fs.existsSync(DATA_FILE)) {
            await interaction.editReply({ content: 'Brak zapisanych danych snapshotu.' });
            return;
        }

        let snapshot;
        try {
            snapshot = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        } catch (err) {
            await interaction.editReply({ content: '❌ Błąd odczytu danych snapshotu.' });
            return;
        }

        let restored = 0;
        for (const entry of snapshot) {
            try {
                await this.client.rest.put(
                    Routes.channelPermission(entry.channelId, BOOSTER_ROLE_ID),
                    { body: { id: BOOSTER_ROLE_ID, type: 0, allow: entry.allow, deny: entry.deny } }
                );
                restored++;
            } catch (err) {
                logger.error(`❌ BoosterSnapshot: błąd przywracania uprawnień na #${entry.channelName}:`, err.message);
            }
        }

        logger.info(`🔄 BoosterSnapshot: przywrócono uprawnienia na ${restored}/${snapshot.length} kanałach`);
        await interaction.editReply({ content: `✅ Przywrócono uprawnienia na ${restored}/${snapshot.length} kanałach.` });
    }
}

module.exports = BoosterSnapshotService;
