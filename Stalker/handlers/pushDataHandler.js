'use strict';

const path = require('path');
const fs = require('fs').promises;
const { MessageFlags } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');
const { pushEvent } = require('../utils/appEventPush');

const logger = createBotLogger('Stalker:PushData');

/**
 * /push-data — komenda admina która wypycha wszystkie dane graczy do web app.
 * Używana gdy chcesz zsynchronizować stan bota z witryną bez czekania
 * na kolejne aktualizacje z OCR.
 */
async function handlePushDataCommand(interaction, sharedState) {
    const { config, databaseService } = sharedState;
    const guildId = interaction.guild.id;

    // Sprawdź uprawnienia admina
    const isAdmin = config.allowedPunishRoles.some(roleId =>
        interaction.member.roles.cache.has(roleId)
    );
    if (!isAdmin) {
        await interaction.reply({
            content: '❌ Ta komenda jest dostępna tylko dla administratorów.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const results = {
        punishments: 0,
        phase1: 0,
        phase2: 0,
        equipment: 0,
        combat: 0,
        cx: 0,
        endersEcho: false,
        errors: [],
    };

    // ─── 1. Kary ─────────────────────────────────────────────────────────────
    try {
        const punishments = await databaseService.loadPunishments();
        const guildPunishments = punishments[guildId] || {};
        for (const [userId, data] of Object.entries(guildPunishments)) {
            await pushEvent('punishment', userId, {
                guildId,
                points: data.points,
                lifetime_points: data.lifetime_points,
                history: (data.history || []).slice(-5),
            });
            results.punishments++;
        }
        logger.info(`[PUSH-DATA] ✅ Wypchano kary: ${results.punishments} graczy`);
    } catch (err) {
        logger.error('[PUSH-DATA] ❌ Błąd przy karach:', err.message);
        results.errors.push('punishment');
    }

    // ─── 2. Faza 1 — ostatnie 12 tygodni ─────────────────────────────────────
    try {
        const availableWeeks = await databaseService.getAvailableWeeks(guildId);
        const recentWeeks = availableWeeks.slice(-12);
        for (const { weekNumber, year, clan } of recentWeeks) {
            try {
                const weekData = await databaseService.getPhase1Results(guildId, weekNumber, year, clan);
                if (weekData && weekData.players) {
                    await pushEvent('phase1', null, {
                        guildId,
                        weekNumber,
                        year,
                        clan,
                        players: weekData.players,
                        createdAt: weekData.createdAt,
                    });
                    results.phase1++;
                }
            } catch {}
        }
        logger.info(`[PUSH-DATA] ✅ Wypchano Fazę 1: ${results.phase1} tygodni`);
    } catch (err) {
        logger.error('[PUSH-DATA] ❌ Błąd przy Fazie 1:', err.message);
        results.errors.push('phase1');
    }

    // ─── 3. Faza 2 — ostatnie 12 tygodni ─────────────────────────────────────
    try {
        const availableWeeks2 = await databaseService.getAvailableWeeksPhase2
            ? await databaseService.getAvailableWeeksPhase2(guildId)
            : await databaseService.getAvailableWeeks(guildId);
        const recentWeeks2 = availableWeeks2.slice(-12);
        for (const { weekNumber, year, clan } of recentWeeks2) {
            try {
                const weekData = await databaseService.getPhase2Results(guildId, weekNumber, year, clan);
                if (weekData) {
                    await pushEvent('phase2', null, {
                        guildId,
                        weekNumber,
                        year,
                        clan,
                        rounds: weekData.rounds,
                        players: weekData.summary?.players || [],
                        createdAt: weekData.createdAt,
                    });
                    results.phase2++;
                }
            } catch {}
        }
        logger.info(`[PUSH-DATA] ✅ Wypchano Fazę 2: ${results.phase2} tygodni`);
    } catch (err) {
        logger.error('[PUSH-DATA] ❌ Błąd przy Fazie 2:', err.message);
        results.errors.push('phase2');
    }

    // ─── 4. Ekwipunek (Core Stock) ────────────────────────────────────────────
    try {
        const equipPath = path.join(__dirname, '../data/equipment_data.json');
        const raw = await fs.readFile(equipPath, 'utf8').catch(() => '{}');
        const equipData = JSON.parse(raw);
        for (const [userId, data] of Object.entries(equipData)) {
            await pushEvent('core_stock', userId, {
                items: data.items,
                updatedAt: data.updatedAt,
            });
            results.equipment++;
        }
        logger.info(`[PUSH-DATA] ✅ Wypchano ekwipunek: ${results.equipment} graczy`);
    } catch (err) {
        logger.error('[PUSH-DATA] ❌ Błąd przy ekwipunku:', err.message);
        results.errors.push('equipment');
    }

    // ─── 5. Walki Gary (RC+TC+Atak) ──────────────────────────────────────────
    try {
        const combatPath = path.join(__dirname, '../data/player_combat_discord.json');
        const raw = await fs.readFile(combatPath, 'utf8').catch(() => '{"player":{}}');
        const combatData = JSON.parse(raw);
        const players = combatData.player || {};
        for (const [userId, data] of Object.entries(players)) {
            const recent = (data.combatHistory || []).slice(-4);
            if (recent.length > 0) {
                await pushEvent('gary_combat', userId, {
                    discordUsername: data.discordUsername,
                    recentHistory: recent,
                });
                results.combat++;
            }
        }
        logger.info(`[PUSH-DATA] ✅ Wypchano Gary combat: ${results.combat} graczy`);
    } catch (err) {
        logger.error('[PUSH-DATA] ❌ Błąd przy Gary combat:', err.message);
        results.errors.push('gary_combat');
    }

    // ─── 6. Historia CX ───────────────────────────────────────────────────────
    try {
        const cxPath = path.join(__dirname, '../../shared_data/cx_history.json');
        const raw = await fs.readFile(cxPath, 'utf8').catch(() => '{}');
        const cxData = JSON.parse(raw);
        for (const [userId, data] of Object.entries(cxData)) {
            const recent = (data.scores || []).slice(-10);
            if (recent.length > 0) {
                await pushEvent('cx_history', userId, { scores: recent });
                results.cx++;
            }
        }
        logger.info(`[PUSH-DATA] ✅ Wypchano CX: ${results.cx} graczy`);
    } catch (err) {
        logger.error('[PUSH-DATA] ❌ Błąd przy CX:', err.message);
        results.errors.push('cx_history');
    }

    // ─── 7. Ranking Enders Echo ───────────────────────────────────────────────
    try {
        const eePath = path.join(__dirname, '../../shared_data/endersecho_ranking.json');
        const raw = await fs.readFile(eePath, 'utf8').catch(() => '{"players":[]}');
        const eeData = JSON.parse(raw);
        if (eeData.players?.length > 0) {
            await pushEvent('enders_echo_ranking', null, { players: eeData.players });
            results.endersEcho = true;
        }
        logger.info('[PUSH-DATA] ✅ Wypchano Enders Echo ranking');
    } catch (err) {
        logger.error('[PUSH-DATA] ❌ Błąd przy EE:', err.message);
        results.errors.push('enders_echo');
    }

    // ─── Odpowiedź ────────────────────────────────────────────────────────────
    const errorPart = results.errors.length > 0
        ? `\n⚠️ Błędy: ${results.errors.join(', ')}`
        : '';

    await interaction.editReply({
        content:
            `✅ **Synchronizacja zakończona!**\n\n` +
            `📊 Kary: **${results.punishments}** graczy\n` +
            `🎮 Faza 1: **${results.phase1}** tygodni\n` +
            `⚔️ Faza 2: **${results.phase2}** tygodni\n` +
            `🎒 Ekwipunek: **${results.equipment}** graczy\n` +
            `⚡ Gary Combat: **${results.combat}** graczy\n` +
            `🌟 CX: **${results.cx}** graczy\n` +
            `🏆 Enders Echo: **${results.endersEcho ? 'TAK' : 'NIE'}**` +
            errorPart,
    });
}

module.exports = { handlePushDataCommand };
