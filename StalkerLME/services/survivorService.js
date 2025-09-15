/**
 * Survivor.io Build Decoder Service for Stalker LME Bot
 * Dekoduje kody buildów z sio-tools.vercel.app
 */

const { createBotLogger } = require('../../utils/consoleLogger');

class SurvivorService {
    constructor(config) {
        this.config = config;
        this.logger = createBotLogger('StalkerLME');
        this.equipmentDatabase = this.initializeEquipmentDB();
    }

    /**
     * Inicjalizuje bazę danych ekwipunku Survivor.io
     */
    initializeEquipmentDB() {
        return {
            weapons: [
                'Twin Lance', 'Void Lightning', 'Plasma Cannon', 'Frost Sword',
                'Energy Blade', 'Chaos Rifle', 'Lightning Gun', 'Ice Spear',
                'Fire Sword', 'Thunder Spear', 'Wind Blade', 'Earth Hammer',
                'Shadow Scythe', 'Light Saber', 'Dark Bow', 'Crystal Staff'
            ],
            armor: [
                'Evervoid Armor', 'Quantum Suit', 'Crystal Plate', 'Shadow Cloak',
                'Energy Shield', 'Frost Armor', 'Battle Gear', 'Void Plate',
                'Thunder Armor', 'Fire Cloak', 'Wind Robe', 'Earth Shield'
            ],
            belts: [
                'Stardust Sash', 'Energy Belt', 'Crystal Sash', 'Shadow Belt',
                'Quantum Band', 'Frost Belt', 'Power Sash', 'Void Belt',
                'Thunder Band', 'Fire Sash', 'Wind Belt', 'Earth Band'
            ],
            boots: [
                'Glacial Warboots', 'Void Steps', 'Energy Boots', 'Shadow Boots',
                'Quantum Shoes', 'Crystal Boots', 'Storm Boots', 'Frost Steps',
                'Thunder Boots', 'Fire Steps', 'Wind Shoes', 'Earth Boots'
            ],
            gloves: [
                'Moonscar Bracer', 'Void Gauntlets', 'Energy Gloves', 'Shadow Hands',
                'Crystal Gauntlets', 'Frost Gloves', 'Power Bracer', 'Quantum Gloves',
                'Thunder Gauntlets', 'Fire Gloves', 'Wind Hands', 'Earth Bracers'
            ],
            necklaces: [
                'Voidwaker Emblem', 'Energy Amulet', 'Crystal Pendant', 'Shadow Charm',
                'Quantum Necklace', 'Frost Amulet', 'Power Emblem', 'Storm Pendant',
                'Thunder Amulet', 'Fire Charm', 'Wind Pendant', 'Earth Emblem'
            ]
        };
    }

    /**
     * Próbuje zdekodować kod buildu za pomocą różnych algorytmów
     * @param {string} buildCode - Zakodowany kod buildu
     * @returns {Promise<Object>} - Zdekodowane dane buildu
     */
    async decodeBuildCode(buildCode) {
        try {
            this.logger.info(`🔍 Rozpoczynam dekodowanie kodu buildu z sio-tools (długość: ${buildCode.length})`);

            // Tylko LZMA dekodowanie (format sio-tools)
            const decoded = await this.tryLZMADecode(buildCode);
            if (decoded) {
                this.logger.info('✅ Dekodowanie udane za pomocą LZMA (sio-tools)');
                return decoded;
            }

            throw new Error('Nie udało się zdekodować kodu buildu. Upewnij się, że kod pochodzi z sio-tools.vercel.app');

        } catch (error) {
            this.logger.error(`❌ Błąd dekodowania kodu buildu: ${error.message}`);
            return null;
        }
    }

    /**
     * Próba dekodowania za pomocą LZMA (metoda używana przez sio-tools)
     */
    async tryLZMADecode(buildCode) {
        try {
            // Dynamiczne ładowanie LZMA jeśli dostępne
            let lzma;
            try {
                lzma = require('lzma');
            } catch (importError) {
                this.logger.error('❌ LZMA nie jest dostępne - wymagane do dekodowania kodów z sio-tools');
                return null;
            }

            const buffer = Buffer.from(buildCode, 'base64');
            const decompressed = lzma.decompress(buffer);

            if (Array.isArray(decompressed)) {
                const chars = decompressed.map(num => String.fromCharCode(num));
                const jsonString = chars.join('');

                // Usuń pierwszy nieprawidłowy znak i znajdź start JSON
                const jsonStart = jsonString.indexOf('{');
                if (jsonStart === -1) {
                    this.logger.error('❌ Nie znaleziono prawidłowych danych JSON w kodzie buildu');
                    return null;
                }

                const cleanJsonString = jsonString.substring(jsonStart);
                const parsed = JSON.parse(cleanJsonString);

                // Przekonwertuj format sio-tools na nasz format
                return this.convertSioToolsFormat(parsed);
            }

            this.logger.error('❌ Nieprawidłowy format danych po dekompresji LZMA');
            return null;
        } catch (error) {
            this.logger.error(`❌ LZMA dekodowanie nie powiodło się: ${error.message}`);
            return null;
        }
    }

