const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Wydarzynier');

/**
 * Obsługa dodania reakcji
 * @param {MessageReaction} reaction - Reakcja Discord
 * @param {User} user - Użytkownik który dodał reakcję
 * @param {Object} sharedState - Współdzielony stan aplikacji
 */
async function handleReactionAdd(reaction, user, sharedState) {
    try {
        // Załaduj reakcję i wiadomość jeśli są częściowe
        if (reaction.partial) await reaction.fetch();
        if (reaction.message.partial) await reaction.message.fetch();

        // Sprawdź czy to wiadomość lobby przed sprawdzaniem czy to bot
        const lobby = sharedState.lobbyService.getLobbyByAnnouncementId(reaction.message.id);
        if (lobby) {
            // Dla wiadomości lobby, usuń wszystkie nieprawidłowe reakcje niezależnie od tego kto je dodał
            if (reaction.emoji.toString() !== sharedState.config.emoji.ticket) {
                await reaction.remove();
                    return;
            }
        }

        // Ignoruj reakcje botów dla normalnej obsługi
        if (user.bot) return;

        // Sprawdź czy to właściwy kanał
        if (reaction.message.channel.id !== sharedState.config.channels.party) return;

        // Ponownie znajdź lobby (może już być sprawdzone wcześniej)
        if (!lobby) return;

        // Sprawdź czy lobby nie jest pełne
        if (lobby.isFull) {
            // Usuń reakcję i wyślij ephemeral message
            await reaction.users.remove(user.id);
            
            // Wyślij ephemeral message (symulacja - w rzeczywistości można użyć webhook lub interaction)
            const channel = reaction.message.channel;
            const ephemeralMsg = await channel.send(`<@${user.id}> ${sharedState.config.messages.lobbyFullEphemeral}`);
            
            // Usuń wiadomość po 5 sekundach
            setTimeout(async () => {
                try {
                    await ephemeralMsg.delete();
                } catch (error) {
                    // Ignoruj błędy usuwania
                }
            }, 5000);
            
            return;
        }

        // Sprawdź czy użytkownik to nie właściciel lobby
        if (user.id === lobby.ownerId) {
            await reaction.users.remove(user.id);
            return;
        }

        // Sprawdź czy użytkownik już jest w lobby
        if (lobby.players.includes(user.id)) {
            await reaction.users.remove(user.id);
            return;
        }

        // Sprawdź czy użytkownik ma już oczekującą prośbę
        if (sharedState.lobbyService.hasPendingRequest(lobby.id, user.id)) {
            await reaction.users.remove(user.id);
            return;
        }

        // Utwórz wiadomość z przyciskami w wątku lobby
        await createJoinRequest(lobby, user, sharedState);

        // Usuń reakcję użytkownika
        await reaction.users.remove(user.id);


    } catch (error) {
        logger.error('❌ Błąd podczas obsługi dodania reakcji:', error);
    }
}

/**
 * Obsługa usunięcia reakcji (opcjonalne)
 * @param {MessageReaction} reaction - Reakcja Discord
 * @param {User} user - Użytkownik który usunął reakcję
 * @param {Object} sharedState - Współdzielony stan aplikacji
 */
async function handleReactionRemove(reaction, user, sharedState) {
    // W tym przypadku nie robimy nic specjalnego przy usuwaniu reakcji
    // Możemy dodać logikę w przyszłości jeśli będzie potrzebna
}

/**
 * Tworzy prośbę o dołączenie do lobby
 * @param {Object} lobby - Dane lobby
 * @param {User} user - Użytkownik chcący dołączyć
 * @param {Object} sharedState - Współdzielony stan aplikacji
 */
async function createJoinRequest(lobby, user, sharedState) {
    try {
        // Pobierz wątek lobby
        const thread = await sharedState.client.channels.fetch(lobby.threadId);
        
        // Pobierz dane członka serwera dla wyświetlenia nicku
        const guild = thread.guild;
        const member = await guild.members.fetch(user.id);
        const displayName = member.displayName || user.username;

        // Utwórz przyciski
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`accept_${user.id}`)
                    .setLabel('Tak')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`reject_${user.id}`)
                    .setLabel('Nie')
                    .setStyle(ButtonStyle.Danger)
            );

        // Wyślij wiadomość z przyciskami
        const requestMessage = await thread.send({
            content: sharedState.config.messages.joinRequest(displayName),
            components: [row]
        });

        // Zarejestruj oczekującą prośbę
        sharedState.lobbyService.addPendingRequest(lobby.id, user.id, requestMessage.id);


    } catch (error) {
        logger.error('❌ Błąd podczas tworzenia prośby o dołączenie:', error);
    }
}

module.exports = {
    handleReactionAdd,
    handleReactionRemove
};