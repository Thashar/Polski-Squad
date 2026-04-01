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

// Czy przycisk ma ten sam symbol co oczekiwany na danej pozycji (dla zielonego)
function isSymbolCorrect(pos, buttonNum) {
    return BUTTON_LABELS[buttonNum] === BUTTON_LABELS[pos]; // undefined===undefined dla pustych
}

// Sprawdza czy przyciski rzędu zawierają kolejny ciąg ≥ minLen symboli
// pasujący do dowolnego kolejnego okna w oczekiwanej sekwencji 1-40 (dla niebieskiego)
function hasConsecutiveWindowMatch(rowNums, minLen) {
    for (let ri = 0; ri <= rowNums.length - minLen; ri++) {
        for (let ei = 0; ei <= TOTAL - minLen; ei++) {
            let len = 0;
            while (ri + len < rowNums.length &&
                   ei + len < TOTAL &&
                   BUTTON_LABELS[rowNums[ri + len]] === BUTTON_LABELS[ei + len + 1]) {
                len++;
            }
            if (len >= minLen) return true;
        }
    }
    return false;
}

const COOLDOWN_MS = 3000;

class ButtonOrderService {
    constructor(config) {
        this.config = config;
        this.state = {
            order: Array.from({ length: TOTAL }, (_, i) => i + 1),
            message1Id: null,
            message2Id: null,
            phase2Active: false,
            phase2Selected: [], // tylko PHASE2_DOUBLE_ALLOWED po 1. kliknięciu (niebieskie)
            phase2Clicked: [],  // zaznaczone przyciski (czerwone lub zielone po 2. kliknięciu)
            phase2LastPos: null, // pozycja (= numer) ostatnio klikniętego przycisku
        };
        this.channel = null;
        this.message1 = null;
        this.message2 = null;
        this._locked = false; // globalny cooldown po kliknięciu
        this._cooldownTimer = null;
        this.onWin = null; // callback wywoływany po wygraniu
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

    buildComponents(startIdx, rowCount, disabled = false) {
        const rows = [];

        if (this.state.phase2Active) {
            const clickedSet = new Set(this.state.phase2Clicked);
            const selectedSet = new Set(this.state.phase2Selected);
            for (let r = 0; r < rowCount; r++) {
                const buttons = [];
                for (let c = 0; c < 5; c++) {
                    const idx = startIdx + r * 5 + c;
                    const num = this.state.order[idx];
                    let style;
                    if (selectedSet.has(num))                            style = ButtonStyle.Primary;   // niebieski — 1. klik (tylko double-allowed)
                    else if (clickedSet.has(num) && PHASE2_DOUBLE_ALLOWED.has(num)) style = ButtonStyle.Danger;   // czerwony — 2. klik (double-allowed)
                    else if (clickedSet.has(num))                        style = ButtonStyle.Danger;    // czerwony — zaznaczony (zwykły)
                    else if (NON_EMPTY_BUTTONS.has(num))                 style = ButtonStyle.Success;   // zielony — do kliknięcia
                    else                                                  style = ButtonStyle.Secondary; // szary — pusty
                    buttons.push(
                        new ButtonBuilder()
                            .setCustomId(`btn_order_${num}`)
                            .setLabel(BUTTON_LABELS[num] ?? EMPTY_LABEL)
                            .setStyle(style)
                            .setDisabled(disabled)
                    );
                }
                rows.push(new ActionRowBuilder().addComponents(buttons));
            }
        } else {
            for (let r = 0; r < rowCount; r++) {
                const rowNums = [];
                for (let c = 0; c < 5; c++) {
                    rowNums.push(this.state.order[startIdx + r * 5 + c]);
                }

                // Wyznacz które przyciski są częścią kolejnego dopasowania ≥3
                const blueIndices = new Set();
                for (let ri = 0; ri <= rowNums.length - 3; ri++) {
                    for (let ei = 0; ei <= TOTAL - 3; ei++) {
                        let len = 0;
                        while (ri + len < rowNums.length &&
                               ei + len < TOTAL &&
                               BUTTON_LABELS[rowNums[ri + len]] === BUTTON_LABELS[ei + len + 1]) {
                            len++;
                        }
                        if (len >= 3) {
                            for (let k = 0; k < len; k++) blueIndices.add(ri + k);
                        }
                    }
                }

                // Zielony tylko gdy cały rząd jest poprawny
                const allGreen = rowNums.every((num, c) => isSymbolCorrect(startIdx + r * 5 + c + 1, num));

                // Kolorowanie per-przycisk:
                // zielony = cały rząd poprawny (wyższy priorytet)
                // niebieski = część sekwencyjnego okna ≥3 ale nie zielony
                // szary = nic nie pasuje
                const buttons = [];
                for (let c = 0; c < 5; c++) {
                    const idx = startIdx + r * 5 + c;
                    const num = this.state.order[idx];
                    let style;
                    if (allGreen)               style = ButtonStyle.Success;
                    else if (blueIndices.has(c)) style = ButtonStyle.Primary;
                    else                         style = ButtonStyle.Secondary;
                    buttons.push(
                        new ButtonBuilder()
                            .setCustomId(`btn_order_${num}`)
                            .setLabel(BUTTON_LABELS[num] ?? EMPTY_LABEL)
                            .setStyle(style)
                            .setDisabled(disabled)
                    );
                }
                rows.push(new ActionRowBuilder().addComponents(buttons));
            }
        }

        return rows;
    }

    buildMessage1Data(disabled = false) {
        return { content: '', components: this.buildComponents(0, MSG1_ROWS, disabled) };
    }

    buildMessage2Data(disabled = false) {
        return { content: '', components: this.buildComponents(MSG1_COUNT, MSG2_ROWS, disabled) };
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
            this.message1.edit(this.buildMessage1Data()).catch(err => logger.error('❌ ButtonOrder: błąd aktualizacji wiadomości 1:', err.message)),
            this.message2.edit(this.buildMessage2Data()).catch(err => logger.error('❌ ButtonOrder: błąd aktualizacji wiadomości 2:', err.message))
        ]);
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
        if (this._locked) {
            await interaction.deferUpdate();
            return;
        }

