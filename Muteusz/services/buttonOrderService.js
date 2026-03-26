const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');
const STATE_FILE = path.join(__dirname, '../data/button_order.json');
const TOTAL = 40;

const BUTTON_LABELS = {
    3:  '︿',
    7:  '╱',  11: '╱',  24: '╱',  32: '╱',
    9:  '╲',  15: '╲',  22: '╲',  34: '╲',
    28: '╳',
    16: '⎾',
    36: '⎿',
    40: '⏌',
    20: '⏋',
    17: '─',  18: '─',  19: '─',  37: '─',  38: '─',  39: '─',
    21: '│',  25: '│',  26: '│',  30: '│',  31: '│',  35: '│',
};
const EMPTY_LABEL = '\u2800'; // Braille Pattern Blank — niewidoczny dla Discord, akceptowany jako label
const MSG1_ROWS = 3; // 3 rzędy × 5 = 15 przycisków
const MSG2_ROWS = 5; // 5 rzędów × 5 = 25 przycisków
const MSG1_COUNT = MSG1_ROWS * 5;

// Grupy przycisków zamiennych — przycisk jest "na miejscu" jeśli
// znajduje się na dowolnej pozycji ze swojej grupy
const LABELED_NUMS = new Set(Object.keys(BUTTON_LABELS).map(Number));
const EMPTY_NUMS = Array.from({ length: TOTAL }, (_, i) => i + 1).filter(n => !LABELED_NUMS.has(n));

const RAW_GROUPS = [
    [7, 11, 24, 32],
    [9, 15, 22, 34],
    [17, 18, 19, 37, 38, 39],
    [21, 25, 26, 30, 31, 35],
    EMPTY_NUMS,
];

const NUM_TO_GROUP = new Map();
for (const group of RAW_GROUPS) {
    const groupSet = new Set(group);
    for (const n of group) NUM_TO_GROUP.set(n, groupSet);
}

// Faza 2 — specjalne stałe
const PHASE2_DOUBLE_ALLOWED = new Set([16, 20, 28, 36, 40]);
const NON_EMPTY_BUTTONS = new Set(Object.keys(BUTTON_LABELS).map(Number));

// Buduje zbiór pozycji (1-based) uznanych za "poprawne" dla danego układu.
// Zamienne przyciski liczą się jako poprawne tylko jeśli w obrębie grupy
// są ułożone rosnąco wg pozycji (sekwencyjnie).
function buildCorrectSet(order) {
    const correct = new Set();

    // Dokładne trafienie zawsze poprawne
    for (let i = 0; i < order.length; i++) {
        if (order[i] === i + 1) correct.add(i + 1);
    }

    // Grupy zamienne: sprawdź rosnącą kolejność przycisków na rosnących pozycjach
    for (const group of RAW_GROUPS) {
        const groupSet = new Set(group);
        const sortedPositions = [...group].sort((a, b) => a - b);
        let prevBtn = -Infinity;
        for (const pos of sortedPositions) {
            const btn = order[pos - 1];
            if (groupSet.has(btn) && btn > prevBtn) {
                correct.add(pos);
                prevBtn = btn;
            }
        }
    }

    return correct;
}