    /**
     * Konwertuje format sio-tools na nasz standardowy format
     */
    convertSioToolsFormat(data) {
        try {
            if (!data.j || !Array.isArray(data.j)) {
                return null;
            }

            const equipment = data.j;

            // Mapowanie pozycji w tablicy na kategorie (stałe)
            const itemTypes = ['Weapon', 'Armor', 'Necklace', 'Belt', 'Gloves', 'Boots'];

            // Mapowanie typu (item.t) na nazwę przedmiotu (na podstawie rzeczywistych danych)
            const getItemName = (itemType) => {
                const typeNameMap = {
                    1: 'Twin Lance',
                    2: 'Evervoid Armor',
                    3: 'Eternal Suit',  // Potwierdzone
                    5: 'Voidwaker Emblem',
                    6: 'Stardust Sash',
                    7: 'Twisting Belt', // Potwierdzone (nie Voidwaker Treads!)
                    8: 'Moonscar Bracer',
                    9: 'Voidwaker Handguards',
                    10: 'Glacial Warboots',
                    11: 'Voidwaker Treads' // Potwierdzone (nie Judgment Necklace!)
                };
                return typeNameMap[itemType] || `Unknown Item (type ${itemType})`;
            };

            const buildData = {
                data: {},
                metadata: {
                    source: 'sio-tools',
                    version: data._V || 0,
                    timestamp: Date.now()
                }
            };

            equipment.forEach((item, index) => {
                if (item && typeof item === 'object') {
                    const itemType = itemTypes[index];
                    const itemName = getItemName(item.t);

                    if (itemType) {
                        buildData.data[itemType] = {
                            name: itemName,
                            e: item.w || 0,  // Evolution
                            v: item.u || 0,  // Vigor
                            c: item.v || 0,  // Count
                            base: item.x || 0 // Base
                        };
                    }
                }
            });

            return this.normalizeBuildData(buildData);
        } catch (error) {
            this.logger.error(`Błąd konwersji formatu sio-tools: ${error.message}`);
            return null;
        }
    }


    /**
     * Normalizuje dane buildu do standardowego formatu
     */
    normalizeBuildData(data) {
        // Sprawdź czy dane mają strukturę z 'data' właściwością
        const buildData = data.data || data;

        const normalized = {};
        const itemTypes = ['Weapon', 'Armor', 'Belt', 'Boots', 'Gloves', 'Necklace'];

        for (const type of itemTypes) {
            const item = buildData[type] || buildData[type.toLowerCase()];
            if (item) {
                normalized[type] = {
                    name: item.name || 'Unknown',
                    e: parseInt(item.e) || 0,
                    v: parseInt(item.v) || 0,
                    c: parseInt(item.c) || 0,
                    base: parseInt(item.base) || 0
                };
            }
        }

        return {
            ...normalized,
            metadata: {
                id: data.id,
                timestamp: data.timestamp,
                version: data.version || 0,
                fromState: data.fromState
            }
        };
    }

    /**
     * Normalizuje pojedynczy item
     */
    normalizeItem(item) {
        if (!item) return null;

        const evolution = item.e || 0;
        const vigor = item.v || 0;
        const count = item.c || 0;
        const base = item.base || 0;

        return {
            name: item.name || 'Unknown',
            evolution: evolution,
            vigor: vigor,
            count: count,
            base: base,
            totalPower: evolution + vigor + count + base
        };
    }

    /**
     * Oblicza statystyki buildu
     */
    calculateBuildStats(build) {
        const stats = {
            totalPower: 0,
            evolutionLevels: 0,
            vigorPoints: 0,
            countBonus: 0,
            baseStats: 0,
            efficiency: 0,
            itemCount: 0
        };

        const items = [build.weapon, build.armor, build.belt, build.boots, build.gloves, build.necklace];

        items.forEach(item => {
            if (item && item.name && item.name !== 'Unknown') {
                stats.itemCount++;
                stats.totalPower += item.totalPower || 0;
                stats.evolutionLevels += item.evolution || 0;
                stats.vigorPoints += item.vigor || 0;
                stats.countBonus += item.count || 0;
                stats.baseStats += item.base || 0;
            }
        });

        // Oblicz efektywność (evolution/totalPower * 100)
        stats.efficiency = stats.totalPower > 0 ?
            Math.round((stats.evolutionLevels / stats.totalPower) * 100) : 0;

        return stats;
    }

