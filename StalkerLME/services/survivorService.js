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
                    4: 'Judgment Necklace', // Potwierdzone
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

            // Dekodowanie collectibles z klucza "i"
            if (data.i && Array.isArray(data.i)) {
                buildData.collectibles = this.decodeCollectibles(data.i);
            }

            // Dekodowanie customSets z klucza "n"
            if (data.n && typeof data.n === 'object') {
                buildData.customSets = this.decodeCustomSets(data.n);
            }

            return this.normalizeBuildData(buildData);
        } catch (error) {
            this.logger.error(`Błąd konwersji formatu sio-tools: ${error.message}`);
            return null;
        }
    }

    /**
     * Dekoduje collectibles z tablicy danych
     */
    decodeCollectibles(collectiblesArray) {
        // Kolejność collectibles zgodna ze strukturą danych
        const collectibleNames = [
            'Human Genome Mapping', 'Book of Ancient Wisdom', 'Immortal Lucky Coin', 'Instellar Transition Matrix Design',
            'Angelic Tear Crystal', 'Unicorn\'s Horn', 'Otherworld Key', 'Starcore Diamond',
            'High-Lat Energy Cube', 'Void Bloom', 'Eye of True Vision', 'Life Hourglass',
            'Nano-Mimetic Mask', 'Dice of Destiny', 'Dimension Foil', 'Mental Sync Helm',
            'Atomic Mech', 'Time Essence Bottle', 'Dragon Tooth', 'Hyper Neuron',
            'Cyber Totem', 'Clone Mirror', 'Dreamscape Puzzle', 'Gene Splicer',
            'Memory Editor', 'Temporal Rewinder', 'Spatial Rewinder', 'Holodream Fluid',
            'Golden Cutlery', 'Old Medical Book', 'Savior\'s Memento', 'Safehouse Map',
            'Lucky Charm', 'Scientific Luminary\'s Journal', 'Super Circuit Board', 'Mystical Halo',
            'Tablet of Epics', 'Primordial War Drum', 'Flaming Plume', 'Astral Dewdrop',
            'Nuclear Battery', 'Plasma Sword', 'Golden Horn', 'Elemental Ring',
            'Anti-Gravity Device', 'Hydraulic Flipper', 'Superhuman Pill', 'Comms Conch',
            'Mini Dyson Sphere', 'Micro Artificial Sun', 'Klein Bottle', 'Antiparticle Gourd',
            'Wildfire Furnace', 'Infinity Score', 'Cosmic Compass', 'Wormhole Detector',
            'Shuttle Capsule', 'Neurochip', 'Star-Rail Passenger Card', 'Portable Mech Case'
        ];

        const collectibles = {
            data: {}
        };

        let nameIndex = 0; // Indeks w collectibleNames

        for (let i = 0; i < collectiblesArray.length && nameIndex < collectibleNames.length; i++) {
            const collectibleData = collectiblesArray[i];

            if (collectibleData && typeof collectibleData === 'object' && collectibleData.r !== undefined) {
                // Znaleźliśmy collectible z wartością r - przypisz go do kolejnej nazwy
                const collectibleName = collectibleNames[nameIndex];
                const stars = collectibleData.r;
                collectibles.data[collectibleName] = {
                    stars: stars
                };
                nameIndex++; // Przejdź do kolejnej nazwy
            }
            // null pomijamy ale nie zwiększamy nameIndex - szukamy dalej w array
        }

        return collectibles;
    }

    /**
     * Dekoduje custom sets z klucza "n"
     */
    decodeCustomSets(customSetsData) {
        // Mapowanie wartości na typy
        const valueToType = {
            0: 'None',
            1: 'Epic',
            2: 'Legend'
        };

        const customSets = {
            data: {}
        };

        // Przetwórz każdy set (0, 1, 2)
        for (const [setKey, setArray] of Object.entries(customSetsData)) {
            if (Array.isArray(setArray)) {
                customSets.data[setKey] = setArray.map(value => valueToType[value] || 'None');
            }
        }

        return customSets;
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

        const result = {
            ...normalized,
            metadata: {
                id: data.id,
                timestamp: data.timestamp,
                version: data.version || 0,
                fromState: data.fromState
            }
        };

        // Zachowaj collectibles jeśli istnieją
        if (data.collectibles) {
            result.collectibles = data.collectibles;
        }

        // Zachowaj customSets jeśli istnieją
        if (data.customSets) {
            result.customSets = data.customSets;
        }

        return result;
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

        // Ogranicz długość tytułu do 250 znaków (Discord limit 256)
        const title = `Analiza Ekwipunku gracza ${userTag}`;
        const safeTitle = title.length > 250 ? title.substring(0, 247) + '...' : title;

        // Przygotowanie itemów do pierwszej strony (w osobnych polach)
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

        // Strona 0 - Statystyki
        const page0 = new EmbedBuilder()
            .setTitle(safeTitle)
            .setColor(embedColor)
            .setTimestamp();

        // Zawartość Statystyki
        this.addStatisticsFields(page0, buildData);

        // Pierwsza strona (teraz page1) - każdy item ekwipunku w osobnym polu
        const page1 = new EmbedBuilder()
            .setTitle(safeTitle)
            .setColor(embedColor)
            .setTimestamp();

        // Nie ustawiaj description - może powodować błędy


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

                    // Oblicz RC dla itemów B jeżeli mają C - koszt C + bonus RC
                    if (c > 0) {
                        const cCost = this.calculateOldCCost(c);
                        const cBonus = this.calculateBItemCBonus(c);
                        const totalCost = cCost + cBonus;
                        costText = totalCost > 0 ? ` • <:II_RC:1385139885924421653> **${totalCost}**` : '';
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
                        name: '\u200B', // Niewidoczny znak
                        value: fieldValue,
                        inline: true // Pola obok siebie
                    });
                } else {
                    // Jeśli za długie, obetnij
                    const truncated = fieldValue.substring(0, 1020) + '...';
                    equipmentFields.push({
                        name: '\u200B', // Niewidoczny znak
                        value: truncated,
                        inline: true // Pola obok siebie
                    });
                }
            }
        }

        // Dodaj pola ekwipunku do embeda w układzie 2 kolumny
        if (equipmentFields.length > 0) {
            const maxFields = 22; // Zostaw miejsce na puste pola i "Zużyte materiały"
            const fieldsToAdd = equipmentFields.slice(0, maxFields);

            // Dodaj pola z pustymi polami co drugi rząd aby uzyskać 2 kolumny
            for (let i = 0; i < fieldsToAdd.length; i += 2) {
                // Dodaj pierwsze pole
                page1.addFields(fieldsToAdd[i]);

                // Dodaj drugie pole jeśli istnieje
                if (i + 1 < fieldsToAdd.length) {
                    page1.addFields(fieldsToAdd[i + 1]);
                }

                // Dodaj puste pole aby zepsuć trzecią kolumnę (tylko jeśli jest miejsce)
                if (i + 1 < fieldsToAdd.length && page1.data.fields.length < 24) {
                    page1.addFields({
                        name: '\u200B',
                        value: '\u200B',
                        inline: true
                    });
                }
            }

            if (equipmentFields.length > maxFields) {
                this.logger.warn(`Za dużo pól ekwipunku: ${equipmentFields.length}/${maxFields} - obcięto`);
            }
        }

        // Dodaj pola na końcu
        page1.addFields(
            {
                name: 'Zużyte materiały',
                value: `**<:JJ_FragmentEternal:1416896248837046404> Eternal:** ${stats.totalEternalFragments || 0}\n**<:JJ_FragmentVoid:1416896254431985764> Void:** ${stats.totalVoidFragments || 0}\n**<:JJ_FragmentChaos:1416896259561754796> Chaos:** ${stats.totalChaosFragments || 0}\n**<:JJ_FragmentBaseMaterial:1416896262938034289> Base:** ${stats.totalBaseFragments || 0}`,
                inline: true
            },
            {
                name: 'Zużyte zasoby',
                value: `<:II_RC:1385139885924421653> Total RC: **${stats.totalPower || 0}**`,
                inline: true
            },
            {
                name: '\u200B',
                value: '\u200B',
                inline: true
            }
        );

        // Druga strona - Tech Party
        const page2 = new EmbedBuilder()
            .setTitle(safeTitle)
            .setColor(embedColor)
            .setTimestamp();

        // Tymczasowa zawartość Tech Party
        page2.addFields({
            name: 'Tech Party',
            value: 'Zawartość zostanie dodana wkrótce...',
            inline: false
        });

        // Trzecia strona - Survivor
        const page3 = new EmbedBuilder()
            .setTitle(safeTitle)
            .setColor(embedColor)
            .setTimestamp();

        // Tymczasowa zawartość Survivor
        page3.addFields({
            name: 'Survivor',
            value: 'Zawartość zostanie dodana wkrótce...',
            inline: false
        });

        // Czwarta strona - Collectible
        const page4 = new EmbedBuilder()
            .setTitle(safeTitle)
            .setColor(embedColor)
            .setTimestamp();

        // Zawartość Collectible
        this.addCollectibleFields(page4, buildData);

        // Piąta strona - Custom Sets
        const page5 = new EmbedBuilder()
            .setTitle(safeTitle)
            .setColor(embedColor)
            .setTimestamp();

        // Zawartość Custom Sets
        this.addCustomSetsFields(page5, buildData);

        // Szósta strona - Pets
        const page6 = new EmbedBuilder()
            .setTitle(safeTitle)
            .setColor(embedColor)
            .setTimestamp();

        // Tymczasowa zawartość Pets
        page6.addFields({
            name: 'Pets',
            value: 'Zawartość zostanie dodana wkrótce...',
            inline: false
        });

        return [page0, page1, page2, page3, page4, page5, page6];
    }

    /**
     * Tworzy przyciski nawigacji dla paginacji
     */
    createNavigationButtons(currentPage = 0, userId = null) {
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

        const row1 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('statystyki_page')
                    .setLabel('Statystyki')
                    .setStyle(currentPage === 0 ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('ekwipunek_page')
                    .setLabel('Ekwipunek')
                    .setStyle(currentPage === 1 ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('tech_party_page')
                    .setLabel('Tech Party')
                    .setStyle(currentPage === 2 ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('survivor_page')
                    .setLabel('Survivor')
                    .setStyle(currentPage === 3 ? ButtonStyle.Primary : ButtonStyle.Secondary)
            );

        const row2 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('collectible_page')
                    .setLabel('Collectible')
                    .setStyle(currentPage === 4 ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('custom_sets_page')
                    .setLabel('Custom Sets')
                    .setStyle(currentPage === 5 ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('pets_page')
                    .setLabel('Pets')
                    .setStyle(currentPage === 6 ? ButtonStyle.Primary : ButtonStyle.Secondary)
            );

        const row3 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('delete_embed')
                    .setLabel('Usuń')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🗑️')
            );

        return [row1, row2, row3];
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
     * Oblicza bonus RC dla itemów B z poziomem C
     */
    calculateBItemCBonus(cLevel) {
        const bonuses = [0, 1, 2, 4, 6, 9, 12, 17, 22, 30, 38]; // C0 = 0, C1 = 1, C2 = 2, itd.
        return bonuses[cLevel] || 0;
    }

    /**
     * Oblicza dodatkowe materiały E+V dla poziomów C w itemach B
     */
    calculateBItemCMaterialBonus(cLevel) {
        const mapping = [
            [0, 0], // C0 = 0E + 0V
            [1, 0], // C1 = 1E + 0V
            [1, 1], // C2 = 1E + 1V
            [2, 1], // C3 = 2E + 1V
            [2, 2], // C4 = 2E + 2V
            [3, 2], // C5 = 3E + 2V
            [3, 3], // C6 = 3E + 3V
            [4, 3], // C7 = 4E + 3V
            [4, 4], // C8 = 4E + 4V
            [5, 4], // C9 = 5E + 4V
            [5, 5]  // C10 = 5E + 5V
        ];

        if (cLevel < mapping.length) {
            return { e: mapping[cLevel][0], v: mapping[cLevel][1] };
        }
        return { e: 0, v: 0 };
    }

    /**
     * Sprawdza czy przedmiot ma E/V/C (True) czy B (False)
     */
    shouldShowEVCh(itemName) {
        const evChItems = [
            'Twin Lance', 'Evervoid Armor', 'Judgment Necklace', 'Stardust Sash',
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
                        // Przedmioty B - licz tylko C plus bonus RC
                        const cCost = this.calculateOldCCost(c);
                        const cBonus = this.calculateBItemCBonus(c);
                        totalResourceCost += cCost + cBonus;
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
                        // Przedmioty B - licz fragmenty C, B i dodatkowe E+V za poziomy C
                        if (c > 0) {
                            const cFragments = this.calculateCCost(c);
                            totalChaosFragments += cFragments.chaos;
                            totalBaseFragments += cFragments.base;

                            // Dodatkowe materiały E+V za poziomy C w itemach B
                            const bonus = this.calculateBItemCMaterialBonus(c);
                            if (bonus.e > 0) {
                                const bonusEFragments = this.calculateEVCost(bonus.e);
                                totalEternalFragments += bonusEFragments.eternalVoid;
                                totalBaseFragments += bonusEFragments.base;
                            }
                            if (bonus.v > 0) {
                                const bonusVFragments = this.calculateEVCost(bonus.v);
                                totalVoidFragments += bonusVFragments.eternalVoid;
                                totalBaseFragments += bonusVFragments.base;
                            }
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

    /**
     * Dodaje pola Collectibles do embeda
     */
    addCollectibleFields(embed, buildData) {
        // Sprawdź czy buildData ma collectibles
        let collectibles = {};


        // Sprawdź różne możliwe struktury
        if (buildData.collectibles && buildData.collectibles.data) {
            collectibles = buildData.collectibles.data;
        } else if (buildData.Collectibles && buildData.Collectibles.data) {
            collectibles = buildData.Collectibles.data;
        } else if (buildData.collectibles) {
            collectibles = buildData.collectibles;
        } else if (buildData.Collectibles) {
            collectibles = buildData.Collectibles;
        } else if (buildData.data && buildData.data.collectibles && buildData.data.collectibles.data) {
            collectibles = buildData.data.collectibles.data;
        } else if (buildData.data && buildData.data.Collectibles && buildData.data.Collectibles.data) {
            collectibles = buildData.data.Collectibles.data;
        } else if (buildData.data && buildData.data.collectibles) {
            collectibles = buildData.data.collectibles;
        } else if (buildData.data && buildData.data.Collectibles) {
            collectibles = buildData.data.Collectibles;
        }


        // Mapowanie nazw collectibles na ikony
        const collectibleIcons = {
            'Human Genome Mapping': '<:Coll_human_genome_mapping:1417581576103133347>',
            'Book of Ancient Wisdom': '<:Coll_book_of_ancient_wisdom:1417581162896949330>',
            'Immortal Lucky Coin': '<:Coll_immortal_lucky_coin:1417581648786227260>',
            'Instellar Transition Matrix Design': '<:Coll_instellar_transition_matrix:1417581693497511986>',
            'Angelic Tear Crystal': '<:Coll_angelic_tear_crystal:1417580861649588236>',
            'Unicorn\'s Horn': '<:Coll_unicorn_s_horn:1417582377831632966>',
            "Unicorn's Horn": '<:Coll_unicorn_s_horn:1417582377831632966>',
            'Otherworld Key': '<:Coll_otherworld_key:1417581987043999958>',
            'Starcore Diamond': '<:Coll_starcore_diamond:1417582260751827066>',
            'High-Lat Energy Cube': '<:Coll_high_lat_energy_cube:1417581540195565650>',
            'Void Bloom': '<:Coll_void_bloom:1417582398073340035>',
            'Eye of True Vision': '<:Coll_eye_of_true_vision:1417581382359584838>',
            'Life Hourglass': '<:Coll_life_hourglass:1417581729216073738>',
            'Nano-Mimetic Mask': '<:Coll_nano_mimetic_mask:1417581892596662333>',
            'Dice of Destiny': '<:Coll_dice_of_destiny:1417442718665146428>',
            'Dicern': '<:Coll_dicern:1454181949456273479>',
            'Elemental Ring': '<:Coll_elemental_ring:1417581367021146133>',
            'Anti-Gravity Device': '<:Coll_anti_gravity_device:1417581048224809012>',
            'Hydraulic Flipper': '<:Coll_hydraulic_flipper:1417581591412346880>',
            'Superhuman Pill': '<:Coll_superhuman_pill:1417582302107799723>',
            'Comms Conch': '<:Coll_comms_conch:1417581229435519006>',
            'Mini Dyson Sphere': '<:Coll_mini_dyson_sphere:1417581850347704341>',
            'Klein Bottle': '<:Coll_klein_bottle:1417581710132117516>',
            'Antiparticle Gourd': '<:Coll_antiparticle_gourd:1417581065152893058>',
            'Wildfire Furnace': '<:Coll_wildfire_furnace:1417582420638826526>',
            'Infinity Score': '<:Coll_infinity_score:1417581669329801286>',
            'Cosmic Compass': '<:Coll_cosmic_compass:1417581245793046698>',
            'Wormhole Detector': '<:Coll_wormhole_detector:1417582451647058071>',
            'Shuttle Capsule': '<:Coll_shuttle_capsule:1417582195681263770>',
            'Micro Artificial Sun': '<:Coll_micro_artihttpsficial_sun:1417581829212344433>',
            'Neurochip': '<:Coll_neurochip:1417581917804429442>',
            'Star-Rail Passenger Card': '<:Coll_star_rail_passenger_card:1417582235636334803>',
            'Portable Mech Case': '<:Coll_portable_mech_case:1417582046607310930>',
            // Dodatkowe collectibles dla pól 11-15
            'Time Essence Bottle': '<:Coll_time_essence_bottle:1417582361045893142>',
            'Temporal Rewinder': '<:Coll_temporal_rewinder:1417582340338614401>',
            'Tablet of Epics': '<:Coll_tablet_of_epics:1417582318247477398>',
            'Super Circuit Board': '<:Coll_super_circuit_board:1417582284948901898>',
            'Spatial Rewinder': '<:Coll_spatial_rewinder:1417582215629639801>',
            'Scientific Luminary\'s Journal': '<:Coll_scientific_luminary_s_journ:1417582167558590474>',
            "Scientific Luminary's Journal": '<:Coll_scientific_luminary_s_journ:1417582167558590474>',
            'Safehouse Map': '<:Coll_safehouse_map:1417582146511704074>',
            'Savior\'s Memento': '<:Coll_savior_s_memento:1417582102320386140>',
            "Savior's Memento": '<:Coll_savior_s_memento:1417582102320386140>',
            'Primordial War Drum': '<:Coll_primordial_war_drum:1417582068086472755>',
            'Plasma Sword': '<:Coll_plasma_sword:1417582018241499226>',
            'Old Medical Book': '<:Coll_old_medical_book:1417581963887509525>',
            'Nuclear Battery': '<:Coll_nuclear_battery:1417581940340428822>',
            'Mystical Halo': '<:Coll_mystical_halo:1417581868215173284>',
            'Mental Sync Helm': '<:Coll_mental_sync_helm:1417581806445793320>',
            'Memory Editor': '<:Coll_memory_editor:1417581771234480249>',
            'Lucky Charm': '<:Coll_lucky_charm:1417581754008731658>',
            'Golden Horn': '<:Coll_golden_horn:1417581520700444893>',
            'Golden Cutlery': '<:Coll_golden_cutlery:1417581503298273484>',
            'Gene Splicer': '<:Coll_gene_splicer:1417581442636058694>',
            'Flaming Plume': '<:Coll_flaming_plume:1417581397065072701>',
            'Dreamscape Puzzle': '<:Coll_dreamscape_puzzle:1417581348851421397>',
            'Dragon Tooth': '<:Coll_dragon_tooth:1417581330719572038>',
            'Dimension Foil': '<:Coll_dimension_foil:1417581312029491240>',
            'Cyber Totem': '<:Coll_cyber_totem:1417581265829236888>',
            'Clone Mirror': '<:Coll_clone_mirror:1417581204126961815>',
            'Atomic Mech': '<:Coll_atomic_mech:1417581142483275892>',
            'Astral Dewdrop': '<:Coll_astral_dewdrop:1417581123831070761>',
            'Holodream Fluid': '<:Coll_holodream_fluid:1417581561913806908>',
            'Hyper Neuron': '<:Coll_hyper_neuron:1417581619019255921>'
        };

        // Collectibles w tej samej kolejności co w decodeCollectibles()
        const collectibleOrder = [
            // Pozycje 1-4 (Pole 1)
            'Human Genome Mapping', 'Book of Ancient Wisdom', 'Immortal Lucky Coin', 'Instellar Transition Matrix Design',
            // Pozycje 5-8 (Pole 2)
            'Angelic Tear Crystal', 'Unicorn\'s Horn', 'Otherworld Key', 'Starcore Diamond',
            // Pozycje 9-12 (Pole 3)
            'High-Lat Energy Cube', 'Void Bloom', 'Eye of True Vision', 'Life Hourglass',
            // Pozycje 13-16 (Pole 4)
            'Nano-Mimetic Mask', 'Dice of Destiny', 'Dimension Foil', 'Mental Sync Helm',
            // Pozycje 17-20 (Pole 5)
            'Atomic Mech', 'Time Essence Bottle', 'Dragon Tooth', 'Hyper Neuron',
            // Pozycje 21-24 (Pole 6)
            'Cyber Totem', 'Clone Mirror', 'Dreamscape Puzzle', 'Gene Splicer',
            // Pozycje 25-28 (Pole 7)
            'Memory Editor', 'Temporal Rewinder', 'Spatial Rewinder', 'Holodream Fluid',
            // Pozycje 29-32 (Pole 8) - PUSTE
            '', '', '', '',
            // Pozycje 33-36 (Pole 9) - PUSTE
            '', '', '', '',
            // Pozycje 37-40 (Pole 10) - Rzeczywiste pozycje 29-32 z decodeCollectibles
            'Golden Cutlery', 'Old Medical Book', 'Savior\'s Memento', 'Safehouse Map',
            // Pozycje 41-44 (Pole 11) - Rzeczywiste pozycje 33-36 z decodeCollectibles
            'Lucky Charm', 'Scientific Luminary\'s Journal', 'Super Circuit Board', 'Mystical Halo',
            // Pozycje 45-48 (Pole 12) - Rzeczywiste pozycje 37-40 z decodeCollectibles
            'Tablet of Epics', 'Primordial War Drum', 'Flaming Plume', 'Astral Dewdrop',
            // Pozycje 49-52 (Pole 13) - Rzeczywiste pozycje 41-44 z decodeCollectibles
            'Nuclear Battery', 'Plasma Sword', 'Golden Horn', 'Elemental Ring',
            // Pozycje 53-56 (Pole 14) - Rzeczywiste pozycje 45-48 z decodeCollectibles
            'Anti-Gravity Device', 'Hydraulic Flipper', 'Superhuman Pill', 'Comms Conch',
            // Pozycje 57-60 (Pole 15) - Rzeczywiste pozycje 49-52 z decodeCollectibles
            'Mini Dyson Sphere', 'Micro Artificial Sun', 'Klein Bottle', 'Antiparticle Gourd',
            // Pozycje 61-64 (Pole 16) - Rzeczywiste pozycje 53-56 z decodeCollectibles
            'Wildfire Furnace', 'Infinity Score', 'Cosmic Compass', 'Wormhole Detector',
            // Pozycje 65-68 (Pole 17) - Rzeczywiste pozycje 57-60 z decodeCollectibles
            'Shuttle Capsule', 'Neurochip', 'Star-Rail Passenger Card', 'Portable Mech Case',
            // Pozycje 69-72 (Pole 18) - PUSTE
            '', '', '', ''
        ];

        // Funkcja do formatowania gwiazdek
        const formatStars = (stars) => {
            if (stars === 0) return '-';
            if (stars <= 5) return '☆'.repeat(stars);
            return '★'.repeat(stars - 5);
        };

        // Tworzymy pola zgodnie z collectibleOrder
        const fields = [];

        for (let fieldNum = 1; fieldNum <= 18; fieldNum++) {
            const fieldItems = [];
            const startIndex = (fieldNum - 1) * 4;

            // Dodaj nagłówek Legend do pola 1
            if (fieldNum === 1) {
                fields.push({
                    name: '<:J_CollRed:1402533014080065546> **Legend**',
                    value: '\u200B',
                    inline: true
                });
                continue;
            }

            // Dodaj nagłówek Epic do pola 10
            if (fieldNum === 10) {
                fields.push({
                    name: '<:J_CollYellow:1402532951492657172> **Epic**',
                    value: '\u200B',
                    inline: true
                });
                continue;
            }

            // Dla pozostałych pól, dodaj collectibles
            for (let i = 0; i < 4; i++) {
                const collectibleIndex = startIndex + i;
                if (collectibleIndex < collectibleOrder.length) {
                    const collectibleName = collectibleOrder[collectibleIndex];
                    if (collectibleName !== '') {
                        const collectible = collectibles[collectibleName];
                        if (collectible && collectibleIcons[collectibleName]) {
                            const icon = collectibleIcons[collectibleName];
                            const stars = formatStars(collectible.stars);
                            fieldItems.push(`${icon} ${stars}`);
                        }
                    }
                }
            }

            fields.push({
                name: '\u200B',
                value: fieldItems.length > 0 ? fieldItems.join('\n') : '\u200B',
                inline: true
            });
        }


        // Jeśli nie ma collectibles, pokaż wiadomość
        if (fields.length === 0) {
            embed.addFields({
                name: 'Collectibles',
                value: 'Brak danych o collectibles w tym buildzie.',
                inline: false
            });
        } else {
            // Dodaj wszystkie pola do embeda
            embed.addFields(...fields);

            // Oblicz liczbę użytych skrzynek Legend i Epic oddzielnie
            let legendBoxes = 0;
            let epicBoxes = 0;

            for (let i = 0; i < collectibleOrder.length; i++) {
                const collectibleName = collectibleOrder[i];
                const collectible = collectibles[collectibleName];

                if (collectible && collectible.stars > 0) {
                    const stars = collectible.stars;
                    let boxes = 0;

                    // Mapowanie gwiazdek na liczbę skrzynek
                    if (stars === 1) boxes = 1;
                    else if (stars === 2) boxes = 2;
                    else if (stars === 3) boxes = 3;
                    else if (stars === 4) boxes = 4;
                    else if (stars === 5) boxes = 6;
                    else if (stars === 6) boxes = 8;
                    else if (stars === 7) boxes = 10;
                    else if (stars === 8) boxes = 13;
                    else if (stars === 9) boxes = 16;
                    else if (stars === 10) boxes = 20;

                    // Określ czy to Legend (pozycje 0-27) czy Epic (pozycje 28+)
                    if (i < 28) {
                        // Pierwsze 28 collectibles = Legend (pola 2-8)
                        legendBoxes += boxes;
                    } else {
                        // Pozostałe collectibles = Epic (pola 11-18)
                        epicBoxes += boxes;
                    }
                }
            }

            // Dodaj pola z użytymi skrzynkami
            embed.addFields({
                name: 'Użyte skrzynki',
                value: `<:J_CollRed:1402533014080065546> ${legendBoxes}\n<:J_CollYellow:1402532951492657172> ${epicBoxes}`,
                inline: false
            });
        }
    }

    /**
     * Dodaje pola Custom Sets do embeda
     */
    addCustomSetsFields(embed, buildData) {
        // Sprawdź czy buildData ma customSets
        let customSets = {};

        // Sprawdź różne możliwe struktury
        if (buildData.customSets && buildData.customSets.data) {
            customSets = buildData.customSets.data;
        } else if (buildData.CustomSets && buildData.CustomSets.data) {
            customSets = buildData.CustomSets.data;
        } else if (buildData.customSets) {
            customSets = buildData.customSets;
        }

        // Sprawdź czy mamy dane
        if (!customSets || Object.keys(customSets).length === 0) {
            embed.addFields({
                name: 'Custom Sets',
                value: 'Brak danych o custom sets w tym buildzie.',
                inline: false
            });
            return;
        }

        // Ikony dla różnych typów
        const icons = {
            'Legend': '<:J_CollRed:1402533014080065546>',
            'Epic': '<:J_CollYellow:1402532951492657172>',
            'None': '<:ZZ_Pusto:1209494954762829866>'
        };

        // Przetwórz każdy set
        const setNames = ['0', '1', '2']; // 0 = set 1, 1 = set 2, 2 = set 3

        for (const setKey of setNames) {
            if (customSets[setKey] && Array.isArray(customSets[setKey])) {
                const setNumber = parseInt(setKey) + 1; // 0 -> 1, 1 -> 2, 2 -> 3
                const setItems = customSets[setKey];

                // Konwertuj każdy item na ikonę
                const iconString = setItems.map(item => icons[item] || icons['None']).join('');

                embed.addFields({
                    name: `Collection Set ${setNumber}`,
                    value: iconString || icons['None'].repeat(4), // Fallback na 4 puste ikony
                    inline: false
                });
            }
        }

        // Jeśli nie ma żadnych setów, pokaż wiadomość
        const hasAnySets = setNames.some(setKey => customSets[setKey] && Array.isArray(customSets[setKey]));
        if (!hasAnySets) {
            embed.addFields({
                name: 'Custom Sets',
                value: 'Brak danych o custom sets w tym buildzie.',
                inline: false
            });
        }
    }

    /**
     * Dodaje pola Statystyki do embeda
     */
    addStatisticsFields(embed, buildData) {
        // Strona Statystyki - na razie pusta
        embed.addFields({
            name: 'Statystyki',
            value: 'Zawartość zostanie dodana wkrótce...',
            inline: false
        });
    }

    /**
     * Oblicza szczegółowe statystyki buildu - wykorzystuje istniejącą funkcję
     */
    calculateBuildStatisticsDetailed(buildData) {
        return this.calculateBuildStatistics(buildData);
    }
}

module.exports = SurvivorService;