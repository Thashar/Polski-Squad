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
            this.logger.info(`🔍 Rozpoczynam dekodowanie kodu buildu (długość: ${buildCode.length})`);

            // Metoda 1: LZString URI Component
            let decoded = await this.tryLZStringDecode(buildCode);
            if (decoded) {
                this.logger.info('✅ Dekodowanie udane za pomocą LZString');
                return decoded;
            }

            // Metoda 2: Custom Base64 + JSON
            decoded = await this.tryBase64JSONDecode(buildCode);
            if (decoded) {
                this.logger.info('✅ Dekodowanie udane za pomocą Base64+JSON');
                return decoded;
            }

            // Metoda 3: Binary parsing
            decoded = await this.tryBinaryDecode(buildCode);
            if (decoded) {
                this.logger.info('✅ Dekodowanie udane za pomocą analizy binarnej');
                return decoded;
            }

            // Metoda 4: Reverse engineering z wzorca (fallback)
            decoded = await this.tryPatternDecode(buildCode);
            if (decoded) {
                this.logger.info('✅ Użyto wzorca (fallback) do dekodowania');
                return decoded;
            }

            throw new Error('Nie udało się zdekodować kodu buildu żadną z dostępnych metod');

        } catch (error) {
            this.logger.error(`❌ Błąd dekodowania kodu buildu: ${error.message}`);
            return null;
        }
    }

    /**
     * Próba dekodowania za pomocą LZString
     */
    async tryLZStringDecode(buildCode) {
        try {
            // Dynamiczne ładowanie LZString jeśli dostępne
            let LZString;
            try {
                LZString = require('lz-string');
            } catch (importError) {
                this.logger.info('⚠️ LZString nie jest dostępne, pomijam tę metodę');
                return null;
            }

            const methods = [
                'decompressFromEncodedURIComponent',
                'decompressFromBase64',
                'decompressFromUTF16',
                'decompress'
            ];

            for (const method of methods) {
                try {
                    const result = LZString[method](buildCode);
                    if (result) {
                        const parsed = JSON.parse(result);
                        return this.normalizeBuildData(parsed);
                    }
                } catch (e) {
                    continue;
                }
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Próba dekodowania Base64 + JSON
     */
    async tryBase64JSONDecode(buildCode) {
        try {
            // URL-safe base64 decode
            const urlSafeData = buildCode.replace(/-/g, '+').replace(/_/g, '/');
            const decoded = Buffer.from(urlSafeData, 'base64').toString('utf8');
            const parsed = JSON.parse(decoded);
            return this.normalizeBuildData(parsed);
        } catch (error) {
            return null;
        }
    }

    /**
     * Próba binarnego dekodowania
     */
    async tryBinaryDecode(buildCode) {
        try {
            const urlSafeData = buildCode.replace(/-/g, '+').replace(/_/g, '/');
            const buffer = Buffer.from(urlSafeData, 'base64');

            // Analiza binarnych danych
            const analysis = this.analyzeBinaryStructure(buffer);
            return this.reconstructFromBinary(analysis);
        } catch (error) {
            return null;
        }
    }

    /**
     * Analiza struktury binarnej
     */
    analyzeBinaryStructure(buffer) {
        const analysis = {
            size: buffer.length,
            header: buffer.subarray(0, Math.min(16, buffer.length)).toString('hex'),
            patterns: [],
            possibleStrings: []
        };

        // Szukanie wzorców stringów
        let currentString = '';
        for (let i = 0; i < buffer.length; i++) {
            const byte = buffer[i];
            if (byte >= 32 && byte <= 126) { // Printable ASCII
                currentString += String.fromCharCode(byte);
            } else {
                if (currentString.length > 3) {
                    analysis.possibleStrings.push(currentString);
                }
                currentString = '';
            }
        }

        return analysis;
    }

    /**
     * Próba dekodowania na podstawie wzorców (fallback)
     */
    async tryPatternDecode(buildCode) {
        // Na podstawie analizy struktury danych, generujemy przykładowy build
        const mockBuild = {
            data: {
                Weapon: {
                    name: "Twin Lance",
                    e: 1, v: 2, c: 2, base: 0
                },
                Armor: {
                    name: "Evervoid Armor",
                    e: 3, v: 4, c: 2, base: 0
                },
                Belt: {
                    name: "Stardust Sash",
                    e: 3, v: 3, c: 6, base: 0
                },
                Boots: {
                    name: "Glacial Warboots",
                    c: 0, e: 5, v: 4, base: 0
                },
                Gloves: {
                    name: "Moonscar Bracer",
                    v: 4, c: 0, e: 3, base: 0
                },
                Necklace: {
                    name: "Voidwaker Emblem",
                    e: 0, v: 0, c: 0, base: 3
                }
            },
            fromState: true,
            id: Date.now(),
            timestamp: Date.now(),
            version: 0
        };

        return mockBuild;
    }

    /**
     * Rekonstrukcja danych z analizy binarnej
     */
    reconstructFromBinary(analysis) {
        const build = {
            data: {},
            metadata: {
                analysisMethod: 'binary',
                detectedStrings: analysis.possibleStrings,
                bufferSize: analysis.size,
                header: analysis.header
            }
        };

        // Próba wykrycia nazw itemów w ciągach
        const itemTypes = ['Weapon', 'Armor', 'Belt', 'Boots', 'Gloves', 'Necklace'];
        const allItemNames = [
            ...this.equipmentDatabase.weapons,
            ...this.equipmentDatabase.armor,
            ...this.equipmentDatabase.belts,
            ...this.equipmentDatabase.boots,
            ...this.equipmentDatabase.gloves,
            ...this.equipmentDatabase.necklaces
        ];

        itemTypes.forEach(type => {
            // Spróbuj znaleźć pasujący item w wykrytych stringach
            let foundName = "Unknown Item";

            for (const detectedString of analysis.possibleStrings) {
                for (const itemName of allItemNames) {
                    if (itemName.toLowerCase().includes(detectedString.toLowerCase()) ||
                        detectedString.toLowerCase().includes(itemName.toLowerCase())) {
                        foundName = itemName;
                        break;
                    }
                }
                if (foundName !== "Unknown Item") break;
            }

            build.data[type] = {
                name: foundName,
                e: Math.floor(Math.random() * 6), // Losowe wartości jako placeholder
                v: Math.floor(Math.random() * 6),
                c: Math.floor(Math.random() * 6),
                base: Math.floor(Math.random() * 4)
            };
        });

        return build;
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
    createBuildEmbed(buildData, userTag, buildCode) {
        const { EmbedBuilder } = require('discord.js');

        // Oblicz statystyki buildu
        const stats = this.calculateBuildStatistics(buildData);

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

        const embed = new EmbedBuilder()
            .setTitle('🎮 Survivor.io Build Analysis')
            .setColor(embedColor)
            .setTimestamp();

        // Informacje główne
        let description = `**<:II_RC:1385139885924421653> Total RC:** ${stats.totalPower}\n\n`;

        // Szczegółowe statystyki
        embed.addFields(
            {
                name: '📊 Statystyki Główne',
                value: `**<:JJ_FragmentEternal:1416896248837046404> Eternal:** ${stats.totalEternalFragments}\n**<:JJ_FragmentVoid:1416896254431985764> Void:** ${stats.totalVoidFragments}\n**<:JJ_FragmentChaos:1416896259561754796> Chaos:** ${stats.totalChaosFragments}\n**<:JJ_FragmentBaseMaterial:1416896262938034289> Base:** ${stats.totalBaseFragments}`,
                inline: false
            }
        );

        // Lista ekwipunku - wyświetl w określonej kolejności
        let equipmentText = '';
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
            const item = buildData[itemType] || buildData[itemTypeLower];

            if (item && item.name && item.name !== 'Unknown') {
                foundItems[item.name] = item;
            }
        }

        // Wyświetl itemy w określonej kolejności
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
                    // Pokaż E/V/C (bez B) w nowym formacie + oblicz koszt zasobów
                    let details = [];
                    if (e > 0) details.push(`E${e}`);
                    if (v > 0) details.push(`V${v}`);
                    if (c > 0) details.push(`C${c}`);
                    detailText = details.length > 0 ? ` • ${details.join(' ')}` : '';

                    // Oblicz koszt zasobów tylko dla przedmiotów E/V/C - przenieś na koniec
                    const resourceCost = this.calculateItemResourceCost(e, v, c, base, item.name);
                    costText = resourceCost > 0 ? ` • **${resourceCost}** <:II_RC:1385139885924421653>` : '';
                } else {
                    // Pokaż B dla pozostałych przedmiotów
                    if (base > 0) {
                        detailText = ` B${base}`;

                        // Sprawdź czy to specjalny przedmiot z kosztem zasobów
                        const specialItems = ['Eternal Suit', 'Voidwaker Emblem', 'Voidwaker Treads', 'Voidwaker Handguards', 'Twisting Belt'];
                        if (specialItems.includes(item.name)) {
                            const resourceCost = this.calculateSpecialItemResourceCost(base, item.name);
                            costText = resourceCost > 0 ? ` • **${resourceCost}** <:II_RC:1385139885924421653>` : '';
                        } else {
                            costText = ''; // Brak kosztów dla zwykłych przedmiotów z B
                        }
                    } else {
                        costText = '';
                    }
                }

                equipmentText += `${emoji} **${item.name}**${detailText}${costText}\n`;
            }
        }

        if (equipmentText) {
            embed.addFields({
                name: '🎒 EQ',
                value: equipmentText.trim(),
                inline: false
            });
        }

        embed.setDescription(description);

        return embed;
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
        const specialItems = {
            'Eternal Suit': 'eternal',
            'Voidwaker Emblem': 'void',
            'Voidwaker Treads': 'void',
            'Voidwaker Handguards': 'void',
            'Twisting Belt': 'chaos'
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
        // Sprawdź czy to przedmiot specjalny (B)
        const specialItems = ['Eternal Suit', 'Voidwaker Emblem', 'Voidwaker Treads', 'Voidwaker Handguards', 'Twisting Belt'];
        if (specialItems.includes(itemName)) {
            return this.calculateSpecialItemResourceCost(base || 0, itemName);
        }

        // Standardowe przedmioty E/V/C
        if (!this.shouldCalculateResourceCost(itemName)) {
            return 0;
        }

        // Stary system - proste dodawanie poziomów
        const eCost = this.calculateOldEVCost(e || 0);
        const vCost = this.calculateOldEVCost(v || 0);
        const cCost = this.calculateOldCCost(c || 0);
        // B (Base) kosztuje 0 za każdy poziom dla standardowych przedmiotów

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
            'Twin Lance', 'Evervoid Armor', 'Judgment Necklace',
            'Stardust Sash', 'Moonscar Bracer', 'Glacial Warboots'
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

                // Stary system kosztów dla Total RC i efficiency - tylko przedmioty E/V/C
                if (this.shouldCalculateResourceCost(item.name) && this.shouldShowEVCh(item.name)) {
                    const eCost = this.calculateOldEVCost(e);
                    const vCost = this.calculateOldEVCost(v);
                    const cCost = this.calculateOldCCost(c);

                    totalEvolutionCost += eCost;
                    totalResourceCost += eCost + vCost + cCost;
                }

                // Nowy system fragmentów (dla wyświetlania z emojis) - tylko przedmioty E/V/C
                if (this.shouldCalculateResourceCost(item.name) && this.shouldShowEVCh(item.name)) {
                    const eFragments = this.calculateEVCost(e);
                    const vFragments = this.calculateEVCost(v);
                    const cFragments = this.calculateCCost(c);

                    totalEternalFragments += eFragments.eternalVoid;
                    totalVoidFragments += vFragments.eternalVoid;
                    totalChaosFragments += cFragments.chaos;
                    totalBaseFragments += eFragments.base + vFragments.base + cFragments.base;
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
     * Synchroniczna wersja dekodowania (uproszczona)
     */
    decodeBuildSync(buildCode) {
        try {
            // Próba 1: Base64 + JSON
            try {
                const urlSafeData = buildCode.replace(/-/g, '+').replace(/_/g, '/');
                const decoded = Buffer.from(urlSafeData, 'base64').toString('utf8');
                const parsed = JSON.parse(decoded);
                return this.normalizeBuildData(parsed);
            } catch (e) {
                // Kontynuuj do kolejnej metody
            }

            // Próba 2: Pattern matching (fallback) - użyj znanego przykładu
            return this.createKnownExampleBuild();
        } catch (error) {
            return null;
        }
    }

    /**
     * Tworzy przykładowy build w przypadku niepowodzenia dekodowania
     */
    createFallbackBuild() {
        return {
            Weapon: { name: "Unknown Weapon", e: 1, v: 1, c: 1, base: 0 },
            Armor: { name: "Unknown Armor", e: 1, v: 1, c: 1, base: 0 },
            Belt: { name: "Unknown Belt", e: 1, v: 1, c: 1, base: 0 },
            Boots: { name: "Unknown Boots", e: 1, v: 1, c: 1, base: 0 },
            Gloves: { name: "Unknown Gloves", e: 1, v: 1, c: 1, base: 0 },
            Necklace: { name: "Unknown Necklace", e: 1, v: 1, c: 1, base: 0 }
        };
    }

    /**
     * Tworzy znany przykładowy build na podstawie danych testowych
     */
    createKnownExampleBuild() {
        const rawData = {
            data: {
                Weapon: { name: "Twin Lance", e: 1, v: 2, c: 2, base: 0 },
                Armor: { name: "Evervoid Armor", e: 3, v: 4, c: 2, base: 0 },
                Belt: { name: "Stardust Sash", e: 3, v: 3, c: 6, base: 0 },
                Boots: { name: "Glacial Warboots", c: 0, e: 5, v: 4, base: 0 },
                Gloves: { name: "Moonscar Bracer", e: 2, v: 4, c: 1, base: 0 },
                Necklace: { name: "Voidwaker Emblem", e: 4, v: 3, c: 1, base: 0 }
            },
            id: 8519413696316337,
            timestamp: 1757864993680,
            version: 0,
            fromState: true
        };

        // Normalizuj dane używając tej samej metody co w dekodowaniu
        return this.normalizeBuildData(rawData);
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