    /**
     * Tworzy embed z informacjami o buildzie
     */
    createBuildEmbeds(buildData, userTag, buildCode) {
        const { EmbedBuilder } = require('discord.js');

        this.logger.info('📊 Rozpoczynam tworzenie embedów...');

        // Oblicz statystyki buildu
        this.logger.info('🔢 Obliczanie statystyk...');
        let stats;
        try {
            stats = this.calculateBuildStatistics(buildData);
            this.logger.info(`📈 Stats obliczone: totalPower=${stats.totalPower}`);
        } catch (error) {
            this.logger.error(`❌ Błąd przy obliczaniu statystyk: ${error.message}`);
            throw error;
        }

        // Emojis dla różnych typów ekwipunku
        const itemEmojis = {
            weapon: '⚔️',
            armor: '🛡️',
            belt: '🔗',
            boots: '👢',
            gloves: '🥊',
            necklace: '📿'
        };

        // Kolory na podstawie efektywności
        let embedColor = '#888888'; // Szary dla niskiej efektywności
        if (stats.efficiency >= 80) embedColor = '#00ff00'; // Zielony dla wysokiej
        else if (stats.efficiency >= 60) embedColor = '#ffff00'; // Żółty dla średniej
        else if (stats.efficiency >= 40) embedColor = '#ffa500'; // Pomarańczowy dla niskiej

        try {
            this.logger.info('🏗️ Tworzenie pierwszego embeda...');

            // Ogranicz długość tytułu do 250 znaków (Discord limit 256)
            const title = `Analiza Ekwipunku gracza ${userTag}`;
            const safeTitle = title.length > 250 ? title.substring(0, 247) + '...' : title;
            this.logger.info(`📝 Tytuł embeda: "${safeTitle}" (${safeTitle.length} znaków)`);

            const embed = new EmbedBuilder()
                .setTitle(safeTitle)
                .setColor(embedColor)
                .setTimestamp();

            this.logger.info('✅ Pierwszy embed utworzony');
        } catch (error) {
            this.logger.error(`❌ Błąd przy tworzeniu pierwszego embeda: ${error.message}`);
            throw error;
        }

        try {
            this.logger.info('📋 Dodawanie pola Zasoby...');

            // Informacje główne - strona 1
            const page1Field = {
                name: 'Zasoby',
                value: `<:II_RC:1385139885924421653> Total RC: **${stats.totalPower || 0}**`,
                inline: false
            };

            embed.addFields(page1Field);
            this.logger.info('✅ Pole Zasoby dodane');
        } catch (error) {
            this.logger.error(`❌ Błąd przy dodawaniu pola Zasoby: ${error.message}`);
            throw error;
        }

        let description = '';

        // Statystyki będą dodane do pierwszej strony poniżej

        // Przygotowanie itemów do drugiej strony (w osobnych polach)
        const itemOrder = [
            'Twin Lance', 'Eternal Suit', 'Evervoid Armor', 'Voidwaker Emblem',
            'Judgment Necklace', 'Twisting Belt', 'Stardust Sash', 'Voidwaker Handguards',
            'Moonscar Bracer', 'Voidwaker Treads', 'Glacial Warboots'
        ];

        // Oblicz łączną sumę C dla Twin Lance
        const totalCount = this.calculateTotalCount(buildData);

        // Znajdź wszystkie itemy w buildzie - sprawdź obie struktury danych
        const itemTypes = ['Weapon', 'Armor', 'Belt', 'Boots', 'Gloves', 'Necklace'];
        const itemTypesLowerCase = ['weapon', 'armor', 'belt', 'boots', 'gloves', 'necklace'];
        const foundItems = {};

        // Zbierz wszystkie itemy ze zdekodowanych danych
        for (let i = 0; i < itemTypes.length; i++) {
            const itemType = itemTypes[i];
            const itemTypeLower = itemTypesLowerCase[i];
            const item = buildData[itemType] || buildData[itemTypeLower] ||
                        (buildData.data && (buildData.data[itemType] || buildData.data[itemTypeLower]));

            if (item && item.name && item.name !== 'Unknown') {
                foundItems[item.name] = item;
            }
        }

        // Pierwsza strona - tylko Total RC
        const page1 = new EmbedBuilder()
            .setTitle('🎮 Survivor.io Build Analysis')
            .setColor(embedColor)
            .setTimestamp()
            .setDescription(description)
            .setFooter({ text: `📝 Strona 1/2` });

        // Druga strona - każdy item ekwipunku w osobnym polu
        const page2 = new EmbedBuilder()
            .setTitle(safeTitle)
            .setColor(embedColor)
            .setTimestamp();

        // Dodaj pole z fragmentami jako pierwsze po prawej stronie
        page2.addFields({
            name: 'Zużyte materiały',
            value: `**<:JJ_FragmentEternal:1416896248837046404> Eternal:** ${stats.totalEternalFragments || 0}\n**<:JJ_FragmentVoid:1416896254431985764> Void:** ${stats.totalVoidFragments || 0}\n**<:JJ_FragmentChaos:1416896259561754796> Chaos:** ${stats.totalChaosFragments || 0}\n**<:JJ_FragmentBaseMaterial:1416896262938034289> Base:** ${stats.totalBaseFragments || 0}`,
            inline: true // Po prawej stronie
        });

        // Zbierz wszystkie itemy w osobnych polach
        const equipmentFields = [];

        for (const itemName of itemOrder) {
            const item = foundItems[itemName];
            if (item) {
                const emoji = this.getItemEmojiByName(item.name, totalCount);
                const e = item.e || item.evolution || 0;
                const v = item.v || item.vigor || 0;
                const c = item.c || item.count || 0;
                const base = item.base || 0;

                // Sprawdź czy pokazać E/V/C czy B
                let detailText = '';
                let costText = '';

                if (this.shouldShowEVCh(item.name)) {
                    // Pokaż tylko RC w pierwszej linii dla itemów E/V/C
                    detailText = '';

                    // Oblicz koszt zasobów tylko dla przedmiotów E/V/C
                    const resourceCost = this.calculateItemResourceCost(e, v, c, base, item.name);
                    costText = resourceCost > 0 ? ` • <:II_RC:1385139885924421653> **${resourceCost}**` : '';

                    // Dodaj linie ze gwiazdkami dla każdego typu zasobów
                    let starLines = '';
                    if (e > 0) {
                        const starCount = Math.min(e, 10);
                        const stars = '☆'.repeat(starCount);
                        starLines += `\n<:M_IconEternal:1417224046235619358> • ${stars}`;
                    }
                    if (v > 0) {
                        const starCount = Math.min(v, 10);
                        const stars = '☆'.repeat(starCount);
                        starLines += `\n<:M_IconVoid:1417224049490268270> • ${stars}`;
                    }
                    if (c > 0) {
                        const starCount = Math.min(c, 10);
                        const stars = '★'.repeat(starCount);
                        starLines += `\n<:M_IconChaos:1417224053055426811> • ${stars}`;
                    }
                    costText += starLines;
                } else {
                    // Pokaż tylko RC w pierwszej linii dla itemów B (jeśli mają C)
                    detailText = '';

                    // Oblicz RC dla itemów B jeżeli mają C - tylko koszt C
                    if (c > 0) {
                        const cCost = this.calculateOldCCost(c);
                        costText = cCost > 0 ? ` • <:II_RC:1385139885924421653> **${cCost}**` : '';
                    } else {
                        costText = ''; // Brak C = brak kosztów RC
                    }

                    // Dodaj linie ze gwiazdkami dla itemów B
                    let starLines = '';
                    if (base > 0) {
                        const bIcon = this.getBItemIcon(item.name);
                        const starCount = Math.min(base, 10);
                        const stars = '☆'.repeat(starCount);
                        starLines += `\n${bIcon} • ${stars}`;
                    }
                    if (c > 0) {
                        const starCount = Math.min(c, 10);
                        const stars = '★'.repeat(starCount);
                        starLines += `\n<:M_IconChaos:1417224053055426811> • ${stars}`;
                    }
                    costText += starLines;
                }

                const fieldValue = `${emoji} **${item.name}**${detailText}${costText}`;

                // Sprawdź czy pole nie jest za długie (limit 1024 znaków na pole)
                if (fieldValue.length <= 1024) {
                    equipmentFields.push({
                        name: '⚔️',
                        value: fieldValue,
                        inline: false // Pola od góry do dołu
                    });
                } else {
                    // Jeśli za długie, obetnij
                    const truncated = fieldValue.substring(0, 1020) + '...';
                    equipmentFields.push({
                        name: '⚔️',
                        value: truncated,
                        inline: false
                    });
                }
            }
        }

        // Dodaj pola do embeda (maksymalnie 25 pól total, już mamy 1 pole "Zużyte materiały")
        if (equipmentFields.length > 0) {
            const maxFields = 24; // 25 total - 1 już dodane pole "Zużyte materiały"
            const fieldsToAdd = equipmentFields.slice(0, maxFields);
            page2.addFields(fieldsToAdd);

            if (equipmentFields.length > maxFields) {
                this.logger.warn(`Za dużo pól ekwipunku: ${equipmentFields.length}/${maxFields} - obcięto`);
            }
        }

        page2.setFooter({ text: `📝 Strona 2/2` });

        // Debug: sprawdź strukturę embedów przed zwróceniem
        try {
            this.logger.info('🔍 Sprawdzanie struktury embedów...');
            const page1JSON = page1.toJSON();
            const page2JSON = page2.toJSON();
            this.logger.info(`✅ Strona 1: ${JSON.stringify(page1JSON).length} znaków JSON`);
            this.logger.info(`✅ Strona 2: ${JSON.stringify(page2JSON).length} znaków JSON`);
            this.logger.info('🎉 Embeddy utworzone pomyślnie, zwracam tablicę');
        } catch (error) {
            this.logger.error(`❌ Błąd przy sprawdzaniu embedów: ${error.message}`);
            throw error;
        }

        return [page1, page2];
    }

