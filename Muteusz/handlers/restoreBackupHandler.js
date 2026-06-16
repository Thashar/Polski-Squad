const fs = require('fs');
const path = require('path');
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags
} = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');

const SESSION_TTL = 15 * 60 * 1000;
const PER_PAGE = 25;
const SNOWFLAKE = /^\d{17,20}$/;

/**
 * Kompleksowy kreator przywracania danych z backupów Google Drive (/restore-backup).
 *
 * Tryby:
 *  - all    — przywróć cały backup (wszystkie boty, wszystkie pliki)
 *  - bot    — przywróć konkretnego bota (całość lub wybrane pliki z przeglądarką)
 *  - broken — przywróć tylko uszkodzone pliki (0 bajtów lub brakujące)
 *
 * Czas: najnowszy backup lub z konkretnego dnia (RRRR-MM-DD).
 *
 * Przeglądarka plików rozwiązuje ID na czytelne nazwy: ID serwera → nazwa serwera,
 * ID gracza (pliki w folderze wyniki/) → nick gracza.
 *
 * Przed nadpisaniem istniejących plików tworzona jest kopia bezpieczeństwa w
 * `_restore_safety/<timestamp>/` w katalogu głównym projektu (poza folderami data, więc
 * nie trafia do kolejnych backupów).
 */
class RestoreBackupHandler {
    constructor(config, logService) {
        this.config = config;
        this.logService = logService;
        // userId → sesja kreatora
        this.sessions = new Map();
    }

    // ===================== Zarządzanie sesją =====================

    newSession(userId) {
        const BackupManager = require('../../utils/backupManager');
        const session = {
            userId,
            bm: new BackupManager(),
            mode: null,            // 'all' | 'bot' | 'broken'
            botName: null,
            date: null,            // 'latest' | 'YYYY-MM-DD'
            pickedFileId: null,    // ID konkretnego wybranego backupu (tryb bot → wybór z listy)
            pickedFileName: null,
            backupList: [],        // ostatnio wylistowane backupy (do mapowania ID→meta)
            applyType: null,       // 'all' | 'files' | 'broken'
            tempDirs: {},          // botName → katalog z rozpakowanym backupem
            prepared: null,        // wynik prepareRestore (tryb broken)
            browsePath: '',
            page: 0,
            selected: new Set(),   // relatywne ścieżki plików do przywrócenia
            nameCache: new Map(),
            guildConfigMap: this.loadGuildConfigMap(),
            timeout: null,
        };
        session.timeout = setTimeout(() => this.cleanupSession(userId), SESSION_TTL);
        return session;
    }

    getSession(interaction) {
        return this.sessions.get(interaction.user.id);
    }

    resetToMode(session) {
        for (const dir of Object.values(session.tempDirs)) {
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
        }
        if (session.prepared) { try { session.bm.cleanupRestore(session.prepared); } catch {} }
        session.mode = null;
        session.botName = null;
        session.date = null;
        session.pickedFileId = null;
        session.pickedFileName = null;
        session.backupList = [];
        session.applyType = null;
        session.tempDirs = {};
        session.prepared = null;
        session.browsePath = '';
        session.page = 0;
        session.selected = new Set();
    }

    cleanupSession(userId) {
        const session = this.sessions.get(userId);
        if (!session) return;
        clearTimeout(session.timeout);
        for (const dir of Object.values(session.tempDirs)) {
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
        }
        if (session.prepared) { try { session.bm.cleanupRestore(session.prepared); } catch {} }
        this.sessions.delete(userId);
    }

    loadGuildConfigMap() {
        try {
            const p = path.join(__dirname, '..', '..', 'EndersEcho', 'data', 'guild_configs.json');
            return JSON.parse(fs.readFileSync(p, 'utf8')) || {};
        } catch {
            return {};
        }
    }

    // ===================== Rozwiązywanie nazw (ID → nazwa) =====================

    async resolveGuildName(client, session, id) {
        const key = `g:${id}`;
        if (session.nameCache.has(key)) return session.nameCache.get(key);
        let name = client.guilds.cache.get(id)?.name || null;
        if (!name) {
            const gc = session.guildConfigMap[id];
            if (gc) name = gc.guildName || gc.name || gc.tag || null;
        }
        if (name) session.nameCache.set(key, name);
        return name;
    }

