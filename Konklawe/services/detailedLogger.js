const { EmbedBuilder, WebhookClient } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Konklawe');

/**
 * Serwis do szczegółowego logowania akcji Gabriel/Lucyfer na dedykowany kanał Discord
 */
class DetailedLogger {
    constructor(client, config) {
        this.client = client;
        this.config = config;
        this.webhookUrl = process.env.KONKLAWE_DETAILED_LOG_WEBHOOK_URL;
        this.webhook = null;
    }

    /**
     * Inicjalizuje webhook logowania
     */
    async initialize() {
        try {
            if (!this.webhookUrl || this.webhookUrl === 'TUTAJ_WKLEJ_URL_WEBHOOKA_Z_KROKU_1') {
                logger.warn('⚠️ KONKLAWE_DETAILED_LOG_WEBHOOK_URL nie jest skonfigurowany - logowanie wyłączone');
                return;
            }

            this.webhook = new WebhookClient({ url: this.webhookUrl });
            logger.info(`📋 DetailedLogger zainicjalizowany - webhook połączony`);
        } catch (error) {
            logger.error(`❌ Błąd inicjalizacji DetailedLogger: ${error.message}`);
        }
    }

    /**
     * Wysyła szczegółowy log na kanał Discord przez webhook
     * @param {Object} data - Dane do zalogowania
     */
    async log(data) {
        if (!this.webhook) {
            logger.warn('⚠️ Webhook nie jest zainicjalizowany - pomijam logowanie');
            return;
        }

        try {
            const embed = new EmbedBuilder()
                .setTimestamp()
                .setFooter({ text: 'Konklawe Detailed Logger' });

            // Ustaw kolor według typu akcji
            const colors = {
                'curse': '#FF0000',          // Czerwony - klątwa
                'blessing': '#00FF00',       // Zielony - błogosławieństwo
                'reflection': '#FFA500',     // Pomarańczowy - odbicie
                'judgment': '#FFD700',       // Złoty - sąd boży
                'gabriel_strong': '#87CEEB', // Niebieski - silna klątwa Gabriela
                'virtue_check': '#9370DB',   // Fioletowy - virtue check
                'achievement': '#FFD700',    // Złoty - osiągnięcie
                'energy': '#00CED1',         // Cyjan - energia/mana
                'block': '#8B0000'           // Ciemnoczerwony - blokada
            };

            embed.setColor(colors[data.type] || '#FFFFFF');
            embed.setTitle(data.title);

            if (data.description) {
                embed.setDescription(data.description);
            }

            // Dodaj pola z danymi
            if (data.fields && data.fields.length > 0) {
                data.fields.forEach(field => {
                    embed.addFields({
                        name: field.name,
                        value: field.value,
                        inline: field.inline || false
                    });
                });
            }

            await this.webhook.send({
                embeds: [embed],
                username: 'Konklawe Logger',
                avatarURL: 'https://cdn.discordapp.com/emojis/1170066835690102834.png' // JP2roll emoji
            });
        } catch (error) {
            logger.error(`❌ Błąd wysyłania szczegółowego logu: ${error.message}`);
        }
    }

    /**
     * Loguje rzucenie klątwy
     */
    async logCurse(caster, target, curseType, level, cost, energyData, reflectionChance = null, roleType = null, userId = null, virtuttiService = null) {
        // Oblicz następny koszt w zależności od roli
        let nextCost;
        if (roleType === 'lucyfer' && virtuttiService && userId) {
            // Lucyfer - dynamiczny koszt (5-15) - pobierz aktualny koszt po sukcesie/failu
            nextCost = virtuttiService.getLucyferCurseCost(userId);
        } else {
            // Gabriel/Virtutti - progresywny koszt (10 + dailyCurses * 2)
            nextCost = 10 + (energyData.dailyCurses * 2);
        }
        
        const fields = [
            { name: '👤 Rzucający', value: `<@${caster.id}> (${caster.tag})`, inline: true },
            { name: '🎯 Cel', value: `<@${target.id}> (${target.tag})`, inline: true },
            { name: '💀 Typ klątwy', value: curseType, inline: true },
            { name: '⚡ Poziom', value: level === 'normal' ? '💀 Zwykła (96%)' : level === 'strong' ? '⚡ Silna (3%)' : '💥 Potężna (1%)', inline: true },
            { name: '💰 Koszt many', value: `${cost} many`, inline: true },
            { name: '🔋 Pozostała mana', value: `${energyData.energy}/${energyData.maxEnergy}`, inline: true },
            { name: '📊 Klątwy dzisiaj', value: `${energyData.dailyCurses}`, inline: true },
            { name: '💸 Następny koszt', value: `${nextCost} many`, inline: true }
        ];

        if (reflectionChance !== null) {
            fields.push({ name: '🔥 Szansa odbicia', value: `${reflectionChance}%`, inline: true });
        }

        await this.log({
            type: 'curse',
            title: '💀 KLĄTWA RZUCONA',
            fields
        });
    }