class ButtonOrderService {
    constructor(config) {
        this.config = config;
        this.state = {
            order: Array.from({ length: TOTAL }, (_, i) => i + 1),
            message1Id: null,
            message2Id: null,
            phase2Active: false,
            phase2Clicked: [],   // numery przycisków zaznaczonych (czerwonych)
            phase2LastPos: null, // pozycja (= numer) ostatnio klikniętego przycisku
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

        if (this.state.phase2Active) {
            const clickedSet = new Set(this.state.phase2Clicked);
            for (let r = 0; r < rowCount; r++) {
                const buttons = [];
                for (let c = 0; c < 5; c++) {
                    const idx = startIdx + r * 5 + c;
                    const num = this.state.order[idx];
                    let style;
                    if (clickedSet.has(num))            style = ButtonStyle.Danger;   // czerwony — zaznaczony
                    else if (NON_EMPTY_BUTTONS.has(num)) style = ButtonStyle.Success;  // zielony — do kliknięcia
                    else                                 style = ButtonStyle.Secondary; // szary — pusty
                    buttons.push(
                        new ButtonBuilder()
                            .setCustomId(`btn_order_${num}`)
                            .setLabel(BUTTON_LABELS[num] ?? EMPTY_LABEL)
                            .setStyle(style)
                    );
                }
                rows.push(new ActionRowBuilder().addComponents(buttons));
            }
        } else {
            const correctSet = buildCorrectSet(this.state.order);
            for (let r = 0; r < rowCount; r++) {
                let correctCount = 0;
                for (let c = 0; c < 5; c++) {
                    const idx = startIdx + r * 5 + c;
                    if (correctSet.has(idx + 1)) correctCount++;
                }
                const rowStyle = correctCount === 5 ? ButtonStyle.Success
                               : correctCount >= 3  ? ButtonStyle.Primary
                               : ButtonStyle.Secondary;
                const buttons = [];
                for (let c = 0; c < 5; c++) {
                    const idx = startIdx + r * 5 + c;
                    const num = this.state.order[idx];
                    buttons.push(
                        new ButtonBuilder()
                            .setCustomId(`btn_order_${num}`)
                            .setLabel(BUTTON_LABELS[num] ?? EMPTY_LABEL)
                            .setStyle(rowStyle)
                    );
                }
                rows.push(new ActionRowBuilder().addComponents(buttons));
            }
        }

        return rows;
    }

    buildMessage1Data() {
        return { content: '', components: this.buildComponents(0, MSG1_ROWS) };
    }

    buildMessage2Data() {
        const won = this._checkWin();
        return {
            content: won ? '## 🎉 Wygrałeś!' : '',
            components: this.buildComponents(MSG1_COUNT, MSG2_ROWS)
        };
    }

    _checkWin() {
        if (!this.state.phase2Active) return false;
        const clickedSet = new Set(this.state.phase2Clicked);
        for (const n of NON_EMPTY_BUTTONS) {
            if (!clickedSet.has(n)) return false;
        }
        return true;
    }

    _areAdjacent(pos1, pos2) {
        const row1 = Math.floor((pos1 - 1) / 5);
        const col1 = (pos1 - 1) % 5;
        const row2 = Math.floor((pos2 - 1) / 5);
        const col2 = (pos2 - 1) % 5;
        return pos1 !== pos2 && Math.abs(row1 - row2) <= 1 && Math.abs(col1 - col2) <= 1;
    }

    async _updateBothMessages() {
        await Promise.all([
            this.message1.edit(this.buildMessage1Data()),
            this.message2.edit(this.buildMessage2Data())
        ]).catch(err => logger.error('❌ ButtonOrder: błąd aktualizacji wiadomości:', err.message));
    }

    // Szuka wiadomości bota z przyciskami btn_order_ na kanale
    async _scanChannelForMessages() {
        const found = [];
        let before;
        // Przeglądaj do 200 ostatnich wiadomości
        for (let i = 0; i < 2; i++) {
            const opts = { limit: 100 };
            if (before) opts.before = before;
            const batch = await this.channel.messages.fetch(opts);
            if (batch.size === 0) break;
            for (const msg of batch.values()) {
                if (msg.author.id === this.channel.client.user.id && msg.components.length > 0) {
                    const firstId = msg.components[0]?.components[0]?.customId || '';
                    if (firstId.startsWith('btn_order_')) found.push(msg);
                }
            }
            before = batch.last()?.id;
            if (batch.size < 100) break;
        }
        // Sortuj od najstarszej do najnowszej
        found.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        return found;
    }

    async initialize(client) {
        this.loadState();

        try {
            this.channel = await client.channels.fetch(this.config.buttonOrder.channelId);
        } catch (err) {
            logger.error('❌ ButtonOrder: nie można pobrać kanału:', err.message);
            return;
        }

        // Próba pobrania wiadomości po zapisanych ID
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

        // Jeśli brakuje wiadomości - szukaj istniejących na kanale zanim cokolwiek wyślesz
        if (!this.message1 || !this.message2) {
            const existing = await this._scanChannelForMessages();
            if (!this.message1 && existing.length >= 1) {
                this.message1 = existing[0];
                this.state.message1Id = this.message1.id;
                logger.info('✅ ButtonOrder: znaleziono wiadomość 1 na kanale');
            }
            if (!this.message2 && existing.length >= 2) {
                this.message2 = existing[1];
                this.state.message2Id = this.message2.id;
                logger.info('✅ ButtonOrder: znaleziono wiadomość 2 na kanale');
            }
            if (existing.length > 0) this.saveState();
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

        if (this.state.phase2Active) {
            await this._handlePhase2Click(num);
        } else {
            await this._handlePhase1Click(num);
        }
    }

    async _handlePhase1Click(num) {
        const idx = this.state.order.indexOf(num);
        if (idx <= 0) return; // już na górze lub nie znaleziono

        this.state.order.splice(idx, 1);
        this.state.order.unshift(num);

        // Sprawdź czy wszystkie poprawnie ułożone → aktywuj fazę 2
        if (buildCorrectSet(this.state.order).size === TOTAL) {
            this.state.phase2Active = true;
            this.state.phase2Clicked = [];
            this.state.phase2LastPos = null;
            logger.info('🎮 ButtonOrder: wszystkie ułożone — aktywuję fazę 2');
        }

        this.saveState();
        await this._updateBothMessages();
    }

    async _handlePhase2Click(num) {
        // Kliknięcie pustego przycisku → restart fazy 2
        if (!NON_EMPTY_BUTTONS.has(num)) {
            this.state.phase2Clicked = [];
            this.state.phase2LastPos = null;
            logger.info('🔄 ButtonOrder: kliknięto pusty przycisk — restart fazy 2');
            this.saveState();
            await this._updateBothMessages();
            return;
        }

        // W fazie 2 pozycja przycisku = jego numer (kolejność jest idealna)
        const pos = num;

        // Sprawdź przyleganie do poprzednio klikniętego
        if (this.state.phase2LastPos !== null && !this._areAdjacent(this.state.phase2LastPos, pos)) {
            return; // ignoruj kliknięcie niesąsiadujące
        }

        const alreadyClicked = this.state.phase2Clicked.includes(num);

        if (alreadyClicked && !PHASE2_DOUBLE_ALLOWED.has(num)) {
            // Podwójne kliknięcie niedozwolone → restart fazy 2
            this.state.phase2Clicked = [];
            this.state.phase2LastPos = null;
            logger.info('🔄 ButtonOrder: podwójne kliknięcie — restart fazy 2');
        } else {
            if (!alreadyClicked) this.state.phase2Clicked.push(num);
            this.state.phase2LastPos = pos;
        }

        this.saveState();
        await this._updateBothMessages();

        if (this._checkWin()) {
            logger.success('🏆 ButtonOrder: Wygrałeś!');
        }
    }

    _resetPhase2() {
        this.state.phase2Active = false;
        this.state.phase2Clicked = [];
        this.state.phase2LastPos = null;
    }

    async shuffle() {
        this._resetPhase2();
        for (let i = this.state.order.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.state.order[i], this.state.order[j]] = [this.state.order[j], this.state.order[i]];
        }
        this.saveState();
        await this._updateBothMessages().catch(err =>
            logger.error('❌ ButtonOrder: błąd aktualizacji po shuffle:', err.message));
        logger.info('🔀 ButtonOrder: przyciski pomieszane');
    }

    async resetOrder() {
        this.state.order = Array.from({ length: TOTAL }, (_, i) => i + 1);
        this.state.phase2Active = true;
        this.state.phase2Clicked = [];
        this.state.phase2LastPos = null;
        this.saveState();
        await this._updateBothMessages().catch(err =>
            logger.error('❌ ButtonOrder: błąd aktualizacji po reset:', err.message));
        logger.info('🔢 ButtonOrder: kolejność 1-40, aktywowano fazę 2');
    }
}

module.exports = ButtonOrderService;