        this._locked = true;
        await interaction.deferUpdate();

        const num = parseInt(interaction.customId.replace('btn_order_', ''), 10);

        if (this.state.phase2Active) {
            await this._handlePhase2Click(num);

            // Faza 2: pokaż nowe kolory, blokada tylko logiczna przez 5s
            await this._updateBothMessages();

            const won = this._checkWin();
            if (won) {
                // Wyłącz wszystkie przyciski (wszystkie czerwone — nieaktywne)
                await Promise.all([
                    this.message1.edit(this.buildMessage1Data(true)).catch(() => {}),
                    this.message2.edit(this.buildMessage2Data(true)).catch(() => {})
                ]);
                logger.success('🏆 ButtonOrder: Wygrałeś!');
                await this.channel.send('## 🎉 Wygrałeś!' + (process.env.PUZZLE_DESC_2 ? `\n${process.env.PUZZLE_DESC_2}` : ''));
                if (this.onWin) await this.onWin();
                return;
            }

            if (this._cooldownTimer) clearTimeout(this._cooldownTimer);
            this._cooldownTimer = setTimeout(() => {
                this._locked = false;
            }, COOLDOWN_MS);
        } else {
            await this._handlePhase1Click(num);
            this._locked = false;
        }
    }

    async _handlePhase1Click(num) {
        const idx = this.state.order.indexOf(num);
        if (idx <= 0) return; // już na górze lub nie znaleziono

        this.state.order.splice(idx, 1);
        this.state.order.unshift(num);

        // Sprawdź czy wszystkie symbole na właściwych miejscach → aktywuj fazę 2
        if (this.state.order.every((n, i) => isSymbolCorrect(i + 1, n))) {
            this.state.phase2Active = true;
            this.state.phase2Selected = [];
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
            this.state.phase2Selected = [];
            this.state.phase2LastPos = null;
            logger.info('🔄 ButtonOrder: kliknięto pusty przycisk — restart fazy 2');
            this.saveState();
            await this._updateBothMessages();
            return;
        }

        // Znajdź faktyczną pozycję przycisku w aktualnym układzie
        const pos = this.state.order.indexOf(num) + 1;

        // Sprawdź przyleganie do poprzednio klikniętego
        if (this.state.phase2LastPos !== null && !this._areAdjacent(this.state.phase2LastPos, pos)) {
            return; // ignoruj kliknięcie niesąsiadujące
        }

        const inClicked = this.state.phase2Clicked.includes(num);
        const inSelected = this.state.phase2Selected.includes(num);

        if (PHASE2_DOUBLE_ALLOWED.has(num)) {
            // Przycisk dozwolony do 2 kliknięć: 1. klik → niebieski, 2. klik → zielony
            if (inClicked) {
                // Trzecie kliknięcie → restart
                this.state.phase2Clicked = [];
                this.state.phase2Selected = [];
                this.state.phase2LastPos = null;
                logger.info('🔄 ButtonOrder: podwójne kliknięcie — restart fazy 2');
            } else if (inSelected) {
                // Drugie kliknięcie → przenieś do clicked (zielony)
                this.state.phase2Selected = this.state.phase2Selected.filter(n => n !== num);
                this.state.phase2Clicked.push(num);
                this.state.phase2LastPos = pos;
            } else {
                // Pierwsze kliknięcie → dodaj do selected (niebieski)
                this.state.phase2Selected.push(num);
                this.state.phase2LastPos = pos;
            }
        } else {
            // Zwykły przycisk: 1. klik → czerwony, 2. klik → restart
            if (inClicked) {
                this.state.phase2Clicked = [];
                this.state.phase2Selected = [];
                this.state.phase2LastPos = null;
                logger.info('🔄 ButtonOrder: podwójne kliknięcie — restart fazy 2');
            } else {
                this.state.phase2Clicked.push(num);
                this.state.phase2LastPos = pos;
            }
        }

        this.saveState();
    }

    _resetPhase2() {
        this.state.phase2Active = false;
        this.state.phase2Selected = [];
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
        this.state.phase2Selected = [];
        this.state.phase2Clicked = [];
        this.state.phase2LastPos = null;
        this.saveState();
        await this._updateBothMessages().catch(err =>
            logger.error('❌ ButtonOrder: błąd aktualizacji po reset:', err.message));
        logger.info('🔢 ButtonOrder: kolejność 1-40, aktywowano fazę 2');
    }

    async handleMessageCreate(message) {
        if (message.channel.id !== this.config.buttonOrder.channelId) return;
        if (message.author.bot) return;
        await message.delete().catch(() => {});
    }

    async handleReactionAdd(reaction, user) {
        if (reaction.message.channel.id !== this.config.buttonOrder.channelId) return;
        if (user.bot) return;
        if (reaction.partial) await reaction.fetch().catch(() => {});
        await reaction.users.remove(user.id).catch(() => {});
    }
}

module.exports = ButtonOrderService;