    /**
     * Loguje błogosławieństwo
     */
    async logBlessing(caster, target, blessing, cost, energyData, curseRemoved = false) {
        const fields = [
            { name: '👤 Błogosławiący', value: `<@${caster.id}> (${caster.tag})`, inline: true },
            { name: '🎯 Cel', value: `<@${target.id}> (${target.tag})`, inline: true },
            { name: '✨ Błogosławieństwo', value: blessing, inline: false },
            { name: '💰 Koszt many', value: `${cost} many`, inline: true },
            { name: '🔋 Pozostała mana', value: `${energyData.energy}/${energyData.maxEnergy}`, inline: true }
        ];

        if (curseRemoved) {
            fields.push({ name: '🎉 Efekt specjalny', value: '✨ Klątwa została usunięta!', inline: false });
        }

        await this.log({
            type: 'blessing',
            title: '🙏 BŁOGOSŁAWIEŃSTWO',
            fields
        });
    }

    /**
     * Loguje odbicie klątwy Lucyfera
     */
    async logLucyferReflection(lucyfer, reflectionChance, randomRoll) {
        await this.log({
            type: 'reflection',
            title: '🔥 ODBICIE KLĄTWY LUCYFERA',
            description: `**Klątwa została odbita!**\n\nLucyfer dostał blokadę 1h + nick "Osłabiony"\nLicznik odbicia zresetowany do 0%`,
            fields: [
                { name: '👤 Lucyfer', value: `<@${lucyfer.id}> (${lucyfer.tag})`, inline: true },
                { name: '🎲 Rzut', value: `${randomRoll.toFixed(2)}%`, inline: true },
                { name: '🔥 Szansa odbicia', value: `${reflectionChance}%`, inline: true },
                { name: '⏰ Blokada', value: '1 godzina', inline: true },
                { name: '📛 Nick', value: 'Osłabiony [nick]', inline: true },
                { name: '🔄 Reset', value: 'Licznik → 0%', inline: true }
            ]
        });
    }

    /**
     * Loguje odbicie klątwy na Gabriela (33%)
     */
    async logGabrielReflection(lucyfer, gabriel) {
        await this.log({
            type: 'reflection',
            title: '☁️ GABRIEL ODBIŁ KLĄTWĘ',
            description: `**Gabriel okazał się odporny!**\n\nKlątwa Lucyfera została odbita na niego samego`,
            fields: [
                { name: '👤 Lucyfer', value: `<@${lucyfer.id}> (${lucyfer.tag})`, inline: true },
                { name: '☁️ Gabriel', value: `<@${gabriel.id}> (${gabriel.tag})`, inline: true },
                { name: '⚡ Mechanika', value: '33% odbicie na Gabriela', inline: true }
            ]
        });
    }

    /**
     * Loguje silną klątwę Gabriela na Lucyfera (1% przy blessing)
     */
    async logGabrielStrongCurse(gabriel, lucyfer, duration) {
        await this.log({
            type: 'gabriel_strong',
            title: '💥⚡ MEGA SILNA KLĄTWA GABRIELA',
            description: `**Gabriel nałożył MEGA SILNĄ KLĄTWĘ na Lucyfera!**\n\n1% szansa przy blessing została aktywowana`,
            fields: [
                { name: '☁️ Gabriel', value: `<@${gabriel.id}> (${gabriel.tag})`, inline: true },
                { name: '🔥 Lucyfer', value: `<@${lucyfer.id}> (${lucyfer.tag})`, inline: true },
                { name: '⏰ Czas trwania', value: '1 godzina', inline: true },
                { name: '🔄 Zmiana klątwy', value: 'Co 5 minut', inline: true },
                { name: '📊 Łącznie zmian', value: '12 zmian', inline: true }
            ]
        });
    }