    /**
     * Tworzy przyciski nawigacji dla paginacji
     */
    createNavigationButtons(currentPage = 0) {
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('zasoby_page')
                    .setLabel('Zasoby')
                    .setStyle(currentPage === 0 ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('ekwipunek_page')
                    .setLabel('Ekwipunek')
                    .setStyle(currentPage === 1 ? ButtonStyle.Primary : ButtonStyle.Secondary)
            );

        return row;
    }

    /**
     * Zwraca emoji na podstawie efektywności
     */
    getEfficiencyEmoji(efficiency) {
        if (efficiency >= 80) return '🔥🔥🔥';
        if (efficiency >= 60) return '🔥🔥';
        if (efficiency >= 40) return '🔥';
        return '❄️';
    }

    /**
     * Generuje rekomendacje na podstawie statystyk
     */
    getRecommendations(stats) {
        const recommendations = [];

        if (stats.efficiency < 30) {
            recommendations.push('🎯 Skup się na ewolucji przedmiotów zamiast vigor/count');
        } else if (stats.efficiency < 60) {
            recommendations.push('📈 Dobry balans, można poprawić stosunek ewolucji');
        } else {
            recommendations.push('🎉 Doskonały build! Wysoka efektywność ewolucji');
        }

        if (stats.itemCount < 6) {
            recommendations.push(`⚠️ Brakuje ${6 - stats.itemCount} przedmiotów w buildzie`);
        }

        if (stats.totalPower < 30) {
            recommendations.push('💪 Build wymaga większej mocy - ulepsz przedmioty');
        }

        return recommendations.length > 0 ? recommendations.join('\n') : null;
    }

