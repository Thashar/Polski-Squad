const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

class TablicaMenedzer {
    constructor(client, config, logger, przypomnieniaMenedzer, strefaCzasowaManager, eventMenedzer) {
        this.client = client;
        this.config = config;
        this.logger = logger;
        this.przypomnieniaMenedzer = przypomnieniaMenedzer;
        this.strefaCzasowaManager = strefaCzasowaManager;
        this.eventMenedzer = eventMenedzer;
        this.boardChannel = null;
        this.updateInterval = null;
        this.controlPanelMessageId = null;

        // Circuit breaker dla błędów DNS
        this.circuitBreakerOpen = false;
        this.circuitBreakerUntil = null;
        this.consecutiveFailures = 0;
        this.lastNetworkErrorLog = 0; // Timestamp ostatniego logu błędu sieciowego (DNS, timeout)
    }

    async initialize() {
        try {
            // Pobierz kanał tablicy przypomnień
            const channel = await this.client.channels.fetch(this.config.notificationsBoardChannelId);
            if (!channel) {
                this.logger.error('Kanał tablicy przypomnień nie znaleziony');
                return;
            }

            this.boardChannel = channel;
            this.logger.success('TablicaMenedzer zainicjalizowany');

            // Wczytaj ID wiadomości panelu kontrolnego z persistent storage
            this.controlPanelMessageId = this.eventMenedzer.getControlPanelMessageId();
            if (this.controlPanelMessageId) {
                this.logger.info(`Wczytano ID wiadomości panelu kontrolnego: ${this.controlPanelMessageId}`);
            }

            // Rozpocznij okresowe aktualizacje
            this.startPeriodicUpdates();

            // Początkowa synchronizacja
            await this.syncAllNotifications();

            // Upewnij się, że panel kontrolny istnieje
            await this.ensureControlPanel();
        } catch (error) {
            this.logger.error('Nie udało się zainicjalizować TablicaMenedzer:', error);
        }
    }

    startPeriodicUpdates() {
        // Aktualizuj wszystkie embedy co minutę
        this.updateInterval = setInterval(async () => {
            await this.updateAllEmbeds();
        }, this.config.boardUpdateInterval);

        this.logger.info('Rozpoczęto okresowe aktualizacje tablicy');
    }