    async resolveUserName(client, session, id) {
        const key = `u:${id}`;
        if (session.nameCache.has(key)) return session.nameCache.get(key);
        let name = null;
        try {
            const user = await client.users.fetch(id);
            name = user.globalName || user.username;
        } catch {}
        if (name) session.nameCache.set(key, name);
        return name;
    }

    /**
     * Zamienia nazwę pliku/folderu na czytelną, jeśli jest to ID (snowflake).
     * @param {string} rawName
     * @param {'guild'|'user'|'any'} hint
     */
    async prettyName(client, session, rawName, hint) {
        const isJson = rawName.toLowerCase().endsWith('.json');
        const core = isJson ? rawName.slice(0, -5) : rawName;
        if (!SNOWFLAKE.test(core)) return rawName;

        let resolved = null;
        if (hint === 'guild') {
            resolved = await this.resolveGuildName(client, session, core);
        } else if (hint === 'user') {
            resolved = await this.resolveUserName(client, session, core);
        } else {
            resolved = await this.resolveGuildName(client, session, core)
                || await this.resolveUserName(client, session, core);
        }
        if (!resolved) return rawName;
        return isJson ? `${resolved}.json` : resolved;
    }

    /** Podpowiedź typu ID dla DZIECI danego folderu (na podstawie nazwy folderu). */
    childHint(browsePath) {
        const segs = browsePath.split('/').filter(Boolean);
        const last = segs[segs.length - 1];
        if (last === 'guilds') return 'guild';
        if (last === 'wyniki') return 'user';
        return 'any';
    }

    async breadcrumb(client, session) {
        if (!session.browsePath) return `${session.botName}/`;
        const segs = session.browsePath.split('/').filter(Boolean);
        const out = [session.botName];
        for (let i = 0; i < segs.length; i++) {
            const parent = segs[i - 1];
            const hint = parent === 'guilds' ? 'guild' : parent === 'wyniki' ? 'user' : 'any';
            out.push(await this.prettyName(client, session, segs[i], hint));
        }
        return out.join(' / ');
    }

    // ===================== Operacje na plikach (system plików) =====================

    listDir(tempDir, relPath) {
        const abs = path.join(tempDir, relPath);
        let entries;
        try {
            entries = fs.readdirSync(abs, { withFileTypes: true });
        } catch {
            return [];
        }
        const dirs = entries.filter(e => e.isDirectory()).map(e => ({ name: e.name, isDir: true, size: 0 }));
        const files = entries.filter(e => e.isFile()).map(e => {
            let size = 0;
            try { size = fs.statSync(path.join(abs, e.name)).size; } catch {}
            return { name: e.name, isDir: false, size };
        });
        dirs.sort((a, b) => a.name.localeCompare(b.name));
        files.sort((a, b) => a.name.localeCompare(b.name));
        return [...dirs, ...files];
    }

    walkFiles(tempDir, relBase = '') {
        const out = [];
        const abs = path.join(tempDir, relBase);
        let entries;
        try {
            entries = fs.readdirSync(abs, { withFileTypes: true });
        } catch {
            return out;
        }
        for (const e of entries) {
            const rel = relBase ? `${relBase}/${e.name}` : e.name;
            if (e.isDirectory()) out.push(...this.walkFiles(tempDir, rel));
            else if (e.isFile()) out.push(rel);
        }
        return out;
    }

    fmtSize(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    }

    async ensureBotDownloaded(session, botName) {
        if (session.tempDirs[botName]) return session.tempDirs[botName];
        let res;
        if (session.pickedFileId && botName === session.botName) {
            res = await session.bm.downloadAndExtractById(botName, session.pickedFileId, session.pickedFileName);
        } else if (session.date && session.date !== 'latest') {
            res = await session.bm.downloadAndExtractBackupByDate(botName, session.date);
        } else {
            res = await session.bm.downloadAndExtractLatest(botName);
        }
        if (!res) return null;
        session.tempDirs[botName] = res.tempDir;
        return res.tempDir;
    }