    /**
     * Zwraca emoji dla typu przedmiotu
     */
    getItemEmoji(type) {
        const emojis = {
            'Weapon': '🗡️',
            'Armor': '🛡️',
            'Belt': '🔗',
            'Boots': '👢',
            'Gloves': '🧤',
            'Necklace': '📿'
        };
        return emojis[type] || '❓';
    }

    /**
     * Oblicza koszt zasobów dla danego poziomu E (Evolution/Eternal) lub V (Vigor/Void)
     */
    calculateEVCost(level) {
        // Każdy poziom E/V: 1=10+500Base, 2=20+500Base, 3=40+500Base, 4=60+500Base, 5=80+1000Base
        const eternalVoidCosts = [0, 10, 20, 40, 60, 80]; // Eternal/Void fragmenty
        const baseCosts = [0, 500, 500, 500, 500, 1000]; // Base fragmenty

        let totalEternalVoid = 0;
        let totalBase = 0;

        for (let i = 1; i <= level && i < eternalVoidCosts.length; i++) {
            totalEternalVoid += eternalVoidCosts[i];
            totalBase += baseCosts[i];
        }

        return { eternalVoid: totalEternalVoid, base: totalBase };
    }

    /**
     * Oblicza koszt zasobów dla danego poziomu C (Count/Chaos)
     */
    calculateCCost(level) {
        // Każdy poziom C: 1,2=20+500Base, 3,4=50+500Base, 5,6=100+500Base, 7,8=150+500Base, 9,10=200+1000Base
        const chaosCosts = [0, 20, 20, 50, 50, 100, 100, 150, 150, 200, 200]; // Chaos fragmenty
        const baseCosts = [0, 500, 500, 500, 500, 500, 500, 500, 500, 1000, 1000]; // Base fragmenty

        let totalChaos = 0;
        let totalBase = 0;

        for (let i = 1; i <= level && i < chaosCosts.length; i++) {
            totalChaos += chaosCosts[i];
            totalBase += baseCosts[i];
        }

        return { chaos: totalChaos, base: totalBase };
    }

