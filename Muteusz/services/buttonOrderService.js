const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');
const STATE_FILE = path.join(__dirname, '../data/button_order.json');
const TOTAL = 40;
const MSG1_ROWS = 3; // 3 rzędy × 5 = 15 przycisków
const MSG2_ROWS = 5; // 5 rzędów × 5 = 25 przycisków
const MSG1_COUNT = MSG1_ROWS * 5;

class ButtonOrderService {
    constructor(config) {
        this.config = config;
        this.state = {
            order: Array.from({ length: TOTAL }, (_, i) => i + 1),
            message1Id: null,
            message2Id: null
        };
        this.channel = null;
        this.message1 = null;
        this.message2 = null;
    }

    loadState() {
        try {
            if (fs.existsSync(STATE_FILE)) {
                const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
                this.state = data;
                logger.info('✅ ButtonOrder: stan wczytany');
            }
        } catch (err) {
            logger.error('❌ ButtonOrder: błąd wczytywania stanu:', err.message);
        }
    }

    saveState() {
        try {
            fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
            fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
        } catch (err) {
            logger.error('❌ ButtonOrder: błąd zapisu stanu:', err.message);
        }
    }

    buildComponents(startIdx, rowCount) {
        const rows = [];
        for (let r = 0; r < rowCount; r++) {
            const buttons = [];
            for (let c = 0; c < 5; c++) {
                const num = this.state.order[startIdx + r * 5 + c];
                buttons.push(
                    new ButtonBuilder()
                        .setCustomId(`btn_order_${num}`)
                        .setLabel(`${num}`)
                        .setStyle(ButtonStyle.Secondary)
                );
            }
            rows.push(new ActionRowBuilder().addComponents(buttons));
        }
        return rows;
    }

    buildMessage1Data() {
        return { content: '', components: this.buildComponents(0, MSG1_ROWS) };
    }

    buildMessage2Data() {
        return { content: '', components: this.buildComponents(MSG1_COUNT, MSG2_ROWS) };
    }

    async initialize(client) {
        this.loadState();

        try {
            this.channel = await client.channels.fetch(this.config.buttonOrder.channelId);
        } catch (err) {
            logger.error('❌ ButtonOrder: nie można pobrać kanału:', err.message);
            return;
        }

        // Próba pobrania istniejących wiadomości
        if (this.state.message1Id) {
            try {
                this.message1 = await this.channel.messages.fetch(this.state.message1Id);
            } catch { this.message1 = null; }
        }
        if (this.state.message2Id) {
            try {
                this.message2 = await this.channel.messages.fetch(this.state.message2Id);
            } catch { this.message2 = null; }
        }

        if (!this.message1) {
            this.message1 = await this.channel.send(this.buildMessage1Data());
            this.state.message1Id = this.message1.id;
            this.saveState();
            logger.info('✅ ButtonOrder: utworzono wiadomość 1');
        } else {
            await this.message1.edit(this.buildMessage1Data()).catch(err =>
                logger.error('❌ ButtonOrder: błąd aktualizacji wiadomości 1:', err.message)
            );
        }

        if (!this.message2) {
            this.message2 = await this.channel.send(this.buildMessage2Data());
            this.state.message2Id = this.message2.id;
            this.saveState();
            logger.info('✅ ButtonOrder: utworzono wiadomość 2');
        } else {
            await this.message2.edit(this.buildMessage2Data()).catch(err =>
                logger.error('❌ ButtonOrder: błąd aktualizacji wiadomości 2:', err.message)
            );
        }

        logger.success('✅ ButtonOrder: zainicjalizowany');
    }

    isMyButton(customId) {
        return customId.startsWith('btn_order_');
    }

    async handleButtonClick(interaction) {
        await interaction.deferUpdate();

        const num = parseInt(interaction.customId.replace('btn_order_', ''), 10);
        const idx = this.state.order.indexOf(num);
        if (idx <= 0) return; // już na górze lub nie znaleziono

        this.state.order.splice(idx, 1);
        this.state.order.unshift(num);
        this.saveState();

        await Promise.all([
            this.message1.edit(this.buildMessage1Data()),
            this.message2.edit(this.buildMessage2Data())
        ]).catch(err => logger.error('❌ ButtonOrder: błąd aktualizacji wiadomości:', err.message));
    }
}

module.exports = ButtonOrderService;