    fmtDateTime(d) {
        const p = n => String(n).padStart(2, '0');
        return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    versionLabel(session) {
        if (session.pickedFileId) {
            const picked = session.backupList.find(f => f.id === session.pickedFileId);
            if (picked) return `${picked.name} (${this.fmtDateTime(new Date(picked.createdTime))})`;
            return 'wybrany backup';
        }
        return session.date === 'latest' ? 'najnowsza' : session.date;
    }

    // ===================== Widoki (render) =====================

    renderMode() {
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('♻️ Przywracanie danych z backupu')
            .setDescription([
                'Wybierz **co** chcesz przywrócić z Google Drive:',
                '',
                '🗂️ **Cały backup** — wszystkie pliki wszystkich botów',
                '🤖 **Konkretny bot** — całość lub wybrane pliki (z przeglądarką)',
                '🩹 **Tylko uszkodzone** — pliki 0 bajtów lub brakujące',
                '',
                '_Najpierw wybierzesz wersję backupu (najnowszą lub z konkretnego dnia), a dane zostaną pobrane przed wyborem plików._',
            ].join('\n'));

        const rows = [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('rb_mode_all').setLabel('Cały backup').setStyle(ButtonStyle.Primary).setEmoji('🗂️'),
                new ButtonBuilder().setCustomId('rb_mode_bot').setLabel('Konkretny bot').setStyle(ButtonStyle.Primary).setEmoji('🤖'),
                new ButtonBuilder().setCustomId('rb_mode_broken').setLabel('Tylko uszkodzone').setStyle(ButtonStyle.Secondary).setEmoji('🩹')
            ),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('rb_cancel').setLabel('Anuluj').setStyle(ButtonStyle.Danger).setEmoji('❌')
            ),
        ];
        return { embeds: [embed], components: rows, content: '' };
    }

    renderBotSelect(session) {
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🤖 Wybierz bota')
            .setDescription('Z którego bota chcesz przywrócić dane?');

        const options = session.bm.bots.map(b => ({
            label: b,
            value: b,
            emoji: b === 'shared_data' ? '🔗' : '🤖',
        }));

        return {
            embeds: [embed],
            content: '',
            components: [
                new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('rb_bot_select').setPlaceholder('Wybierz bota…').addOptions(options)
                ),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('rb_back_mode').setLabel('Wstecz').setStyle(ButtonStyle.Secondary).setEmoji('◀️'),
                    new ButtonBuilder().setCustomId('rb_cancel').setLabel('Anuluj').setStyle(ButtonStyle.Danger).setEmoji('❌')
                ),
            ],
        };
    }

    renderTime(session) {
        const scope = session.mode === 'bot' ? `bota **${session.botName}**`
            : session.mode === 'broken' ? '**uszkodzonych plików**' : '**całego backupu**';
        const lines = [
            `Którą wersję backupu ${scope} pobrać?`,
            '',
            '📅 **Najnowszy** — ostatni dostępny backup',
            '🗓️ **Konkretny dzień** — podasz datę (RRRR-MM-DD)',
        ];
        if (session.mode === 'bot') {
            lines.push('📜 **Wybierz z listy** — konkretny backup wg daty i godziny utworzenia');
        }
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🕐 Wersja backupu')
            .setDescription(lines.join('\n'));

        const timeRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('rb_time_latest').setLabel('Najnowszy').setStyle(ButtonStyle.Success).setEmoji('📅'),
            new ButtonBuilder().setCustomId('rb_time_date').setLabel('Konkretny dzień').setStyle(ButtonStyle.Primary).setEmoji('🗓️')
        );
        if (session.mode === 'bot') {
            timeRow.addComponents(
                new ButtonBuilder().setCustomId('rb_time_list').setLabel('Wybierz z listy').setStyle(ButtonStyle.Primary).setEmoji('📜')
            );
        }

        return {
            embeds: [embed],
            content: '',
            components: [
                timeRow,
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('rb_back_mode').setLabel('Wstecz').setStyle(ButtonStyle.Secondary).setEmoji('◀️'),
                    new ButtonBuilder().setCustomId('rb_cancel').setLabel('Anuluj').setStyle(ButtonStyle.Danger).setEmoji('❌')
                ),
            ],
        };
    }

    renderBackupList(session) {
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`📜 Backupy: ${session.botName}`)
            .setDescription('Wybierz konkretny backup z listy (data i godzina utworzenia na Google Drive):\n🅰 = automatyczny · 🅼 = manualny');

        const options = session.backupList.slice(0, 25).map(f => {
            const d = new Date(f.createdTime);
            const sizeLabel = f.size ? ` · ${this.fmtSize(Number(f.size))}` : '';
            const tag = f.isManual ? '🅼' : '🅰';
            return {
                label: `${tag} ${this.fmtDateTime(d)}`.slice(0, 100),
                value: f.id,
                description: `${f.isManual ? 'manualny' : 'auto'} · ${f.name}${sizeLabel}`.slice(0, 100),
            };
        });

        return {
            embeds: [embed],
            content: '',
            components: [
                new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('rb_backup_select').setPlaceholder('Wybierz backup…').addOptions(options)
                ),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('rb_back_mode').setLabel('Wstecz').setStyle(ButtonStyle.Secondary).setEmoji('◀️'),
                    new ButtonBuilder().setCustomId('rb_cancel').setLabel('Anuluj').setStyle(ButtonStyle.Danger).setEmoji('❌')
                ),
            ],
        };
    }

    renderBotAction(session) {
        const dir = session.tempDirs[session.botName];
        const fileCount = dir ? this.walkFiles(dir, '').length : 0;
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`🤖 ${session.botName} — zakres przywracania`)
            .setDescription(`📦 Wersja: **${this.versionLabel(session)}**\nBackup pobrany (**${fileCount}** plików).\n\n📦 **Przywróć całego bota** — wszystkie pliki\n🗂️ **Wybierz pliki** — przeglądarka z zaznaczaniem`);

        return {
            embeds: [embed],
            content: '',
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('rb_bot_all').setLabel('Przywróć całego bota').setStyle(ButtonStyle.Primary).setEmoji('📦'),
                    new ButtonBuilder().setCustomId('rb_browse').setLabel('Wybierz pliki').setStyle(ButtonStyle.Primary).setEmoji('🗂️')
                ),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('rb_back_mode').setLabel('Wstecz').setStyle(ButtonStyle.Secondary).setEmoji('◀️'),
                    new ButtonBuilder().setCustomId('rb_cancel').setLabel('Anuluj').setStyle(ButtonStyle.Danger).setEmoji('❌')
                ),
            ],
        };
    }

    async renderBrowse(interaction, session) {
        const client = interaction.client;
        const tempDir = session.tempDirs[session.botName];
        const entries = this.listDir(tempDir, session.browsePath);
        const pages = Math.max(1, Math.ceil(entries.length / PER_PAGE));
        if (session.page >= pages) session.page = pages - 1;
        if (session.page < 0) session.page = 0;
        const slice = entries.slice(session.page * PER_PAGE, session.page * PER_PAGE + PER_PAGE);
        const hint = this.childHint(session.browsePath);
        const crumb = await this.breadcrumb(client, session);

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`🗂️ Przeglądanie: ${session.botName}`)
            .setDescription([
                `📍 \`${crumb}\``,
                '',
                '📁 = folder (kliknij, by wejść) · 📄 = plik (kliknij, by zaznaczyć/odznaczyć)',
                `**Zaznaczonych plików:** ${session.selected.size}`,
            ].join('\n'))
            .setFooter({ text: `Strona ${session.page + 1}/${pages} · ${entries.length} pozycji w folderze` });

        const options = [];
        for (const e of slice) {
            const pretty = await this.prettyName(client, session, e.name, hint);
            if (e.isDir) {
                options.push({
                    label: `📁 ${pretty}`.slice(0, 100),
                    value: `d:${e.name}`.slice(0, 100),
                    description: 'Folder — wejdź',
                });
            } else {
                const rel = session.browsePath ? `${session.browsePath}/${e.name}` : e.name;
                const checked = session.selected.has(rel);
                options.push({
                    label: `${checked ? '✅' : '⬜'} ${pretty}`.slice(0, 100),
                    value: `f:${e.name}`.slice(0, 100),
                    description: `${this.fmtSize(e.size)}${checked ? ' · zaznaczony' : ''}`.slice(0, 100),
                });
            }
        }

        const comps = [];
        if (options.length > 0) {
            comps.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('rb_browse_select')
                    .setPlaceholder('📁 Otwórz folder / 📄 zaznacz plik').addOptions(options)
            ));
        }
        comps.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('rb_nav_up').setLabel('Wyżej').setStyle(ButtonStyle.Secondary).setEmoji('⬆️').setDisabled(!session.browsePath),
            new ButtonBuilder().setCustomId('rb_nav_root').setLabel('Główny').setStyle(ButtonStyle.Secondary).setEmoji('🏠').setDisabled(!session.browsePath),
            new ButtonBuilder().setCustomId('rb_sel_folder').setLabel('Zaznacz folder').setStyle(ButtonStyle.Success).setEmoji('✅'),
            new ButtonBuilder().setCustomId('rb_unsel_folder').setLabel('Odznacz folder').setStyle(ButtonStyle.Secondary).setEmoji('⬜')
        ));
        if (pages > 1) {
            comps.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('rb_page_prev').setLabel('Poprzednia').setStyle(ButtonStyle.Secondary).setEmoji('◀️').setDisabled(session.page === 0),
                new ButtonBuilder().setCustomId('rb_page_next').setLabel('Następna').setStyle(ButtonStyle.Secondary).setEmoji('▶️').setDisabled(session.page >= pages - 1)
            ));
        }
        comps.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('rb_browse_done').setLabel(`Dalej (${session.selected.size})`).setStyle(ButtonStyle.Primary).setEmoji('➡️').setDisabled(session.selected.size === 0),
            new ButtonBuilder().setCustomId('rb_back_mode').setLabel('Wstecz').setStyle(ButtonStyle.Secondary).setEmoji('◀️'),
            new ButtonBuilder().setCustomId('rb_cancel').setLabel('Anuluj').setStyle(ButtonStyle.Danger).setEmoji('❌')
        ));

        return { embeds: [embed], components: comps, content: '' };
    }

    async renderConfirmFiles(interaction, session) {
        const client = interaction.client;
        session.applyType = 'files';
        const sel = [...session.selected];
        const shown = [];
        for (const rel of sel.slice(0, 15)) {
            const segs = rel.split('/');
            const parent = segs[segs.length - 2];
            const hint = parent === 'guilds' ? 'guild' : parent === 'wyniki' ? 'user' : 'any';
            const pretty = await this.prettyName(client, session, segs[segs.length - 1], hint);
            const prefix = segs.slice(0, -1).join('/');
            shown.push(`• \`${prefix ? prefix + '/' : ''}\`${pretty}`);
        }
        if (sel.length > 15) shown.push(`…i ${sel.length - 15} więcej`);

        const embed = new EmbedBuilder()
            .setColor(0xFEE75C)
            .setTitle(`♻️ Potwierdź przywracanie — ${session.botName}`)
            .setDescription([
                `Zostanie przywróconych **${sel.length}** plików do bota **${session.botName}**:`,
                '',
                shown.join('\n'),
                '',
                `📦 Wersja: **${this.versionLabel(session)}**`,
                '💾 Przed nadpisaniem powstanie kopia bezpieczeństwa.',
            ].join('\n').slice(0, 4000));

        return {
            embeds: [embed],
            content: '',
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('rb_apply').setLabel('Przywróć').setStyle(ButtonStyle.Success).setEmoji('✅'),
                    new ButtonBuilder().setCustomId('rb_browse').setLabel('Wróć do wyboru').setStyle(ButtonStyle.Secondary).setEmoji('🗂️'),
                    new ButtonBuilder().setCustomId('rb_cancel').setLabel('Anuluj').setStyle(ButtonStyle.Danger).setEmoji('❌')
                ),
            ],
        };
    }

    renderConfirmAll(session) {
        session.applyType = 'all';
        let total = 0;
        const lines = [];
        for (const botName of session.bm.bots) {
            const dir = session.tempDirs[botName];
            if (!dir) { lines.push(`⚠️ ${botName} — brak backupu`); continue; }
            const n = this.walkFiles(dir, '').length;
            total += n;
            lines.push(`✅ ${botName} — ${n} plików`);
        }
        const embed = new EmbedBuilder()
            .setColor(0xFEE75C)
            .setTitle('🗂️ Potwierdź przywracanie CAŁEGO backupu')
            .setDescription([
                `Zostanie przywróconych **${total}** plików ze wszystkich botów:`,
                '',
                lines.join('\n'),
                '',
                `📦 Wersja: **${this.versionLabel(session)}**`,
                '💾 Przed nadpisaniem powstanie kopia bezpieczeństwa.',
                '⚠️ To nadpisze aktualne dane plikami z backupu!',
            ].join('\n').slice(0, 4000));

        return {
            embeds: [embed],
            content: '',
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('rb_apply').setLabel('Przywróć wszystko').setStyle(ButtonStyle.Success).setEmoji('✅'),
                    new ButtonBuilder().setCustomId('rb_back_mode').setLabel('Wstecz').setStyle(ButtonStyle.Secondary).setEmoji('◀️'),
                    new ButtonBuilder().setCustomId('rb_cancel').setLabel('Anuluj').setStyle(ButtonStyle.Danger).setEmoji('❌')
                ),
            ],
        };
    }

    renderBrokenSummary(session) {
        session.applyType = 'broken';
        const prepared = session.prepared;
        let msg = `🩹 **Tryb: tylko uszkodzone pliki (0B / brakujące)**\n`;
        msg += `📦 Wersja: **${session.date === 'latest' ? 'najnowsza' : session.date}** · pobrano ${prepared.totalBackupSizeMB} MB\n`;
        msg += `⚠️ Uszkodzonych plików: **${prepared.totalEmpty}**\n\n`;

        for (const botData of prepared.bots) {
            msg += `**${botData.botName}**\n`;
            if (botData.error) {
                msg += `  ⚠️ ${botData.error}\n`;
            } else {
                botData.recoverableFiles.forEach(f => { msg += `  ✅ \`${f.relativePath}\`\n`; });
                botData.unrecoverableFiles.forEach(f => { msg += `  ❌ \`${f.relativePath}\` — brak w backupie lub też 0B\n`; });
            }
        }
        if (msg.length > 1850) msg = msg.substring(0, 1820) + '\n…_(lista skrócona)_';
        msg += '\n\nPrzywrócić zaznaczone pliki?';

        return {
            content: msg,
            embeds: [],
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('rb_apply').setLabel('Przywróć').setStyle(ButtonStyle.Success).setEmoji('✅'),
                    new ButtonBuilder().setCustomId('rb_back_mode').setLabel('Wstecz').setStyle(ButtonStyle.Secondary).setEmoji('◀️'),
                    new ButtonBuilder().setCustomId('rb_cancel').setLabel('Anuluj').setStyle(ButtonStyle.Danger).setEmoji('❌')
                ),
            ],
        };
    }

    // ===================== Po wyborze czasu → pobieranie =====================

    async afterTimeChosen(interaction, session) {
        await session.bm.initializeDrive();

        if (session.mode === 'bot') {
            const dir = await this.ensureBotDownloaded(session, session.botName);
            if (!dir) {
                await interaction.editReply({ content: `❌ Nie znaleziono backupu **${session.botName}** (${session.date === 'latest' ? 'najnowszy' : session.date}) na Google Drive.`, embeds: [], components: [] });
                return;
            }
            await interaction.editReply(this.renderBotAction(session));
            return;
        }

        if (session.mode === 'all') {
            let any = false;
            for (const botName of session.bm.bots) {
                const dir = await this.ensureBotDownloaded(session, botName);
                if (dir) any = true;
            }
            if (!any) {
                await interaction.editReply({ content: '❌ Nie znaleziono żadnych backupów dla wybranej wersji.', embeds: [], components: [] });
                return;
            }
            await interaction.editReply(this.renderConfirmAll(session));
            return;
        }

        if (session.mode === 'broken') {
            const dateStr = session.date === 'latest' ? null : session.date;
            session.prepared = await session.bm.prepareRestore(dateStr);
            if (session.prepared.totalEmpty === 0) {
                this.cleanupSession(session.userId);
                await interaction.editReply({ content: '✅ **Brak uszkodzonych plików (0B)** — wszystkie dane są poprawne.', embeds: [], components: [] });
                return;
            }
            await interaction.editReply(this.renderBrokenSummary(session));
            return;
        }
    }

    // ===================== Wykonanie przywracania =====================

    async executeApply(interaction, session) {
        await interaction.deferUpdate();
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const safetyRoot = path.join(session.bm.botsFolder, '_restore_safety', ts);
        const restored = [];
        const failed = [];

        try {
            if (session.applyType === 'broken') {
                const r = await session.bm.executeRestore(session.prepared);
                r.restored.forEach(x => restored.push(x));
                r.failed.forEach(x => failed.push(x));
                try { session.bm.cleanupRestore(session.prepared); } catch {}
                session.prepared = null;
            } else if (session.applyType === 'all') {
                for (const botName of session.bm.bots) {
                    const dir = session.tempDirs[botName];
                    if (!dir) continue;
                    const files = this.walkFiles(dir, '');
                    const r = session.bm.restoreFilesFromTemp(botName, dir, files, safetyRoot);
                    r.restored.forEach(f => restored.push({ bot: botName, file: f }));
                    r.failed.forEach(f => failed.push({ bot: botName, file: f.file, reason: f.reason }));
                }
            } else { // files
                const botName = session.botName;
                const dir = session.tempDirs[botName];
                const r = session.bm.restoreFilesFromTemp(botName, dir, [...session.selected], safetyRoot);
                r.restored.forEach(f => restored.push({ bot: botName, file: f }));
                r.failed.forEach(f => failed.push({ bot: botName, file: f.file, reason: f.reason }));
            }

            const bm = session.bm;
            this.cleanupSession(session.userId);

            let msg = `🔄 **Przywracanie zakończone**\n\n`;
            msg += `**${restored.length} przywrócono, ${failed.length} błędów**\n`;
            if (session.applyType !== 'broken') msg += `💾 Kopia bezpieczeństwa: \`_restore_safety/${ts}/\`\n`;
            msg += '\n';
            if (restored.length > 0) {
                msg += restored.slice(0, 25).map(r => `✅ \`${r.bot}/${r.file}\``).join('\n') + '\n';
                if (restored.length > 25) msg += `…i ${restored.length - 25} więcej\n`;
            }
            if (failed.length > 0) {
                msg += '\n' + failed.slice(0, 15).map(f => `❌ \`${f.bot}/${f.file}\` — ${f.reason}`).join('\n');
            }
            if (msg.length > 2000) msg = msg.substring(0, 1950) + '\n…(skrócono)';

            await interaction.editReply({ content: msg, embeds: [], components: [] });

            try { await bm.sendRestoreSummaryToWebhook(restored, failed); } catch {}
            await this.logService.logMessage('info',
                `${interaction.user.tag} użył /restore-backup (${session.applyType}): ${restored.length} przywrócono, ${failed.length} błędów`,
                interaction
            );
        } catch (error) {
            this.cleanupSession(session.userId);
            logger.error('❌ Błąd wykonania /restore-backup:', error);
            await interaction.editReply({ content: `❌ Błąd:\n\`\`\`${error.message}\`\`\``, embeds: [], components: [] });
        }
    }

    // ===================== Routery interakcji =====================

    async handleCommand(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            await interaction.reply({ content: '❌ Wymaga uprawnień Administratora.', flags: MessageFlags.Ephemeral });
            return;
        }
        const existing = this.sessions.get(interaction.user.id);
        if (existing) this.cleanupSession(interaction.user.id);

        const session = this.newSession(interaction.user.id);
        this.sessions.set(interaction.user.id, session);
        await interaction.reply({ ...this.renderMode(), flags: MessageFlags.Ephemeral });
    }

    async sessionExpired(interaction) {
        await interaction.reply({
            content: '❌ Sesja wygasła (15 min). Uruchom `/restore-backup` ponownie.',
            flags: MessageFlags.Ephemeral,
        });
    }

    async handleButton(interaction) {
        const id = interaction.customId;
        const session = this.getSession(interaction);

        if (id === 'rb_cancel') {
            if (session) this.cleanupSession(interaction.user.id);
            await interaction.update({ content: '❌ **Anulowano.** Pliki tymczasowe usunięte.', embeds: [], components: [] });
            return;
        }
        if (!session) return this.sessionExpired(interaction);

        switch (id) {
            case 'rb_back_mode':
                this.resetToMode(session);
                await interaction.update(this.renderMode());
                return;
            case 'rb_mode_all':
                session.mode = 'all';
                await interaction.update(this.renderTime(session));
                return;
            case 'rb_mode_bot':
                session.mode = 'bot';
                await interaction.update(this.renderBotSelect(session));
                return;
            case 'rb_mode_broken':
                session.mode = 'broken';
                await interaction.update(this.renderTime(session));
                return;
            case 'rb_time_latest':
                session.date = 'latest';
                await interaction.deferUpdate();
                await this.afterTimeChosen(interaction, session);
                return;
            case 'rb_time_date':
                await interaction.showModal(this.buildDateModal());
                return;
            case 'rb_time_list': {
                await interaction.deferUpdate();
                await session.bm.initializeDrive();
                session.backupList = await session.bm.listAvailableBackups(session.botName, 25);
                if (!session.backupList.length) {
                    await interaction.editReply({ content: `❌ Brak dostępnych backupów dla **${session.botName}** na Google Drive.`, embeds: [], components: [] });
                    return;
                }
                await interaction.editReply(this.renderBackupList(session));
                return;
            }
            case 'rb_bot_all': {
                const dir = session.tempDirs[session.botName];
                session.selected = new Set(this.walkFiles(dir, ''));
                await interaction.deferUpdate();
                await interaction.editReply(await this.renderConfirmFiles(interaction, session));
                return;
            }
            case 'rb_browse':
                session.browsePath = '';
                session.page = 0;
                await interaction.deferUpdate();
                await interaction.editReply(await this.renderBrowse(interaction, session));
                return;
            case 'rb_nav_up': {
                const segs = session.browsePath.split('/').filter(Boolean);
                segs.pop();
                session.browsePath = segs.join('/');
                session.page = 0;
                await interaction.deferUpdate();
                await interaction.editReply(await this.renderBrowse(interaction, session));
                return;
            }
            case 'rb_nav_root':
                session.browsePath = '';
                session.page = 0;
                await interaction.deferUpdate();
                await interaction.editReply(await this.renderBrowse(interaction, session));
                return;
            case 'rb_page_prev':
                session.page = Math.max(0, session.page - 1);
                await interaction.deferUpdate();
                await interaction.editReply(await this.renderBrowse(interaction, session));
                return;
            case 'rb_page_next':
                session.page = session.page + 1;
                await interaction.deferUpdate();
                await interaction.editReply(await this.renderBrowse(interaction, session));
                return;
            case 'rb_sel_folder': {
                const dir = session.tempDirs[session.botName];
                for (const rel of this.walkFiles(dir, session.browsePath)) session.selected.add(rel);
                await interaction.deferUpdate();
                await interaction.editReply(await this.renderBrowse(interaction, session));
                return;
            }
            case 'rb_unsel_folder': {
                const dir = session.tempDirs[session.botName];
                for (const rel of this.walkFiles(dir, session.browsePath)) session.selected.delete(rel);
                await interaction.deferUpdate();
                await interaction.editReply(await this.renderBrowse(interaction, session));
                return;
            }
            case 'rb_browse_done':
                await interaction.deferUpdate();
                await interaction.editReply(await this.renderConfirmFiles(interaction, session));
                return;
            case 'rb_apply':
                await this.executeApply(interaction, session);
                return;
            default:
                return;
        }
    }

    async handleSelect(interaction) {
        const session = this.getSession(interaction);
        if (!session) return this.sessionExpired(interaction);

        if (interaction.customId === 'rb_bot_select') {
            session.botName = interaction.values[0];
            await interaction.update(this.renderTime(session));
            return;
        }

        if (interaction.customId === 'rb_backup_select') {
            session.pickedFileId = interaction.values[0];
            const picked = session.backupList.find(f => f.id === session.pickedFileId);
            session.pickedFileName = picked?.name || null;
            session.date = picked ? new Date(picked.createdTime).toISOString().slice(0, 10) : 'wybrany';
            await interaction.deferUpdate();
            const dir = await this.ensureBotDownloaded(session, session.botName);
            if (!dir) {
                await interaction.editReply({ content: `❌ Nie udało się pobrać wybranego backupu **${session.botName}**.`, embeds: [], components: [] });
                return;
            }
            await interaction.editReply(this.renderBotAction(session));
            return;
        }

        if (interaction.customId === 'rb_browse_select') {
            const val = interaction.values[0];
            const name = val.slice(2);
            if (val.startsWith('d:')) {
                session.browsePath = session.browsePath ? `${session.browsePath}/${name}` : name;
                session.page = 0;
            } else if (val.startsWith('f:')) {
                const rel = session.browsePath ? `${session.browsePath}/${name}` : name;
                if (session.selected.has(rel)) session.selected.delete(rel);
                else session.selected.add(rel);
            }
            await interaction.deferUpdate();
            await interaction.editReply(await this.renderBrowse(interaction, session));
            return;
        }
    }

    buildDateModal() {
        return new ModalBuilder()
            .setCustomId('rb_date_modal')
            .setTitle('Backup z konkretnego dnia')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('rb_date')
                        .setLabel('Data (RRRR-MM-DD)')
                        .setPlaceholder('np. 2026-06-14')
                        .setStyle(TextInputStyle.Short)
                        .setMinLength(10)
                        .setMaxLength(10)
                        .setRequired(true)
                )
            );
    }

    async handleModal(interaction) {
        if (interaction.customId !== 'rb_date_modal') return;
        const session = this.getSession(interaction);
        if (!session) return this.sessionExpired(interaction);

        const date = interaction.fields.getTextInputValue('rb_date').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            await interaction.reply({ content: '❌ Nieprawidłowy format daty. Użyj `RRRR-MM-DD`, np. `2026-06-14`.', flags: MessageFlags.Ephemeral });
            return;
        }
        session.date = date;
        await interaction.deferUpdate();
        await this.afterTimeChosen(interaction, session);
    }
}

module.exports = RestoreBackupHandler;