    /**
     * Oblicza fragmenty dla itemów B na podstawie specjalnych wymagań
     */
    calculateBItemFragments(baseLevel, itemName) {
        const fragments = { eternal: 0, void: 0, chaos: 0, base: 0 };

        // Specjalne koszty dla itemów B
        const specialBItems = {
            'Eternal Suit': 'eternal',      // 5 Eternal + 100 Base per level
            'Voidwaker Emblem': 'void',     // 5 Void + 100 Base per level
            'Voidwaker Handguards': 'void', // 5 Void + 100 Base per level
            'Voidwaker Treads': 'void',     // 5 Void + 100 Base per level
            'Twisting Belt': 'chaos'        // 5 Chaos + 100 Base per level
        };

        const resourceType = specialBItems[itemName];
        if (!resourceType) {
            return fragments; // Brak specjalnych kosztów
        }

        // Koszty fragmentów per poziom B: [0, 5, 10, 20] dla poziomów [0, 1, 2, 3]
        const fragmentCosts = [0, 5, 10, 20]; // poziom 0, 1, 2, 3

        for (let i = 1; i <= baseLevel && i < fragmentCosts.length; i++) {
            fragments[resourceType] += fragmentCosts[i];
            fragments.base += 100; // Zawsze 100 Base per poziom
        }

        return fragments;
    }

    /**
     * Zwraca odpowiednią ikonę dla itemów B na podstawie typu
     */
    getBItemIcon(itemName) {
        const bItemIcons = {
            'Eternal Suit': '<:M_IconEternal:1417224046235619358>',
            'Voidwaker Emblem': '<:M_IconVoid:1417224049490268270>',
            'Voidwaker Handguards': '<:M_IconVoid:1417224049490268270>',
            'Voidwaker Treads': '<:M_IconVoid:1417224049490268270>',
            'Twisting Belt': '<:M_IconChaos:1417224053055426811>'
        };

        return bItemIcons[itemName] || ''; // Zwróć pustą string jeśli brak ikony
    }

    /**
     * Sprawdza czy przedmiot ma koszt zasobów
     */
    shouldCalculateResourceCost(itemName) {
        const noResourceCostItems = [
            // Wszystkie przedmioty teraz mają koszt zasobów
        ];
        return !noResourceCostItems.includes(itemName);
    }

    /**
     * Oblicza specjalne koszty zasobów dla określonych przedmiotów B
     */
    calculateSpecialItemResourceCost(base, itemName) {
        // Tylko Eternal Suit ma koszty zasobów przy B
        const specialItems = {
            'Eternal Suit': 'eternal'
        };

        const resourceType = specialItems[itemName];
        if (!resourceType || base === 0) {
            return 0;
        }

        // Pierwszy poziom B = 5 + 100, drugi = 10 + 200, trzeci = 20 + 300
        const costs = [0, 5, 10, 20]; // poziom 0, 1, 2, 3
        const baseCosts = [0, 100, 200, 300]; // base dla każdego poziomu

        let totalCost = 0;
        for (let i = 1; i <= base && i < costs.length; i++) {
            totalCost += costs[i] + baseCosts[i];
        }

        return totalCost;
    }

    /**
     * Oblicza łączny koszt zasobów dla przedmiotu (proste dodawanie - stary system)
     */
    calculateItemResourceCost(e, v, c, base, itemName) {
        // Standardowe przedmioty E/V/C
        if (!this.shouldCalculateResourceCost(itemName)) {
            return 0;
        }

        // Stary system - proste dodawanie poziomów
        const eCost = this.calculateOldEVCost(e || 0);
        const vCost = this.calculateOldEVCost(v || 0);
        const cCost = this.calculateOldCCost(c || 0);
        // B (Base) kosztuje 0 za każdy poziom dla wszystkich przedmiotów

        return eCost + vCost + cCost;
    }

    /**
     * Stary system obliczania kosztów E/V (dla wyświetlania przy itemach)
     */
    calculateOldEVCost(level) {
        const costs = [0, 1, 2, 3, 5, 8]; // Poziom 0 = 0, 1 = 1, 2 = 2, 3 = 3, 4 = 5, 5 = 8
        let totalCost = 0;
        for (let i = 1; i <= level && i < costs.length; i++) {
            totalCost += costs[i];
        }
        return totalCost;
    }

    /**
     * Stary system obliczania kosztów C (dla wyświetlania przy itemach)
     */
    calculateOldCCost(level) {
        const costs = [0, 1, 2, 3, 3, 4, 4, 6, 6, 8, 8]; // Poziom 0 = 0, 1 = 1, ..., 9 = 8, 10 = 8
        let totalCost = 0;
        for (let i = 1; i <= level && i < costs.length; i++) {
            totalCost += costs[i];
        }
        return totalCost;
    }

    /**
     * Sprawdza czy przedmiot ma E/V/C (True) czy B (False)
     */
    shouldShowEVCh(itemName) {
        const evChItems = [
            'Twin Lance', 'Evervoid Armor', 'Stardust Sash',
            'Moonscar Bracer', 'Glacial Warboots'
        ];
        return evChItems.includes(itemName);
    }

