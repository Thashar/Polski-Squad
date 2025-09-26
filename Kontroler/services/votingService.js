const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

class VotingService {
    constructor(config) {
        this.config = config;
        this.logger = createBotLogger('Kontroler');

        // Ścieżki do plików danych
        this.dataDir = path.join(__dirname, '../data');
        this.activeVotesFile = path.join(this.dataDir, 'active_votes.json');
        this.voteHistoryFile = path.join(this.dataDir, 'vote_history.json');
        this.saboteurRolesFile = path.join(this.dataDir, 'saboteur_roles.json');

        // Mapa aktywnych głosowań
        this.activeVotes = new Map();

        // Mapa timerów głosowań
        this.voteTimers = new Map();

        // Mapa timerów usuwania roli
        this.roleRemovalTimers = new Map();

        // ID roli Dywersanta
        this.SABOTEUR_ROLE_ID = '1421060005913690204';

        // Czas głosowania (5 minut)
        this.VOTING_TIME = 5 * 60 * 1000;

        // Czas trwania roli (24 godziny)
        this.ROLE_DURATION = 24 * 60 * 60 * 1000;

        // Cooldown między głosowaniami dla tego samego użytkownika (7 dni)
        this.VOTE_COOLDOWN = 7 * 24 * 60 * 60 * 1000;
    }

    /**
     * Inicjalizuje serwis
     */
    async initialize(client) {
        this.client = client;
        await this.ensureDataDirectory();
        await this.loadData();
        await this.restoreTimers();
        this.logger.info('✅ VotingService zainicjalizowany');
    }