    /**
     * Loguje sprawdzenie cnót
     */
    async logVirtueCheck(checker, target, virtues) {
        const virtuesText = virtues.map(v => `• **${v.name}:** ${v.percentage}%`).join('\n');

        await this.log({
            type: 'virtue_check',
            title: '🔍 SPRAWDZENIE CNÓT',
            fields: [
                { name: '👤 Sprawdzający', value: `<@${checker.id}> (${checker.tag})`, inline: true },
                { name: '🎯 Cel', value: `<@${target.id}> (${target.tag})`, inline: true },
                { name: '📊 Wyniki', value: virtuesText, inline: false }
            ]
        });
    }

    /**
     * Loguje osiągnięcie medalu Virtutti Papajlari
     */
    async logVirtuttiAchievement(user, points, medalCount) {
        const threshold = this.config.achievements?.virtuttiPapajlariThreshold || 10;
        await this.log({
            type: 'achievement',
            title: '🏆 VIRTUTTI PAPAJLARI',
            description: `**Nowy medal zdobyty!**\n\n<@${user.id}> osiągnął ${threshold} zwycięstw w Konklawe!`,
            fields: [
                { name: '👤 Użytkownik', value: `<@${user.id}> (${user.tag})`, inline: true },
                { name: '🎯 Punkty', value: `${points}`, inline: true },
                { name: '🏅 Medal #', value: `${medalCount}`, inline: true },
                { name: '⚡ Specjalne moce', value: 'Blessing, Virtue Check odblokowane!', inline: false }
            ]
        });
    }

    /**
     * Loguje sąd boży
     */
    async logJudgment(chooser, chosen, chooserRole, chosenRole) {
        await this.log({
            type: 'judgment',
            title: '⚖️ SĄD BOŻY',
            description: `**Dwie dusze zostały wybrane!**\n\nRównowaga między światłem a ciemnością została przywrócona`,
            fields: [
                { name: '👤 Wybierający', value: `<@${chooser.id}> (${chooser.tag})`, inline: true },
                { name: '🎭 Rola', value: chooserRole === 'Gabriel' ? '☁️ Gabriel' : '🔥 Lucyfer', inline: true },
                { name: '\u200B', value: '\u200B', inline: true },
                { name: '👤 Wybrany', value: `<@${chosen.id}> (${chosen.tag})`, inline: true },
                { name: '🎭 Rola', value: chosenRole === 'Gabriel' ? '☁️ Gabriel' : '🔥 Lucyfer', inline: true }
            ]
        });
    }

    /**
     * Loguje nieudaną klątwę (15% fail Gabriela)
     */
    async logCurseFail(caster, target, cost, refund, energyData) {
        await this.log({
            type: 'curse',
            title: '☁️ KLĄTWA NIE POWIODŁA SIĘ',
            description: `**Gabriel failnął klątwę!**\n\nZwrot 50% many`,
            fields: [
                { name: '👤 Gabriel', value: `<@${caster.id}> (${caster.tag})`, inline: true },
                { name: '🎯 Cel', value: `<@${target.id}> (${target.tag})`, inline: true },
                { name: '💰 Koszt', value: `${cost} many`, inline: true },
                { name: '💸 Zwrot', value: `${refund} many (50%)`, inline: true },
                { name: '🔋 Mana', value: `${energyData.energy}/${energyData.maxEnergy}`, inline: true }
            ]
        });
    }

    /**
     * Loguje regenerację many
     */
    async logEnergyRegeneration(userId, regenerated, current) {
        await this.log({
            type: 'energy',
            title: '🔋 REGENERACJA MANY',
            fields: [
                { name: '👤 Użytkownik', value: `<@${userId}>`, inline: true },
                { name: '⚡ Zregenerowano', value: `${regenerated} many`, inline: true },
                { name: '🔋 Obecna mana', value: `${current}/300`, inline: true }
            ]
        });
    }

    /**
     * Loguje blokadę Lucyfera
     */
    async logLucyferBlock(userId, remainingMinutes) {
        await this.log({
            type: 'block',
            title: '🚫 BLOKADA LUCYFERA',
            fields: [
                { name: '👤 Lucyfer', value: `<@${userId}>`, inline: true },
                { name: '⏰ Pozostały czas', value: `${remainingMinutes} minut`, inline: true },
                { name: '⚠️ Status', value: 'Nie może rzucać klątw', inline: true }
            ]
        });
    }
}

module.exports = DetailedLogger;