    /**
     * Oblicza łączną sumę C we wszystkich przedmiotach
     */
    calculateTotalCount(buildData) {
        let totalCount = 0;
        const itemTypes = ['Weapon', 'Armor', 'Belt', 'Boots', 'Gloves', 'Necklace'];
        const itemTypesLowerCase = ['weapon', 'armor', 'belt', 'boots', 'gloves', 'necklace'];

        // Sprawdź obie struktury
        for (const type of itemTypes) {
            const item = buildData[type];
            if (item) {
                totalCount += item.c || item.count || 0;
            }
        }

        if (totalCount === 0) {
            for (const type of itemTypesLowerCase) {
                const item = buildData[type];
                if (item) {
                    totalCount += item.c || item.count || 0;
                }
            }
        }

        return totalCount;
    }

    /**
     * Zwraca emoji dla Twin Lance w zależności od sumy C
     */
    getTwinLanceEmoji(totalCount) {
        if (totalCount >= 36) return '<:H_LanceV5:1412958463977328720>';
        if (totalCount >= 27) return '<:H_LanceV4:1402532664052813865>';
        if (totalCount >= 18) return '<:H_LanceV3:1402532623288369162>';
        if (totalCount >= 9) return '<:H_LanceV2:1402532579583983616>';
        return '<:H_LanceV1:1402532523720052787>';
    }

    /**
     * Zwraca emoji dla konkretnego przedmiotu
     */
    getItemEmojiByName(itemName, totalCount) {
        const itemEmojis = {
            'Twin Lance': this.getTwinLanceEmoji(totalCount),
            'Evervoid Armor': '<:H_SSArmor:1280422683233746995>',
            'Judgment Necklace': '<:H_SSNeck:1259958646712959132>',
            'Stardust Sash': '<:H_SSBelt:1402532705845121096>',
            'Moonscar Bracer': '<:H_SSGloves:1289551805868408882>',
            'Glacial Warboots': '<:H_SSBoots:1320333759152918539>',
            'Voidwaker Handguards': '<:I_VGloves:1209754539381751829>',
            'Voidwaker Emblem': '<:I_VNeck:1209754519689502720>',
            'Voidwaker Treads': '<:I_VBoots:1209754068885446716>',
            'Twisting Belt': '<:I_Twisting:1209754500923920426>',
            'Eternal Suit': '<:I_ESuit:1209754340114300931>'
        };
        return itemEmojis[itemName] || '❓';
    }

    /**
     * Oblicza statystyki buildu - nowe fragmenty do wyświetlania, stare koszty dla Total RC
     */
    calculateBuildStatistics(buildData) {
        let totalEvolutionLevels = 0;
        let totalVigorLevels = 0;
        let totalCountLevels = 0;
        let totalBaseLevels = 0;
        let totalResourceCost = 0; // Stary system dla Total RC
        let totalEvolutionCost = 0; // Stary system dla efficiency

        // Nowe fragmenty (dla wyświetlania z emojis)
        let totalEternalFragments = 0;
        let totalVoidFragments = 0;
        let totalChaosFragments = 0;
        let totalBaseFragments = 0;
        let itemCount = 0;

        // Sprawdź strukturę danych i obsłuż obie wersje
        const itemTypes = ['Weapon', 'Armor', 'Belt', 'Boots', 'Gloves', 'Necklace'];
        const itemTypesLowerCase = ['weapon', 'armor', 'belt', 'boots', 'gloves', 'necklace'];

        // Funkcja do przetwarzania przedmiotu
        const processItem = (item) => {
            if (item && item.name !== 'Unknown' && item.name) {
                const e = item.e || item.evolution || 0;
                const v = item.v || item.vigor || 0;
                const c = item.c || item.count || 0;
                const base = item.base || 0;

                // Poziomy (dla podstawowego wyświetlania)
                totalEvolutionLevels += e;
                totalVigorLevels += v;
                totalCountLevels += c;
                totalBaseLevels += base;

                // Stary system kosztów dla Total RC i efficiency
                if (this.shouldCalculateResourceCost(item.name)) {
                    if (this.shouldShowEVCh(item.name)) {
                        // Przedmioty E/V/C - licz wszystko
                        const eCost = this.calculateOldEVCost(e);
                        const vCost = this.calculateOldEVCost(v);
                        const cCost = this.calculateOldCCost(c);

                        totalEvolutionCost += eCost;
                        totalResourceCost += eCost + vCost + cCost;
                    } else {
                        // Przedmioty B - licz tylko C
                        const cCost = this.calculateOldCCost(c);
                        totalResourceCost += cCost;
                    }
                }

                // Nowy system fragmentów (dla wyświetlania z emojis)
                if (this.shouldCalculateResourceCost(item.name)) {
                    if (this.shouldShowEVCh(item.name)) {
                        // Przedmioty E/V/C - licz wszystkie fragmenty
                        const eFragments = this.calculateEVCost(e);
                        const vFragments = this.calculateEVCost(v);
                        const cFragments = this.calculateCCost(c);

                        totalEternalFragments += eFragments.eternalVoid;
                        totalVoidFragments += vFragments.eternalVoid;
                        totalChaosFragments += cFragments.chaos;
                        totalBaseFragments += eFragments.base + vFragments.base + cFragments.base;
                    } else {
                        // Przedmioty B - licz tylko fragmenty C i B
                        if (c > 0) {
                            const cFragments = this.calculateCCost(c);
                            totalChaosFragments += cFragments.chaos;
                            totalBaseFragments += cFragments.base;
                        }
                        // Dodaj fragmenty dla poziomów B (specjalne koszty)
                        if (base > 0) {
                            const bFragments = this.calculateBItemFragments(base, item.name);
                            totalEternalFragments += bFragments.eternal;
                            totalVoidFragments += bFragments.void;
                            totalChaosFragments += bFragments.chaos;
                            totalBaseFragments += bFragments.base;
                        }
                    }
                }

                itemCount++;
            }
        };

        // Obsłuż strukturę z wielkimi literami (nowa)
        for (const type of itemTypes) {
            const item = buildData[type];
            processItem(item);
        }

        // Jeśli nie znaleziono przedmiotów, spróbuj struktury z małymi literami (oryginalna)
        if (itemCount === 0) {
            for (const type of itemTypesLowerCase) {
                const item = buildData[type];
                processItem(item);
            }
        }

        const efficiency = totalResourceCost > 0 ? Math.round((totalEvolutionCost / totalResourceCost) * 100) : 0;

        return {
            // Poziomy (dla podstawowego wyświetlania)
            totalEvolution: totalEvolutionLevels,
            totalVigor: totalVigorLevels,
            totalCount: totalCountLevels,
            totalBase: totalBaseLevels,
            // Nowe fragmenty (dla wyświetlania z emojis)
            totalEternalFragments,
            totalVoidFragments,
            totalChaosFragments,
            totalBaseFragments,
            // Stary system (dla Total RC i efficiency)
            totalPower: totalResourceCost,
            totalEvolutionCost,
            efficiency,
            itemCount
        };
    }