    /**
     * Zapewnia istnienie katalogu danych
     */
    async ensureDataDirectory() {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });
        } catch (error) {
            this.logger.error('❌ Błąd tworzenia katalogu danych:', error);
        }
    }

    /**
     * Ładuje dane z plików
     */
    async loadData() {
        await this.loadVoteHistory();
        await this.loadSaboteurRoles();
    }

    /**
     * Ładuje historię głosowań
     */
    async loadVoteHistory() {
        try {
            const data = await fs.readFile(this.voteHistoryFile, 'utf8');
            this.voteHistory = JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                this.voteHistory = {};
            } else {
                this.logger.error('❌ Błąd ładowania historii głosowań:', error);
                this.voteHistory = {};
            }
        }
    }

    /**
     * Ładuje dane o rolach Dywersanta
     */
    async loadSaboteurRoles() {
        try {
            const data = await fs.readFile(this.saboteurRolesFile, 'utf8');
            this.saboteurRoles = JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                this.saboteurRoles = {};
            } else {
                this.logger.error('❌ Błąd ładowania ról Dywersanta:', error);
                this.saboteurRoles = {};
            }
        }
    }

    /**
     * Zapisuje historię głosowań
     */
    async saveVoteHistory() {
        try {
            await fs.writeFile(this.voteHistoryFile, JSON.stringify(this.voteHistory, null, 2));
        } catch (error) {
            this.logger.error('❌ Błąd zapisywania historii głosowań:', error);
        }
    }

    /**
     * Zapisuje dane o rolach Dywersanta
     */
    async saveSaboteurRoles() {
        try {
            await fs.writeFile(this.saboteurRolesFile, JSON.stringify(this.saboteurRoles, null, 2));
        } catch (error) {
            this.logger.error('❌ Błąd zapisywania ról Dywersanta:', error);
        }
    }

    /**
     * Sprawdza czy można rozpocząć głosowanie dla użytkownika
     */
    canStartVoting(userId) {
        const now = Date.now();
        const lastVote = this.voteHistory[userId];

        if (!lastVote) {
            return true;
        }

        return (now - lastVote.timestamp) >= this.VOTE_COOLDOWN;
    }

    /**
     * Sprawdza czy wiadomość zawiera frazę uruchamiającą głosowanie
     */
    checkTriggerPhrase(content) {
        const normalizedContent = content.toLowerCase()
            .replace(/ą/g, 'a')
            .replace(/ć/g, 'c')
            .replace(/ę/g, 'e')
            .replace(/ł/g, 'l')
            .replace(/ń/g, 'n')
            .replace(/ó/g, 'o')
            .replace(/ś/g, 's')
            .replace(/ź/g, 'z')
            .replace(/ż/g, 'z');

        return normalizedContent.includes('dzialasz na szkode klanu');
    }

    /**
     * Rozpoczyna głosowanie
     */
    async startVoting(message, targetUser, isRetry = false) {
        const initiator = message.author;
        const targetUserId = targetUser.id;

        // Sprawdź cooldown tylko jeśli to nie jest powtórka po remisie
        if (!isRetry && !this.canStartVoting(targetUserId)) {
            return; // Cicho ignoruj jeśli w cooldownie
        }

        // Utwórz wiadomość tekstową
        const endTime = Math.floor((Date.now() + this.VOTING_TIME) / 1000);
        const voteText = `# ⚠️ UWAGA! Dywersja w klanie!\nCzy <@${targetUserId}> działa na szkodę klanu?\nCzas do końca głosowania: <t:${endTime}:R>`;

        // Utwórz przyciski
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`vote_yes_${targetUserId}`)
                    .setLabel('Tak')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('❌'),
                new ButtonBuilder()
                    .setCustomId(`vote_no_${targetUserId}`)
                    .setLabel('Nie')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅')
            );

        // Wyślij wiadomość z głosowaniem
        const voteMessage = await message.channel.send({
            content: voteText,
            components: [row]
        });

        // Zapisz aktywne głosowanie
        const voteData = {
            messageId: voteMessage.id,
            channelId: message.channel.id,
            targetUserId: targetUserId,
            initiatorId: initiator.id,
            startTime: Date.now(),
            endTime: Date.now() + this.VOTING_TIME,
            votes: {
                yes: new Set(),
                no: new Set()
            }
        };

        this.activeVotes.set(voteMessage.id, voteData);

        // Ustaw timer na zakończenie głosowania
        const timer = setTimeout(async () => {
            await this.endVoting(voteMessage.id);
        }, this.VOTING_TIME);

        this.voteTimers.set(voteMessage.id, timer);

        // Zapisz w historii tylko jeśli to nie jest powtórka po remisie
        if (!isRetry) {
            this.voteHistory[targetUserId] = {
                timestamp: Date.now(),
                initiator: initiator.id
            };
            await this.saveVoteHistory();
        }

        this.logger.info(`🗳️ Rozpoczęto głosowanie przeciwko ${targetUser.tag} (${targetUserId})`);
    }

    /**
     * Obsługuje kliknięcie przycisku głosowania
     */
    async handleVoteButton(interaction) {
        const [action, vote, targetUserId] = interaction.customId.split('_');

        if (action !== 'vote') return false;

        const voteData = this.activeVotes.get(interaction.message.id);
        if (!voteData) {
            await interaction.reply({
                content: '❌ To głosowanie już się skończyło.',
                ephemeral: true
            });
            return true;
        }

        const userId = interaction.user.id;

        // Sprawdź czy użytkownik już głosował
        if (voteData.votes.yes.has(userId) || voteData.votes.no.has(userId)) {
            await interaction.reply({
                content: '❌ Już zagłosowałeś w tym głosowaniu.',
                ephemeral: true
            });
            return true;
        }

        // Dodaj głos
        if (vote === 'yes') {
            voteData.votes.yes.add(userId);
        } else {
            voteData.votes.no.add(userId);
        }

        await interaction.reply({
            content: `✅ Twój głos "${vote === 'yes' ? 'Tak' : 'Nie'}" został zapisany.`,
            ephemeral: true
        });

        return true;
    }

    /**
     * Kończy głosowanie
     */
    async endVoting(messageId) {
        const voteData = this.activeVotes.get(messageId);
        if (!voteData) return;

        try {
            const channel = await this.client.channels.fetch(voteData.channelId);
            const message = await channel.messages.fetch(messageId);

            const yesVotes = voteData.votes.yes.size;
            const noVotes = voteData.votes.no.size;
            const totalVotes = yesVotes + noVotes;

            const yesPercent = totalVotes > 0 ? Math.round((yesVotes / totalVotes) * 100) : 0;
            const noPercent = totalVotes > 0 ? Math.round((noVotes / totalVotes) * 100) : 0;

            let resultMessage;

            if (yesVotes > noVotes) {
                // Większość głosów TAK - przyznaj rolę Dywersanta
                resultMessage = `**Większość podjęła decyzję, że <@${voteData.targetUserId}> musi ponieść karę!**\n\n` +
                              `📊 **Wyniki głosowania:**\n` +
                              `❌ Tak: ${yesVotes} głosów (${yesPercent}%)\n` +
                              `✅ Nie: ${noVotes} głosów (${noPercent}%)\n` +
                              `📈 Łącznie: ${totalVotes} głosów\n\n` +
                              `⚡ <@${voteData.targetUserId}> otrzymuje rolę **Dywersanta** na 24 godziny.`;

                // Przyznaj rolę Dywersanta
                await this.assignSaboteurRole(voteData.targetUserId);

            } else if (noVotes > yesVotes) {
                // Większość głosów NIE - uratowany
                resultMessage = `**Większość podjęła decyzję, że <@${voteData.targetUserId}> nie zawinił i nie zasługuje na karę!**\n\n` +
                              `📊 **Wyniki głosowania:**\n` +
                              `❌ Tak: ${yesVotes} głosów (${yesPercent}%)\n` +
                              `✅ Nie: ${noVotes} głosów (${noPercent}%)\n` +
                              `📈 Łącznie: ${totalVotes} głosów\n\n` +
                              `🛡️ <@${voteData.targetUserId}> został uratowany przez klan.`;

            } else {
                // Remis - powtórz głosowanie
                resultMessage = `**Nie udało się podjąć decyzji, głosowanie odbędzie się jeszcze raz!**\n\n` +
                              `📊 **Wyniki głosowania:**\n` +
                              `❌ Tak: ${yesVotes} głosów (${yesPercent}%)\n` +
                              `✅ Nie: ${noVotes} głosów (${noPercent}%)\n` +
                              `📈 Łącznie: ${totalVotes} głosów\n\n` +
                              `🔄 Rozpoczynanie nowego głosowania za 10 sekund...`;
            }

            // Wyślij wyniki
            await channel.send(resultMessage);

            // Jeśli remis, rozpocznij nowe głosowanie po 10 sekundach
            if (yesVotes === noVotes) {
                setTimeout(async () => {
                    try {
                        const targetUser = await this.client.users.fetch(voteData.targetUserId);
                        const fakeMessage = {
                            channel: channel,
                            author: { id: voteData.initiatorId }
                        };
                        await this.startVoting(fakeMessage, targetUser, true);
                    } catch (error) {
                        this.logger.error('❌ Błąd podczas ponownego głosowania po remisie:', error);
                    }
                }, 10000);
            }

            // Usuń oryginalną wiadomość z przyciskami
            await message.delete();

        } catch (error) {
            this.logger.error('❌ Błąd podczas kończenia głosowania:', error);
        }

        // Wyczyść dane
        this.activeVotes.delete(messageId);

        const timer = this.voteTimers.get(messageId);
        if (timer) {
            clearTimeout(timer);
            this.voteTimers.delete(messageId);
        }
    }

    /**
     * Przyznaje rolę Dywersanta
     */
    async assignSaboteurRole(userId) {
        try {
            const guild = this.client.guilds.cache.first();
            const member = await guild.members.fetch(userId);

            await member.roles.add(this.SABOTEUR_ROLE_ID, 'Głosowanie klanu - Dywersant');

            // Zapisz informację o roli
            const removeTime = Date.now() + this.ROLE_DURATION;
            this.saboteurRoles[userId] = {
                assignedAt: Date.now(),
                removeAt: removeTime
            };
            await this.saveSaboteurRoles();

            // Ustaw timer na usunięcie roli
            const timer = setTimeout(async () => {
                await this.removeSaboteurRole(userId);
            }, this.ROLE_DURATION);

            this.roleRemovalTimers.set(userId, timer);

            this.logger.info(`⚡ Przyznano rolę Dywersanta użytkownikowi ${userId} na 24h`);

        } catch (error) {
            this.logger.error('❌ Błąd podczas przyznawania roli Dywersanta:', error);
        }
    }

    /**
     * Usuwa rolę Dywersanta
     */
    async removeSaboteurRole(userId) {
        try {
            const guild = this.client.guilds.cache.first();
            const member = await guild.members.fetch(userId);

            if (member.roles.cache.has(this.SABOTEUR_ROLE_ID)) {
                await member.roles.remove(this.SABOTEUR_ROLE_ID, 'Upłynął czas roli Dywersanta');
                this.logger.info(`🔄 Usunięto rolę Dywersanta użytkownikowi ${userId}`);
            }

        } catch (error) {
            this.logger.error('❌ Błąd podczas usuwania roli Dywersanta:', error);
        }

        // Wyczyść dane
        delete this.saboteurRoles[userId];
        await this.saveSaboteurRoles();

        const timer = this.roleRemovalTimers.get(userId);
        if (timer) {
            clearTimeout(timer);
            this.roleRemovalTimers.delete(userId);
        }
    }

    /**
     * Przywraca timery po restarcie bota
     */
    async restoreTimers() {
        const now = Date.now();

        for (const [userId, roleData] of Object.entries(this.saboteurRoles)) {
            const remainingTime = roleData.removeAt - now;

            if (remainingTime <= 0) {
                // Rola powinna być już usunięta
                await this.removeSaboteurRole(userId);
            } else {
                // Ustaw timer na pozostały czas
                const timer = setTimeout(async () => {
                    await this.removeSaboteurRole(userId);
                }, remainingTime);

                this.roleRemovalTimers.set(userId, timer);
                this.logger.info(`🔄 Przywrócono timer usunięcia roli Dywersanta dla ${userId} (${Math.round(remainingTime / (60 * 60 * 1000))}h)`);
            }
        }
    }

    /**
     * Sprawdza czy wiadomość jest odpowiedzią na inną wiadomość
     */
    isReplyToUser(message) {
        return message.reference && message.reference.messageId;
    }

    /**
     * Pobiera użytkownika z odpowiedzi
     */
    async getReferencedUser(message) {
        try {
            const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
            return referencedMessage.author;
        } catch (error) {
            return null;
        }
    }
}

module.exports = VotingService;