    stopPeriodicUpdates() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
            this.logger.info('Zatrzymano okresowe aktualizacje tablicy');
        }
    }

    // Zapisz ID wiadomości panelu kontrolnego do persistent storage
    async saveControlPanelMessageId(messageId) {
        this.controlPanelMessageId = messageId;
        await this.eventMenedzer.setControlPanelMessageId(messageId);
    }

    // Synchronizuj wszystkie powiadomienia na tablicy (przy starcie)
    async syncAllNotifications() {
        const activeScheduled = this.przypomnieniaMenedzer.getActiveScheduled();
        this.logger.info(`Synchronizowanie ${activeScheduled.length} aktywnych zaplanowanych przypomnień na tablicy`);

        for (const scheduled of activeScheduled) {
            if (scheduled.boardMessageId) {
                // Sprawdź czy wiadomość nadal istnieje
                try {
                    await this.boardChannel.messages.fetch(scheduled.boardMessageId);
                    // Wiadomość istnieje, zaktualizuj ją
                    const scheduledWithTemplate = this.przypomnieniaMenedzer.getScheduledWithTemplate(scheduled.id);
                    await this.updateEmbed(scheduledWithTemplate);
                } catch (error) {
                    // Wiadomość nie istnieje, utwórz nową
                    const scheduledWithTemplate = this.przypomnieniaMenedzer.getScheduledWithTemplate(scheduled.id);
                    await this.createEmbed(scheduledWithTemplate);
                }
            } else {
                // Brak ID wiadomości, utwórz nowy embed
                const scheduledWithTemplate = this.przypomnieniaMenedzer.getScheduledWithTemplate(scheduled.id);
                await this.createEmbed(scheduledWithTemplate);
            }
        }
    }

    // Utwórz embed dla zaplanowanego przypomnienia
    async createEmbed(scheduled) {
        if (!this.boardChannel) {
            this.logger.error('Kanał tablicy nie zainicjalizowany');
            return null;
        }

        if (!scheduled) {
            this.logger.error('createEmbed: scheduled jest null lub undefined');
            return null;
        }

        if (!scheduled.template) {
            this.logger.error(`createEmbed: scheduled ${scheduled.id} nie ma dołączonego szablonu`);
            return null;
        }

        this.logger.info(`Tworzenie embed dla zaplanowanego ${scheduled.id} z szablonem ${scheduled.template.name}`);

        try {
            const embed = await this.buildEmbed(scheduled);
            const components = this.buildActionButtons(scheduled);
            const message = await this.boardChannel.send({ embeds: [embed], components });

            // Zaktualizuj powiadomienie z ID wiadomości
            await this.przypomnieniaMenedzer.updateBoardMessageId(scheduled.id, message.id);

            // Przenieś panel kontrolny na dół
            await this.ensureControlPanel();

            this.logger.info(`Utworzono embed tablicy dla zaplanowanego: ${scheduled.id}`);
            return message;
        } catch (error) {
            this.logger.error(`Nie udało się utworzyć embed dla ${scheduled.id}:`, error);
            return null;
        }
    }

    // Zaktualizuj istniejący embed
    async updateEmbed(scheduled) {
        if (!this.boardChannel) {
            this.logger.error('Kanał tablicy nie zainicjalizowany');
            return false;
        }

        if (!scheduled || !scheduled.template) {
            this.logger.error('Nieprawidłowy obiekt scheduled lub brak szablonu');
            return false;
        }

        if (!scheduled.boardMessageId) {
            this.logger.warn(`Brak ID wiadomości tablicy dla zaplanowanego: ${scheduled.id}`);
            return false;
        }

        try {
            const message = await this.boardChannel.messages.fetch(scheduled.boardMessageId);
            const embed = await this.buildEmbed(scheduled);
            const components = this.buildActionButtons(scheduled);
            await message.edit({ embeds: [embed], components });

            return true;
        } catch (error) {
            // Deduplikacja logów błędów sieciowych - loguj tylko raz na 5 minut
            const isTransientNetworkError =
                error.code === 'EAI_AGAIN' ||
                error.syscall === 'getaddrinfo' ||
                error.name === 'ConnectTimeoutError' ||
                error.name === 'SocketError' ||
                error.name === 'RequestTimeoutError';
            const now = Date.now();

            if (isTransientNetworkError) {
                // Loguj błąd sieciowy tylko raz na 5 minut
                if (now - this.lastNetworkErrorLog > 5 * 60 * 1000) {
                    this.logger.error(`❌ Network error - cannot reach Discord API (will retry): ${error.message}`);
                    this.lastNetworkErrorLog = now;
                }
            } else {
                // Inne błędy - loguj normalnie
                this.logger.error(`Nie udało się zaktualizować embed dla ${scheduled.id}:`, error);

                // Jeśli wiadomość nie znaleziona, utwórz nową
                if (error.code === 10008) {
                    await this.createEmbed(scheduled);
                }
            }

            return false;
        }
    }

    // Usuń embed
    async deleteEmbed(scheduled) {
        if (!this.boardChannel) {
            this.logger.error('Kanał tablicy nie zainicjalizowany');
            return false;
        }

        if (!scheduled.boardMessageId) {
            return true; // Nic do usunięcia
        }

        try {
            const message = await this.boardChannel.messages.fetch(scheduled.boardMessageId);
            await message.delete();

            this.logger.info(`Usunięto embed tablicy dla zaplanowanego: ${scheduled.id}`);
            return true;
        } catch (error) {
            this.logger.error(`Nie udało się usunąć embed dla ${scheduled.id}:`, error);
            return false;
        }
    }

    // Zbuduj embed dla zaplanowanego przypomnienia
    async buildEmbed(scheduled) {
        const template = scheduled.template;

        // Kolor zależny od statusu i typu przypomnienia
        let color;
        if (scheduled.status === 'paused') {
            color = 0xFEA500; // Pomarańczowy - wstrzymane
        } else if (scheduled.isOneTime || !scheduled.interval) {
            color = 0x5865F2; // Niebieski - jednorazowe
        } else {
            color = 0x57F287; // Zielony - cykliczne
        }

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTimestamp(new Date(scheduled.createdAt));

        // Tytuł
        const typeIcon = template.type === 'text' ? '📝' : '📋';
        embed.setTitle(`${typeIcon} Zaplanowane przypomnienie - ID: ${scheduled.id}`);

        // Info o szablonie
        embed.addFields({
            name: '📝 Szablon',
            value: template.name,
            inline: true
        });

        embed.addFields({
            name: '📋 Typ',
            value: template.type === 'text' ? 'Tekst' : 'Embed',
            inline: true
        });

        // Status
        const statusEmoji = scheduled.status === 'active' ? '🟢' : '⏸️';
        const statusText = scheduled.status === 'active' ? 'Aktywne' : 'Wstrzymane';
        embed.addFields({
            name: '📊 Status',
            value: `${statusEmoji} ${statusText}`,
            inline: true
        });

        // Kanał
        embed.addFields({
            name: '📍 Kanał',
            value: `<#${scheduled.channelId}>`,
            inline: true
        });

        // Interwał
        embed.addFields({
            name: '🔄 Interwał',
            value: this.przypomnieniaMenedzer.formatInterval(scheduled.interval),
            inline: true
        });

        // Następne wyzwolenie z timestampem Discord
        const nextTriggerTimestamp = Math.floor(new Date(scheduled.nextTrigger).getTime() / 1000);
        embed.addFields({
            name: '⏭️ Następne wyzwolenie',
            value: `<t:${nextTriggerTimestamp}:F>\n(<t:${nextTriggerTimestamp}:R>)`,
            inline: true
        });

        // Role do pingowania
        if (scheduled.roles && scheduled.roles.length > 0) {
            const rolesText = scheduled.roles.map(r => `<@&${r}>`).join(', ');
            embed.addFields({
                name: '👥 Role do pingowania',
                value: rolesText,
                inline: false
            });
        }

        // Podgląd szablonu
        if (template.type === 'text') {
            const previewText = template.text.length > 200
                ? template.text.substring(0, 200) + '...'
                : template.text;
            embed.addFields({
                name: '💬 Podgląd wiadomości',
                value: previewText,
                inline: false
            });
        } else {
            let embedPreview = `**${template.embedTitle}**\n${template.embedDescription}`;
            if (embedPreview.length > 200) {
                embedPreview = embedPreview.substring(0, 200) + '...';
            }
            embed.addFields({
                name: '💬 Podgląd embed',
                value: embedPreview,
                inline: false
            });
        }

        // Twórca - pobierz nick z gildii
        let creatorName = 'Nieznany';
        if (this.boardChannel && this.boardChannel.guild) {
            try {
                // Spróbuj cache najpierw, potem fetch jeśli nie znaleziono
                let member = this.boardChannel.guild.members.cache.get(scheduled.creator);
                if (!member) {
                    member = await this.boardChannel.guild.members.fetch(scheduled.creator);
                }
                if (member) {
                    creatorName = member.displayName;
                }
            } catch (error) {
                // Użytkownik mógł opuścić serwer lub ID jest nieprawidłowe
                this.logger.warn(`Nie udało się pobrać członka ${scheduled.creator}: ${error.message}`);
            }
        }
        embed.setFooter({ text: `Utworzone przez ${creatorName}` });

        // Link do panelu kontrolnego w stopce embeda
        if (this.controlPanelMessageId && this.boardChannel) {
            const guildId = this.boardChannel.guild?.id;
            const channelId = this.boardChannel.id;
            const panelUrl = `https://discord.com/channels/${guildId}/${channelId}/${this.controlPanelMessageId}`;
            embed.addFields({
                name: '\u200b',
                value: `[➡️ Przejdź do Panelu](${panelUrl})`,
                inline: false
            });
        }

        return embed;
    }

    // Zaktualizuj wszystkie aktywne embedy
    async updateAllEmbeds() {
        // Sprawdź circuit breaker
        if (this.circuitBreakerOpen) {
            const now = Date.now();
            if (now < this.circuitBreakerUntil) {
                // Circuit breaker nadal otwarty - pomiń aktualizacje
                return;
            } else {
                // Czas minął - zamknij circuit breaker i spróbuj ponownie
                this.logger.info('🔄 Circuit breaker closed - resuming board updates');
                this.circuitBreakerOpen = false;
                this.circuitBreakerUntil = null;
                this.consecutiveFailures = 0;
            }
        }

        const activeScheduled = this.przypomnieniaMenedzer.getAllScheduledWithTemplates();
        let failedCount = 0;

        for (const scheduled of activeScheduled) {
            if (scheduled.status === 'active') {
                const success = await this.updateEmbed(scheduled);
                if (!success) failedCount++;
            }
        }

        // Jeśli wszystkie aktualizacje zawiodły, otwórz circuit breaker
        if (activeScheduled.length > 0 && failedCount === activeScheduled.length) {
            this.consecutiveFailures++;

            if (this.consecutiveFailures >= 3) {
                // Otwórz circuit breaker na 5 minut
                this.circuitBreakerOpen = true;
                this.circuitBreakerUntil = Date.now() + (5 * 60 * 1000);
                this.logger.warn(`⚠️ Circuit breaker opened after ${this.consecutiveFailures} consecutive failures - pausing updates for 5 minutes`);
            }
        } else if (failedCount === 0) {
            // Reset licznika przy sukcesie
            if (this.consecutiveFailures > 0) {
                this.logger.success('✅ Board updates recovered successfully');
                this.consecutiveFailures = 0;
            }
        }
    }

    // Utwórz lub zaktualizuj panel kontrolny
    async ensureControlPanel() {
        if (!this.boardChannel) {
            this.logger.error('Kanał tablicy nie zainicjalizowany');
            return;
        }

        try {
            let existingPanel = null;

            // KROK 1: Najpierw sprawdź cached message ID (szybka ścieżka)
            if (this.controlPanelMessageId) {
                try {
                    existingPanel = await this.boardChannel.messages.fetch(this.controlPanelMessageId);
                    this.logger.info('Znaleziono panel kontrolny używając cached ID');
                } catch (error) {
                    if (error.code === 10008) {
                        this.logger.warn('Cachowany panel kontrolny nie znaleziony, przeszukuję kanał');
                        await this.saveControlPanelMessageId(null);
                    } else {
                        throw error;
                    }
                }
            }

            // KROK 2: Jeśli nie ma cached panelu, szukaj w kanale (wolna ścieżka)
            if (!existingPanel) {
                const allMessages = await this.boardChannel.messages.fetch({ limit: 100 });
                const allPanels = [];

                for (const [, message] of allMessages) {
                    if (message.author.id === this.client.user.id &&
                        message.embeds.length > 0 &&
                        message.embeds[0].title === '📋 Panel Kontrolny Przypomnień i Eventów') {
                        allPanels.push(message);
                    }
                }

                if (allPanels.length > 0) {
                    existingPanel = allPanels[0]; // Zachowaj pierwszy
                    this.logger.info(`Znaleziono ${allPanels.length} panel(e/i) kontrolny(ch) w kanale`);

                    // Usuń WSZYSTKIE duplikaty (włącznie ze starym cached jeśli inny)
                    for (let i = 1; i < allPanels.length; i++) {
                        try {
                            await allPanels[i].delete();
                            this.logger.info(`Usunięto duplikat panelu kontrolnego: ${allPanels[i].id}`);
                        } catch (error) {
                            this.logger.warn(`Nie udało się usunąć duplikatu:`, error.message);
                        }
                    }
                }
            }

            // KROK 3: Jeśli panel istnieje - usuń go, żeby wysłać nowy na dole
            if (existingPanel) {
                try {
                    await existingPanel.delete();
                    this.logger.info('Usunięto stary panel kontrolny - zostanie wysłany nowy na dole');
                } catch (error) {
                    this.logger.warn('Nie udało się usunąć starego panelu kontrolnego:', error.message);
                }
                await this.saveControlPanelMessageId(null);
            }

            // KROK 4: Panel nie istnieje - utwórz nowy
            const controlPanel = await this.buildControlPanel();
            const message = await this.boardChannel.send(controlPanel);
            await this.saveControlPanelMessageId(message.id);
            this.logger.success('Panel kontrolny utworzony na dole');

        } catch (error) {
            this.logger.error('Nie udało się zapewnić panelu kontrolnego:', error);
        }
    }

    // Zaktualizuj istniejący panel kontrolny (lekka funkcja - NIGDY nie tworzy nowego)
    async updateControlPanel() {
        if (!this.boardChannel) {
            this.logger.error('Kanał tablicy nie zainicjalizowany');
            return;
        }

        try {
            let panelMessage = null;

            // Spróbuj użyć znanego ID wiadomości
            if (this.controlPanelMessageId) {
                try {
                    panelMessage = await this.boardChannel.messages.fetch(this.controlPanelMessageId);
                } catch (error) {
                    if (error.code === 10008) {
                        this.logger.warn('Cachowany panel kontrolny nie znaleziony, przeszukuję kanał');
                        await this.saveControlPanelMessageId(null);
                    } else {
                        throw error;
                    }
                }
            }

            // Jeśli nie mamy wiadomości, wyszukaj ją (ale nie twórz)
            if (!panelMessage) {
                const messages = await this.boardChannel.messages.fetch({ limit: 100 });
                for (const [, message] of messages) {
                    if (message.author.id === this.client.user.id &&
                        message.embeds.length > 0 &&
                        message.embeds[0].title === '📋 Panel Kontrolny Przypomnień i Eventów') {
                        panelMessage = message;
                        await this.saveControlPanelMessageId(message.id);
                        this.logger.info('Znaleziono panel kontrolny w kanale');
                        break;
                    }
                }
            }

            // Jeśli znaleziono panel, zaktualizuj go
            if (panelMessage) {
                const controlPanel = await this.buildControlPanel();
                await panelMessage.edit(controlPanel);
                this.logger.success('Panel kontrolny zaktualizowany');
            } else {
                // Panel nie istnieje - nie twórz go, tylko zaloguj ostrzeżenie
                this.logger.warn('Panel kontrolny nie znaleziony - pomijam aktualizację (zostanie utworzony przy następnym restarcie bota)');
            }
        } catch (error) {
            this.logger.error('Nie udało się zaktualizować panelu kontrolnego:', error);
        }
    }

    // Zbuduj panel kontrolny z informacjami
    async buildControlPanel() {
        // Pobierz kanał listy eventów
        const eventsChannelId = this.eventMenedzer.getListChannelId();
        let eventsChannelText = '';
        if (eventsChannelId) {
            eventsChannelText = `📋 **Kanał Listy Eventów:** <#${eventsChannelId}>\n`;
        } else {
            eventsChannelText = `📋 **Kanał Listy Eventów:** _Nie ustawiono (użyj przycisku "Ustaw Listę")_\n`;
        }

        // Pobierz statystyki
        const templates = this.przypomnieniaMenedzer.getAllTemplates();
        const allScheduled = this.przypomnieniaMenedzer.getAllScheduledWithTemplates();
        const events = this.eventMenedzer.getAllEvents();

        const guildId = this.boardChannel?.guild?.id;
        const boardChannelId = this.boardChannel?.id;

        const buildScheduledLines = (list) => {
            if (list.length === 0) return '_Brak_';
            return list.map(s => {
                const name = s.template?.name ?? 'Nieznany szablon';
                const link = s.boardMessageId && guildId && boardChannelId
                    ? `[🔗 Szczegóły](https://discord.com/channels/${guildId}/${boardChannelId}/${s.boardMessageId})`
                    : '🔗 Szczegóły';
                const timestamp = s.nextTrigger
                    ? `<t:${Math.floor(new Date(s.nextTrigger).getTime() / 1000)}:R>`
                    : '';
                return `**${name}**:${timestamp ? ' ' + timestamp : ''} ${link}`;
            }).join('\n');
        };

        const recurring = allScheduled.filter(s => s.status === 'active' && s.interval && !s.isOneTime);
        const oneTime   = allScheduled.filter(s => s.status === 'active' && (!s.interval || s.isOneTime));
        const paused    = allScheduled.filter(s => s.status === 'paused');

        const activeScheduled = allScheduled.filter(s => s.status === 'active');

        const embed = new EmbedBuilder()
            .setColor(0xED4245) // Czerwony
            .setTitle('📋 Panel Kontrolny Przypomnień i Eventów')
            .setDescription(`${eventsChannelText}`)
            .addFields(
                {
                    name: '📊 Statystyki',
                    value: `📚 Szablony: **${templates.length}**\n🔔 Aktywne powiadomienia: **${activeScheduled.length}**\n📅 Eventy: **${events.length}**`,
                    inline: false
                },
                {
                    name: `🔄 Aktywne powiadomienia cykliczne (${recurring.length})`,
                    value: buildScheduledLines(recurring),
                    inline: false
                },
                {
                    name: `⏰ Powiadomienia jednorazowe (${oneTime.length})`,
                    value: buildScheduledLines(oneTime),
                    inline: false
                },
                {
                    name: `⏸️ Powiadomienia wstrzymane (${paused.length})`,
                    value: buildScheduledLines(paused),
                    inline: false
                }
            )
            .setFooter({ text: 'System Przypomnień' });

        const row1 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('board_new_reminder')
                    .setLabel('Nowe Przypomnienie')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('➕'),
                new ButtonBuilder()
                    .setCustomId('board_set_reminder')
                    .setLabel('Ustaw Przypomnienie')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('⏰'),
                new ButtonBuilder()
                    .setCustomId('board_edit_reminder')
                    .setLabel('Edytuj Przypomnienie')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('✏️')
            );

        const row2 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('board_add_event')
                    .setLabel('Dodaj Event')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('📅'),
                new ButtonBuilder()
                    .setCustomId('board_delete_event')
                    .setLabel('Usuń Event')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🗑️'),
                new ButtonBuilder()
                    .setCustomId('board_edit_event')
                    .setLabel('Edytuj Event')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('✏️'),
                new ButtonBuilder()
                    .setCustomId('board_put_list')
                    .setLabel('Ustaw Listę')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📋')
            );

        return { embeds: [embed], components: [row1, row2] };
    }

    // Zbuduj przyciski akcji dla zaplanowanego przypomnienia
    buildActionButtons(scheduled) {
        const row1 = new ActionRowBuilder();
        const row2 = new ActionRowBuilder();
        // Rząd 1: Wstrzymaj/Wznów, Edytuj, Usuń
        if (scheduled.status === 'active') {
            row1.addComponents(
                new ButtonBuilder()
                    .setCustomId(`scheduled_pause_${scheduled.id}`)
                    .setLabel('Wstrzymaj')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⏸️')
            );
        } else if (scheduled.status === 'paused') {
            row1.addComponents(
                new ButtonBuilder()
                    .setCustomId(`scheduled_resume_${scheduled.id}`)
                    .setLabel('Wznów')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('▶️')
            );
        }

        row1.addComponents(
            new ButtonBuilder()
                .setCustomId(`scheduled_edit_${scheduled.id}`)
                .setLabel('Edytuj')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('✏️'),
            new ButtonBuilder()
                .setCustomId(`scheduled_delete_${scheduled.id}`)
                .setLabel('Usuń')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️')
        );

        // Rząd 2: Wyślij, Pokaż, Panel
        row2.addComponents(
            new ButtonBuilder()
                .setCustomId(`scheduled_send_${scheduled.id}`)
                .setLabel('Wyślij')
                .setStyle(ButtonStyle.Success)
                .setEmoji('📨'),
            new ButtonBuilder()
                .setCustomId(`scheduled_preview_${scheduled.id}`)
                .setLabel('Pokaż')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('👁️')
        );

        return [row1, row2];
    }
}

module.exports = TablicaMenedzer;