    /**
     * Dekoduje kod buildu i zwraca ustrukturyzowaną odpowiedź
     * @param {string} buildCode - Kod buildu do zdekodowania
     * @returns {Object} - Obiekt z success/error i danymi
     */
    decodeBuild(buildCode) {
        try {
            // Walidacja kodu
            const validation = this.validateBuildCode(buildCode);
            if (!validation.valid) {
                return { success: false, error: validation.error };
            }

            // Dekodowanie (synchroniczne dla uproszczenia)
            const decoded = this.decodeBuildSync(buildCode);
            if (!decoded) {
                return { success: false, error: 'Nie udało się zdekodować kodu buildu' };
            }

            // Debug logging
            this.logger.info('🔍 Zdekodowane dane:', JSON.stringify(decoded, null, 2));

            return { success: true, data: decoded };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Synchroniczna wersja dekodowania (tylko LZMA)
     */
    decodeBuildSync(buildCode) {
        try {
            // Tylko LZMA (sio-tools format)
            const lzma = require('lzma');
            const buffer = Buffer.from(buildCode, 'base64');
            const decompressed = lzma.decompress(buffer);

            if (Array.isArray(decompressed)) {
                const chars = decompressed.map(num => String.fromCharCode(num));
                const jsonString = chars.join('');
                const jsonStart = jsonString.indexOf('{');

                if (jsonStart !== -1) {
                    const cleanJsonString = jsonString.substring(jsonStart);
                    const parsed = JSON.parse(cleanJsonString);
                    const converted = this.convertSioToolsFormat(parsed);
                    if (converted) {
                        return converted;
                    }
                }
            }

            return null;
        } catch (error) {
            return null;
        }
    }


    /**
     * Waliduje kod buildu
     */
    validateBuildCode(code) {
        if (!code || typeof code !== 'string') {
            return { valid: false, error: 'Kod buildu musi być tekstem' };
        }

        if (code.length < 50) {
            return { valid: false, error: 'Kod buildu jest za krótki' };
        }

        if (code.length > 2000) {
            return { valid: false, error: 'Kod buildu jest za długi' };
        }

        // Sprawdź czy zawiera dozwolone znaki (Base64 URL-safe)
        const validChars = /^[A-Za-z0-9_-]+$/;
        if (!validChars.test(code)) {
            return { valid: false, error: 'Kod buildu zawiera niedozwolone znaki' };
        }

        return { valid: true };
    }
}

module.exports = SurvivorService;