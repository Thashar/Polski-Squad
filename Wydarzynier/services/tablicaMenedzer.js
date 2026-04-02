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
        this.manualPanelMessageId = null;

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
            this.manualPanelMessageId = this.eventMenedzer.getManualPanelMessageId();
            if (this.manualPanelMessageId) {
                this.logger.info(`Wczytano ID wiadomości panelu manualnego: ${this.manualPanelMessageId}`);
            }

            // Rozpocznij okresowe aktualizacje
            this.startPeriodicUpdates();

            // Początkowa synchronizacja
            await this.syncAllNotifications();

            // Upewnij się, że panel kontrolny istnieje (tylko aktualizuj jeśli coś się zmieniło)
            await this.initializeControlPanel();
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

    async saveManualPanelMessageId(messageId) {
        this.manualPanelMessageId = messageId;
        await this.eventMenedzer.setManualPanelMessageId(messageId);
    }

    // Synchronizuj wszystkie powiadomienia na tablicy (przy starcie)
    async syncAllNotifications() {
        const allScheduled = this.przypomnieniaMenedzer.getAllScheduled();
        this.logger.info(`Czyszczenie ${allScheduled.length} indywidualnych embedów z tablicy...`);

        // Usuń wszystkie istniejące indywidualne embedy z tablicy
        for (const scheduled of allScheduled) {
            if (scheduled.boardMessageId) {
                try {
                    const msg = await this.boardChannel.messages.fetch(scheduled.boardMessageId);
                    await msg.delete();
                    this.logger.info(`Usunięto stary embed tablicy dla: ${scheduled.id}`);
                } catch (error) {
                    // Wiadomość już usunięta lub nie istnieje - ignoruj
                }
                await this.przypomnieniaMenedzer.updateBoardMessageId(scheduled.id, null);
            }
        }
    }

    // Utwórz embed dla zaplanowanego przypomnienia (indywidualne embedy usunięte)
    async createEmbed(scheduled) {
        // Indywidualne embedy nie są już używane - panel kontrolny wystarczy
        await this.ensureControlPanel();
        return null;
    }

    // Zaktualizuj istniejący embed (indywidualne embedy usunięte)
    async updateEmbed(scheduled) {
        // Indywidualne embedy nie są już używane
        return true;
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
            if (error.code === 10008) {
                // Wiadomość już usunięta - traktuj jako sukces
                return true;
            }
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
            const rolesText = scheduled.roles[0] === 'everyone'
                ? '@everyone'
                : scheduled.roles.map(r => `<@&${r}>`).join(', ');
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

    // Zaktualizuj panel kontrolny (indywidualne embedy usunięte)
    async updateAllEmbeds() {
        await this.updateControlPanel();
    }

    // Przy starcie bota: aktualizuj panel tylko jeśli coś się zmieniło, nie przenoś na dół
    async initializeControlPanel() {
        if (!this.boardChannel) {
            this.logger.error('Kanał tablicy nie zainicjalizowany');
            return;
        }

        try {
            let existingPanel = null;

            // Szukaj po cached ID
            if (this.controlPanelMessageId) {
                try {
                    existingPanel = await this.boardChannel.messages.fetch(this.controlPanelMessageId);
                } catch (error) {
                    if (error.code === 10008) {
                        this.logger.warn('Cachowany panel kontrolny nie znaleziony, przeszukuję kanał');
                        await this.saveControlPanelMessageId(null);
                    } else {
                        throw error;
                    }
                }
            }

            // Jeśli brak cached, szukaj w kanale
            if (!existingPanel) {
                const messages = await this.boardChannel.messages.fetch({ limit: 100 });
                for (const [, message] of messages) {
                    if (message.author.id === this.client.user.id &&
                        message.embeds.length > 0 &&
                        message.embeds[0].title === '📋 Panel Kontrolny Przypomnień i Eventów') {
                        existingPanel = message;
                        await this.saveControlPanelMessageId(message.id);
                        this.logger.info('Znaleziono panel kontrolny w kanale');
                        break;
                    }
                }
            }

            const newPanel = await this.buildControlPanel();

            if (existingPanel) {
                // Porównaj treść - aktualizuj tylko jeśli coś się zmieniło
                const existingEmbed = existingPanel.embeds[0];
                const newEmbedData = newPanel.embeds[0].data;
                const existingContent = JSON.stringify({
                    description: existingEmbed.description,
                    fields: existingEmbed.fields
                });
                const newContent = JSON.stringify({
                    description: newEmbedData.description,
                    fields: newEmbedData.fields
                });

                if (existingContent !== newContent) {
                    await existingPanel.edit(newPanel);
                    this.logger.info('Panel kontrolny zaktualizowany przy starcie (wykryto zmiany)');
                } else {
                    this.logger.info('Panel kontrolny bez zmian - pominięto aktualizację');
                }
            } else {
                // Panel nie istnieje - utwórz nowy
                const message = await this.boardChannel.send(newPanel);
                await this.saveControlPanelMessageId(message.id);
                this.logger.success('Panel kontrolny utworzony przy starcie');
            }
        } catch (error) {
            this.logger.error('Nie udało się zainicjalizować panelu kontrolnego:', error);
        }
    }

    // Utwórz lub zaktualizuj panel kontrolny (używane w trakcie działania - przenosi na dół)
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

        await this.ensureManualPanel();
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

        const buildScheduledFields = (list, title, showChannel = false) => {
            if (list.length === 0) return [{ name: title, value: '_Brak_', inline: false }];
            const lines = list.map(s => {
                const name = s.template?.name ?? 'Nieznany szablon';
                const info = showChannel
                    ? (s.channelId ? `<#${s.channelId}>` : '')
                    : (s.nextTrigger ? `<t:${Math.floor(new Date(s.nextTrigger).getTime() / 1000)}:R>` : '');
                return `**${name}**:${info ? ' ' + info : ''}`;
            });
            const fields = [];
            let current = '';
            for (const line of lines) {
                const next = current ? current + '\n' + line : line;
                if (next.length > 1024) {
                    fields.push(current);
                    current = line;
                } else {
                    current = next;
                }
            }
            if (current) fields.push(current);
            return fields.map((value, i) => ({
                name: i === 0 ? title : '\u200b',
                value,
                inline: false
            }));
        };

        const sortByNextTrigger = (a, b) => new Date(a.nextTrigger || 0) - new Date(b.nextTrigger || 0);

        const recurring = allScheduled.filter(s => s.status === 'active' && !s.isManual && s.interval && !s.isOneTime).sort(sortByNextTrigger);
        const oneTime   = allScheduled.filter(s => s.status === 'active' && !s.isManual && (!s.interval || s.isOneTime)).sort(sortByNextTrigger);
        const paused    = allScheduled.filter(s => s.status === 'paused' && !s.isManual).sort(sortByNextTrigger);
        const manual    = allScheduled.filter(s => s.isManual);

        const activeScheduled = allScheduled.filter(s => s.status === 'active' && !s.isManual);

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
                ...buildScheduledFields(recurring, `🔄 Aktywne powiadomienia cykliczne (${recurring.length})`),
                ...buildScheduledFields(oneTime, `⏰ Powiadomienia jednorazowe (${oneTime.length})`),
                ...buildScheduledFields(paused, `⏸️ Powiadomienia wstrzymane (${paused.length})`),
                ...buildScheduledFields(manual, `🖐️ Powiadomienia manualne (${manual.length})`, true)
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
                    .setLabel('Ustaw')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('⏰'),
                new ButtonBuilder()
                    .setCustomId('board_edit_reminder')
                    .setLabel('Edytuj')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('✏️')
            );

        const row2 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('board_add_event')
                    .setLabel('Nowy Event')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('📅'),
                new ButtonBuilder()
                    .setCustomId('board_edit_event')
                    .setLabel('Edytuj')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('✏️'),
                new ButtonBuilder()
                    .setCustomId('board_delete_event')
                    .setLabel('Usuń')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🗑️'),
                new ButtonBuilder()
                    .setCustomId('board_put_list')
                    .setLabel('Ustaw Listę')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📋')
            );

        return { embeds: [embed], components: [row1, row2] };
    }

    buildManualPanel() {
        const allScheduled = this.przypomnieniaMenedzer.getAllScheduledWithTemplates();
        this.logger.info(`[ManualPanel] Wszystkich scheduled: ${allScheduled.length}, z isManual: ${allScheduled.filter(s => s.isManual).length}`);
        allScheduled.forEach(s => this.logger.info(`[ManualPanel] id=${s.id} isManual=${s.isManual} status=${s.status} template=${s.template?.name}`));
        const manual = allScheduled.filter(s => s.isManual);
        if (manual.length === 0) return null;

        const rows = [];
        let currentRow = [];
        for (const s of manual) {
            if (currentRow.length === 5) {
                rows.push(new ActionRowBuilder().addComponents(currentRow));
                currentRow = [];
            }
            if (rows.length === 5) break; // max 5 rzędów Discord

            const templateName = (s.template?.name ?? 'Nieznany').slice(0, 30);
            const channel = s.channelId ? this.client.channels.cache.get(s.channelId) : null;
            const channelLabel = channel ? `#${channel.name}` : `#${s.channelId}`;
            const label = `${templateName} → ${channelLabel}`.slice(0, 80);

            currentRow.push(
                new ButtonBuilder()
                    .setCustomId(`scheduled_send_${s.id}`)
                    .setLabel(label)
                    .setStyle(ButtonStyle.Primary)
            );
        }
        if (currentRow.length > 0) rows.push(new ActionRowBuilder().addComponents(currentRow));

        return { content: '🖐️ **Powiadomienia manualne** — kliknij aby wysłać:', components: rows };
    }

    async ensureManualPanel() {
        if (!this.boardChannel) return;

        try {
            const panelData = this.buildManualPanel();

            // Znajdź istniejącą wiadomość
            let existingMsg = null;
            if (this.manualPanelMessageId) {
                try {
                    existingMsg = await this.boardChannel.messages.fetch(this.manualPanelMessageId);
                } catch (error) {
                    if (error.code === 10008) {
                        await this.saveManualPanelMessageId(null);
                    } else throw error;
                }
            }

            // Brak manualnych → usuń wiadomość jeśli istnieje
            if (!panelData) {
                if (existingMsg) {
                    await existingMsg.delete().catch(() => {});
                    await this.saveManualPanelMessageId(null);
                    this.logger.info('Usunięto panel manualny - brak powiadomień manualnych');
                }
                return;
            }

            // Usuń stary panel żeby wysłać nowy na dole
            if (existingMsg) {
                await existingMsg.delete().catch(() => {});
                await this.saveManualPanelMessageId(null);
            }

            const message = await this.boardChannel.send(panelData);
            await this.saveManualPanelMessageId(message.id);
            this.logger.info('Panel manualny wysłany na dole');

        } catch (error) {
            this.logger.error('Błąd przy aktualizacji panelu manualnego:', error);
        }
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
