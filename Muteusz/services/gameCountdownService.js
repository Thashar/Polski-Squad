const fs = require('fs');
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');
const DATA_FILE = path.join(__dirname, '../data/game_countdown_state.json');

const COUNTDOWN_CHANNEL_ID = '1486919971165442048';
const TOTAL_SECONDS = 24 * 3600; // 24:00:00
const UPDATE_INTERVAL_MS = 60 * 1000; // co minutę

function formatTime(seconds) {
    const s = Math.max(0, seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

class GameCountdownService {
    constructor() {
        this.client = null;
        this.timeRemaining = TOTAL_SECONDS;
        this.running = false;
        this.timerMessageId = null;
        this.everyoneMessageId = null;
        this._interval = null;
    }

    _loadState() {
        try {
            const raw = fs.readFileSync(DATA_FILE, 'utf8');
            const saved = JSON.parse(raw);
            this.timeRemaining    = saved.timeRemaining    ?? TOTAL_SECONDS;
            this.running          = saved.running          ?? false;
            this.timerMessageId   = saved.timerMessageId   ?? null;
            this.everyoneMessageId = saved.everyoneMessageId ?? null;
        } catch {
            // brak pliku = stan domyślny
        }
    }

    _saveState() {
        try {
            fs.writeFileSync(DATA_FILE, JSON.stringify({
                timeRemaining: this.timeRemaining,
                running: this.running,
                timerMessageId: this.timerMessageId,
                everyoneMessageId: this.everyoneMessageId,
            }, null, 2), 'utf8');
        } catch (err) {
            logger.error('❌ GameCountdown: błąd zapisu stanu:', err.message);
        }
    }

    initialize(client) {
        this.client = client;
        this._loadState();
        if (this.running) {
            this._startInterval();
            logger.info(`✅ GameCountdown: wznowiono odliczanie (pozostało: ${formatTime(this.timeRemaining)})`);
        } else {
            logger.info('✅ GameCountdown: zainicjalizowano');
        }
    }

    _buildTimerContent() {
        return `# <a:PepeAlarmMan:1341086085089857619> Procedura autodestrukcji rozpoczętą <a:PepeAlarmMan:1341086085089857619>\n# ${formatTime(this.timeRemaining)}`;
    }

    _buildEveryoneContent() {
        return [
            '@everyone',
            '## Serwer został przejęty przez boty, które dziś żyją własnym życiem <a:Pepe_ban:1368668861012119635>',
            '## Te inteligentne istoty zdecydowały, że będą uprzykrzać życie innym użytkownikom. <a:PepeEvil2:1280068960787632130>',
            '',
            '## Musicie zdecydować czy zostaniecie Graczami i rozwiążecie wszystkie zagadki przygotowane przez boty, tym samym ratując serwer? <:PepeSolidierVirtittiPapajlari:1401322467397472459>...',
            '',
            '## Czy po prostu zaczekacie aż serwer wszystko pogrąży się w chaosie <a:PepePoar:1280067288397250570> , a później po prostu zniknie. <a:PepeWymazanie:1278017567059087493>',
            '',
            '## Los serwera jest w Waszych rękach! <a:PepePopcorn:1259555900335718532>',
        ].join('\n');
    }

    async start() {
        if (this.running || this.timerMessageId) return; // już trwa lub jeszcze nie zakończono

        try {
            const channel = await this.client.channels.fetch(COUNTDOWN_CHANNEL_ID);
            this.timeRemaining = TOTAL_SECONDS;
            this.running = true;

            const timerMsg = await channel.send({ content: this._buildTimerContent() });
            this.timerMessageId = timerMsg.id;

            const everyoneMsg = await channel.send({ content: this._buildEveryoneContent() });
            this.everyoneMessageId = everyoneMsg.id;

            this._saveState();
            this._startInterval();
            logger.info('🚀 GameCountdown: gra rozpoczęta');
        } catch (err) {
            this.running = false;
            this.timerMessageId = null;
            this.everyoneMessageId = null;
            logger.error('❌ GameCountdown: błąd przy starcie:', err.message);
        }
    }

    async stop() {
        if (!this.running) return;
        this.running = false;
        if (this._interval) { clearInterval(this._interval); this._interval = null; }
        this._saveState();
        logger.info('⏸️ GameCountdown: zatrzymano');
    }

    async resume() {
        if (this.running || !this.timerMessageId) return;
        this.running = true;
        this._saveState();
        this._startInterval();
        logger.info('▶️ GameCountdown: wznowiono');
    }

    async end() {
        this.running = false;
        if (this._interval) { clearInterval(this._interval); this._interval = null; }
        this.timeRemaining = TOTAL_SECONDS;
        this.timerMessageId = null;
        this.everyoneMessageId = null;
        this._saveState();
        logger.info('🏁 GameCountdown: zakończono i zresetowano');
    }

    _startInterval() {
        if (this._interval) clearInterval(this._interval);
        this._interval = setInterval(async () => {
            if (!this.running) return;
            this.timeRemaining = Math.max(0, this.timeRemaining - 60);
            this._saveState();
            await this._updateTimerMessage();
            if (this.timeRemaining <= 0) {
                this.running = false;
                this._saveState();
                clearInterval(this._interval);
                this._interval = null;
                logger.info('💥 GameCountdown: czas autodestrukcji minął');
            }
        }, UPDATE_INTERVAL_MS);
    }

    async _updateTimerMessage() {
        if (!this.timerMessageId) return;
        try {
            const channel = await this.client.channels.fetch(COUNTDOWN_CHANNEL_ID);
            const msg = await channel.messages.fetch(this.timerMessageId);
            await msg.edit({ content: this._buildTimerContent() });
        } catch (err) {
            logger.error('❌ GameCountdown: błąd aktualizacji timera:', err.message);
        }
    }
}

module.exports = GameCountdownService;
