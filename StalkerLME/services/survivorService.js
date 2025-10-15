/**
 * Survivor.io Build Decoder Service for Stalker LME Bot
 * Dekoduje kody buildów z sio-tools.vercel.app
 */

const { createBotLogger } = require('../../utils/consoleLogger');

class SurvivorService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger || createBotLogger('StalkerLME');
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

            // Dekodowanie pets z klucza "o" (podstawowy format)
            if (data.o && typeof data.o === 'object') {
                buildData.pet = this.decodePets(data.o);
            }

            // Dekodowanie pets z klucza "pet" (alternatywny format)
            if (data.pet && typeof data.pet === 'object') {
                buildData.pet = this.decodePets(data.pet);
            }

            // Dekodowanie petSkills - sprawdź różne możliwe klucze
            if (data.petSkills && typeof data.petSkills === 'object') {
                buildData.petSkills = this.decodePetSkills(data.petSkills);
            } else if (data._V && typeof data._V === 'object') {
                buildData.petSkills = this.decodePetSkills(data._V);
            } else if (data.l && Array.isArray(data.l)) {
                // Pet skills są w kluczu "l" jako tablica
                buildData.petSkills = this.decodePetSkillsFromArray(data.l);
            }

            // Dekodowanie heroes z klucza "h"
            if (data.h && Array.isArray(data.h)) {
                buildData.heroes = this.decodeHeroes(data.h);
            }

            // Dekodowanie meta z klucza "a"
            if (data.a && typeof data.a === 'object') {
                buildData.meta = this.decodeMeta(data.a);
            }

            // Dekodowanie tech parts - priorytet dla gotowych danych
            if (data.data && typeof data.data === 'object') {
                // Tech parts w strukturze data.data (gotowe do użycia - najwyższy priorytet)
                buildData.techs = { data: data.data, fromState: true };
            } else if (data.techs && typeof data.techs === 'object') {
                // Tech parts w kluczu techs
                buildData.techs = data.techs;
            } else if (data.t && typeof data.t === 'object') {
                // Tech parts mogą być w kluczu "t"
                buildData.techs = { data: data.t };
            } else if (data.techParts && typeof data.techParts === 'object') {
                // Tech parts w kluczu techParts
                buildData.techs = data.techParts;
            } else if (data.m && Array.isArray(data.m)) {
                // Tech parts z klucza "m" (tablica danych do dekodowania - najniższy priorytet)
                buildData.techs = this.decodeTechParts(data.m);
            }

            // Zachowaj dane zasobów (klucz X)
            if (data.X) {
                buildData.X = data.X;
            }

            // Zachowaj surowe dane do debugowania
            buildData.rawData = data;

            // Debug logging dla tech parts
            this.logger.info(`🔧 Tech parts debug - dostępne klucze: ${Object.keys(data).join(', ')}`);
            if (buildData.techs) {
                this.logger.info(`✅ Tech parts znalezione w buildData.techs`);
            } else {
                this.logger.info(`❌ Brak tech parts w buildData`);
            }

            return this.normalizeBuildData(buildData);
        } catch (error) {
            this.logger.error(`Błąd konwersji formatu sio-tools: ${error.message}`);
            return null;
        }
    }

    /**
     * Dekoduje tech parts z tablicy danych
     */
    decodeTechParts(techPartsArray) {
        // Kolejność tech parts zgodna ze strukturą danych (8 tech parts)
        const techPartNames = [
            'Energy Guidance System', // 0 - Drone Mode / Forcefield Mode
            'Antimatter Maintainer',  // 1 - Drill Shot Mode / Rocket Mode
            'Quantum Nanobot',        // 2 - Durian Mode / Soccer Mode
            'Phase Driver',           // 3 - Boomerang Mode / Lightning Mode
            'Energy Diffuser',        // 4 - brak trybu
            'Hi-Maintainer',         // 5 - brak trybu
            'Antimatter Generator',   // 6 - brak trybu
            'Precision Device'        // 7 - brak trybu
        ];

        // Mapowanie trybów na podstawie wartości "z" (0 lub 1)
        const modeMapping = {
            0: { // z: 0 = pierwszy tryb
                'Energy Guidance System': 'Drone Mode',
                'Antimatter Maintainer': 'Drill Shot Mode',
                'Quantum Nanobot': 'Soccer Mode',
                'Phase Driver': 'Lightning Mode'
            },
            1: { // z: 1 = drugi tryb
                'Energy Guidance System': 'Forcefield Mode',
                'Antimatter Maintainer': 'Rocket Mode',
                'Quantum Nanobot': 'Durian Mode',
                'Phase Driver': 'Boomerang Mode'
            }
        };

        const decodedTechParts = {};

        for (let i = 0; i < techPartsArray.length && i < techPartNames.length; i++) {
            const techData = techPartsArray[i];
            const techName = techPartNames[i];

            if (!techData || !techName) continue;

            // Dekoduj dane tech part
            const deployed = techData.y === 1;

            // Mapowanie rarności na podstawie wartości B
            const rarity = techData.B === 0 ? 'Eternal' : 'Legend';

            const resonance = techData.A || 0;

            // Ustal tryb na podstawie wartości z
            const mode = modeMapping[techData.z] ? modeMapping[techData.z][techName] : undefined;

            decodedTechParts[techName] = {
                deployed,
                rarity,
                resonance: resonance > 0 ? resonance : undefined
            };

            // Dodaj tryb jeśli istnieje
            if (mode) {
                decodedTechParts[techName].mode = mode;
            }
        }

        return {
            data: decodedTechParts,
            fromState: true
        };
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
     * Dekoduje pets z danych
     */
    decodePets(petData) {
        // Mapowanie typów pets na nazwy
        const petTypeToName = {
            1: 'Rex',
            2: 'Croaky',
            3: 'Capy',
            4: 'Clucker',
            5: 'Puffo'
        };

        // Mapowanie nazw pets na ikony Discord
        const petNameToIcon = {
            'Rex': '<:rex:1417809684659966114>',
            'Puffo': '<:puffo:1417809665806565397>',
            'Clucker': '<:clucker:1417809647284523080>',
            'Croaky': '<:croaky:1417809629622042675>',
            'Capy': '<:capy:1417809563301974117>'
        };

        const petType = petData.t || 0;
        const petStars = petData.r || 0;
        const petName = petTypeToName[petType] || 'Unknown';
        const petIcon = petNameToIcon[petName] || '❓';

        return {
            data: {
                name: petName,
                stars: petStars,
                icon: petIcon,
                type: petType
            }
        };
    }

    /**
     * Dekoduje pet skills z danych
     */
    decodePetSkills(petSkillsData) {
        // Funkcja do dekodowania pet skills zgodnie z formatem z przykładu
        // Format: { "Motivation": { "enabled": true, "rarity": "Super" }, ... }
        return {
            data: petSkillsData
        };
    }

    /**
     * Dekoduje pet skills z tablicy (klucz "l")
     */
    decodePetSkillsFromArray(petSkillsArray) {
        const skillNames = [
            'Motivation', 'Inspiration', 'Encouragement', 'Battle Lust', 'Gary',
            'Sync Rate', 'Resonance Chance', 'Resonance Damage', 'Shield Damage',
            'Dmg to Poisoned', 'Dmg to Weakened', 'Dmg to Chilled'
        ];

        const rarityMap = {
            0: 'Excellent',
            1: 'Advanced',
            2: 'Super'
        };

        const decodedSkills = {};

        for (let i = 0; i < petSkillsArray.length && i < skillNames.length; i++) {
            const skillData = petSkillsArray[i];
            const skillName = skillNames[i];

            if (skillData) {
                if (i < 5) {
                    // Pierwsze 5 skills (Rex/Croaky format)
                    if (skillData.s !== undefined && skillData.B !== undefined) {
                        decodedSkills[skillName] = {
                            enabled: skillData.s === 1,
                            rarity: rarityMap[skillData.B] || 'Advanced'
                        };
                    }
                } else {
                    // Pozostałe skills (Puffo/Clucker/Capy format)
                    if (skillData.P !== undefined) {
                        decodedSkills[skillName] = {
                            value: skillData.P
                        };
                    }
                }
            }
        }


        return {
            data: decodedSkills
        };
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

        // Zachowaj pet jeśli istnieje
        if (data.pet) {
            result.pet = data.pet;
        }

        // Zachowaj petSkills jeśli istnieją
        if (data.petSkills) {
            result.petSkills = data.petSkills;
        }

        // Zachowaj heroes jeśli istnieją
        if (data.heroes) {
            result.heroes = data.heroes;
        }

        // Zachowaj meta jeśli istnieją
        if (data.meta) {
            result.meta = data.meta;
        }

        // Zachowaj techs jeśli istnieją
        if (data.techs) {
            result.techs = data.techs;
        }

        // Zachowaj dane zasobów X jeśli istnieją
        if (data.X) {
            result.X = data.X;
        }

        // Zachowaj surowe dane jeśli istnieją
        if (data.rawData) {
            result.rawData = data.rawData;
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
    async createBuildEmbeds(buildData, userTag, buildCode, viewerDisplayName = null) {
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
        const title = `Analiza konta gracza ${userTag}`;
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
            .setColor(embedColor);

        // Zawartość Statystyki
        await this.addStatisticsFields(page0, buildData, buildCode);

        // Pierwsza strona (teraz page1) - każdy item ekwipunku w osobnym polu
        const page1 = new EmbedBuilder()
            .setTitle(safeTitle)
            .setColor(embedColor);

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

                // Oblicz RC dla nagłówka
                let rcText = '';
                if (this.shouldShowEVCh(item.name)) {
                    const resourceCost = this.calculateItemResourceCost(e, v, c, base, item.name);
                    rcText = resourceCost > 0 ? ` • <:II_RC:1385139885924421653> ${resourceCost}` : '';
                } else {
                    if (c > 0) {
                        const cCost = this.calculateOldCCost(c);
                        const cBonus = this.calculateBItemCBonus(c);
                        const totalCost = cCost + cBonus;
                        rcText = totalCost > 0 ? ` • <:II_RC:1385139885924421653> ${totalCost}` : '';
                    }
                }

                const fieldName = `${emoji} ${item.name}${rcText}`;

                // Przygotuj gwiazdki dla value
                let starLines = '';
                if (this.shouldShowEVCh(item.name)) {
                    if (e > 0) {
                        const starCount = Math.min(e, 10);
                        const stars = '☆'.repeat(starCount);
                        starLines += `<:M_IconEternal:1417224046235619358> • ${stars}\n`;
                    }
                    if (v > 0) {
                        const starCount = Math.min(v, 10);
                        const stars = '☆'.repeat(starCount);
                        starLines += `<:M_IconVoid:1417224049490268270> • ${stars}\n`;
                    }
                    if (c > 0) {
                        const starCount = Math.min(c, 10);
                        const stars = '★'.repeat(starCount);
                        starLines += `<:M_IconChaos:1417224053055426811> • ${stars}\n`;
                    }
                } else {
                    if (base > 0) {
                        const bIcon = this.getBItemIcon(item.name);
                        const starCount = Math.min(base, 10);
                        const stars = '☆'.repeat(starCount);
                        starLines += `${bIcon} • ${stars}\n`;
                    }
                    if (c > 0) {
                        const starCount = Math.min(c, 10);
                        const stars = '★'.repeat(starCount);
                        starLines += `<:M_IconChaos:1417224053055426811> • ${stars}\n`;
                    }
                }

                const fieldValue = starLines.trim() || '\u200B';

                // Sprawdź czy pole nie jest za długie (limit 256 znaków na name, 1024 na value)
                if (fieldName.length <= 256 && fieldValue.length <= 1024) {
                    equipmentFields.push({
                        name: fieldName,
                        value: fieldValue,
                        inline: true // Pola obok siebie
                    });
                } else {
                    // Jeśli za długie, obetnij nazwę i value
                    const truncatedName = fieldName.length > 256 ? fieldName.substring(0, 253) + '...' : fieldName;
                    const truncatedValue = fieldValue.length > 1024 ? fieldValue.substring(0, 1020) + '...' : fieldValue;
                    equipmentFields.push({
                        name: truncatedName,
                        value: truncatedValue,
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
            .setColor(embedColor);

        // Zawartość Tech Party
        this.addTechPartsFields(page2, buildData);

        // Trzecia strona - Survivor
        const page3 = new EmbedBuilder()
            .setTitle(safeTitle)
            .setColor(embedColor);

        // Zawartość Survivor - Meta dane na początku
        if (buildData.meta) {
            const meta = buildData.meta;

            // Pole 1: Harmonia
            const mainHeroIcon = this.getHeroIcon(meta.mainHero);
            const mainHeroStars = buildData.heroes && buildData.heroes[meta.mainHero]
                ? this.formatStars(buildData.heroes[meta.mainHero].stars) : '';

            let harmonyValue = `<:Sgrade:1418171792769552429> ${mainHeroIcon} **${meta.mainHero}**\n${mainHeroStars}`;

            // Tylko jeśli synergy: true, pokaż harmonyL i harmonyR
            if (meta.synergy) {
                const harmonyLIcon = this.getHeroIcon(meta.harmonyL);
                const harmonyRIcon = this.getHeroIcon(meta.harmonyR);
                const harmonyLStars = buildData.heroes && buildData.heroes[meta.harmonyL]
                    ? this.formatStars(buildData.heroes[meta.harmonyL].stars) : '';
                const harmonyRStars = buildData.heroes && buildData.heroes[meta.harmonyR]
                    ? this.formatStars(buildData.heroes[meta.harmonyR].stars) : '';

                harmonyValue += `\n⬅️ ${harmonyLIcon} **${meta.harmonyL}**\n${harmonyLStars}\n` +
                    `➡️ ${harmonyRIcon} **${meta.harmonyR}**\n${harmonyRStars}`;
            }

            page3.addFields({
                name: 'Harmonia',
                value: harmonyValue,
                inline: true
            });

            // Pole 2: Teamwork Passive
            let teamworkValue = '';
            if (meta.teamwork && meta.teamwork.length > 0) {
                // Filtruj "Unknown" bohaterów
                const validTeamwork = meta.teamwork.filter(heroName => heroName !== 'Unknown');

                if (validTeamwork.length > 0) {
                    for (const heroName of validTeamwork) {
                        const heroIcon = this.getHeroIcon(heroName);
                        const heroStars = buildData.heroes && buildData.heroes[heroName]
                            ? this.formatStars(buildData.heroes[heroName].stars) : '';
                        teamworkValue += `${heroIcon} **${heroName}**\n${heroStars}\n`;
                    }
                    teamworkValue = teamworkValue.trim();
                } else {
                    teamworkValue = '-'; // Dash dla braku danych
                }
            } else {
                teamworkValue = '-'; // Dash dla braku danych
            }

            page3.addFields({
                name: 'Teamwork Passive',
                value: teamworkValue,
                inline: true
            });

            // Pole 3: Zużyte zasoby
            let resourcesValue = this.calculateCoreAndPuzzle(buildData, meta);

            page3.addFields({
                name: 'Zużyte zasoby',
                value: resourcesValue,
                inline: true
            });
        }

        // Zawartość Survivor - Heroes
        if (buildData.heroes && Object.keys(buildData.heroes).length > 0) {
            for (const [heroName, heroData] of Object.entries(buildData.heroes)) {
                const stars = this.formatStars(heroData.stars);
                const fieldName = `${heroData.icon} **${heroName}**`;

                page3.addFields({
                    name: fieldName,
                    value: stars,
                    inline: true
                });
            }
        } else if (!buildData.meta) {
            page3.addFields({
                name: 'Heroes',
                value: 'Brak danych o herosach',
                inline: true
            });
        }

        // Czwarta strona - Legend Colls
        const page4 = new EmbedBuilder()
            .setTitle(safeTitle)
            .setColor(embedColor);

        // Zawartość Legend Collectibles
        this.addLegendCollectibleFields(page4, buildData);

        // Piąta strona - Epic Colls
        const page5 = new EmbedBuilder()
            .setTitle(safeTitle)
            .setColor(embedColor);

        // Zawartość Epic Collectibles
        this.addEpicCollectibleFields(page5, buildData);

        // Szósta strona - Custom Sets
        const page6 = new EmbedBuilder()
            .setTitle(safeTitle)
            .setColor(embedColor);

        // Zawartość Custom Sets
        this.addCustomSetsFields(page6, buildData);

        // Siódma strona - Pets
        const page7 = new EmbedBuilder()
            .setTitle(safeTitle)
            .setColor(embedColor);

        // Dodaj pola Pets
        this.addPetsFields(page7, buildData);

        // Dodaj footer z czasem wygaśnięcia i informacją o oglądającym
        const deleteTimestamp = Math.floor((Date.now() + 15 * 60 * 1000) / 1000);
        const viewerText = viewerDisplayName ? ` • Ogląda ${viewerDisplayName}` : '';
        const expirationText = `Analiza zostanie usunięta o <t:${deleteTimestamp}:t>${viewerText}`;

        page0.setFooter({ text: `Start • ${expirationText}` });
        page1.setFooter({ text: `Ekwipunek • ${expirationText}` });
        page2.setFooter({ text: `Tech Party • ${expirationText}` });
        page3.setFooter({ text: `Survivor • ${expirationText}` });
        page4.setFooter({ text: `Legend Colls • ${expirationText}` });
        page5.setFooter({ text: `Epic Colls • ${expirationText}` });
        page6.setFooter({ text: `Custom Colls • ${expirationText}` });
        page7.setFooter({ text: `Pets • ${expirationText}` });

        return [page0, page1, page2, page3, page4, page5, page6, page7];
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
                    .setLabel('Start')
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
                    .setCustomId('legend_colls_page')
                    .setLabel('Legend Colls')
                    .setStyle(currentPage === 4 ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('epic_colls_page')
                    .setLabel('Epic Colls')
                    .setStyle(currentPage === 5 ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('custom_sets_page')
                    .setLabel('Custom Colls')
                    .setStyle(currentPage === 6 ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('pets_page')
                    .setLabel('Pets')
                    .setStyle(currentPage === 7 ? ButtonStyle.Primary : ButtonStyle.Secondary)
            );

        const row3 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('delete_embed')
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
        if (totalCount >= 45) return '<:H_LanceV6:1420107824071049246>';
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
            'Dice of Destiny': '<:Coll_dice_of_destiny:1417581282916962427>',
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
                    name: '<:pusto:1417874543283802143> <:I_LanceV1:1418181398115913788> Set',
                    value: '<:J_CollRed:1402533014080065546> **Legend**',
                    inline: true
                });
                continue;
            }

            // Pola 2-7: Legend collectibles z custom nagłówkami
            if (fieldNum >= 2 && fieldNum <= 7) {
                // Wypełnij collectibles dla tego pola
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

                // Dodaj pole z odpowiednim nagłówkiem
                let fieldName = '\u200B';
                if (fieldNum === 2) fieldName = '<:pusto:1417874543283802143> <:SSArmor:1418182494561501234> Set';
                else if (fieldNum === 3) fieldName = '<:pusto:1417874543283802143> <:SSNecklace:1418182845280813157> Set';
                else if (fieldNum === 4) fieldName = '<:pusto:1417874543283802143> <:SSBelt:1418182394384748615> Set';
                else if (fieldNum === 5) fieldName = '<:pusto:1417874543283802143> <:SSGloves:1418182564706914396> Set';
                else if (fieldNum === 6) fieldName = '<:pusto:1417874543283802143> <:SSBoots:1418182624819544145> Set';
                else if (fieldNum === 7) fieldName = '<:pusto:1417874543283802143> <:capy:1417809563301974117> Set';

                fields.push({
                    name: fieldName,
                    value: fieldItems.length > 0 ? fieldItems.join('\n') : '\u200B',
                    inline: true
                });
                continue;
            }

            // Dodaj nagłówek Epic do pola 10
            if (fieldNum === 10) {
                fields.push({
                    name: '\u200B',
                    value: '<:J_CollYellow:1402532951492657172> **Epic**',
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

        // Sprawdź czy mamy dane - jeśli nie, wygeneruj puste sety
        if (!customSets || Object.keys(customSets).length === 0) {
            // Wygeneruj puste Collection Set 1, 2, 3 z pustymi skrzynkami
            const emptyChestIcon = '<:chest_none:1417793926324289638>';

            // Set 1: 4 skrzynki (1 linia po 4)
            const set1Value = emptyChestIcon.repeat(4);

            // Set 2 i 3: 8 skrzynek (2 linie po 4)
            const set23Value = emptyChestIcon.repeat(4) + '\n' + emptyChestIcon.repeat(4);

            embed.addFields(
                {
                    name: 'Collection Set 1',
                    value: set1Value,
                    inline: false
                },
                {
                    name: 'Collection Set 2',
                    value: set23Value,
                    inline: false
                },
                {
                    name: 'Collection Set 3',
                    value: set23Value,
                    inline: false
                }
            );
            return;
        }

        // Ikony dla różnych typów
        const icons = {
            'Legend': '<:J_CollRed:1402533014080065546>',
            'Epic': '<:J_CollYellow:1402532951492657172>',
            'None': '<:chest_none:1417793926324289638>'
        };

        // Przetwórz każdy set
        const setNames = ['0', '1', '2']; // 0 = set 1, 1 = set 2, 2 = set 3

        for (const setKey of setNames) {
            if (customSets[setKey] && Array.isArray(customSets[setKey])) {
                const setNumber = parseInt(setKey) + 1; // 0 -> 1, 1 -> 2, 2 -> 3
                const setItems = customSets[setKey];

                // Konwertuj każdy item na ikonę i podziel na linijki po 4
                const itemIcons = setItems.map(item => icons[item] || icons['None']);

                // Podziel na grupy po 4 ikony
                const iconLines = [];
                for (let i = 0; i < itemIcons.length; i += 4) {
                    const line = itemIcons.slice(i, i + 4).join('');
                    iconLines.push(line);
                }

                const iconString = iconLines.join('\n') || icons['None'].repeat(4); // Fallback na 4 puste ikony

                embed.addFields({
                    name: `Collection Set ${setNumber}`,
                    value: iconString,
                    inline: false
                });
            }
        }

        // Jeśli nie ma żadnych setów, wygeneruj puste sety dla brakujących
        const hasAnySets = setNames.some(setKey => customSets[setKey] && Array.isArray(customSets[setKey]));
        if (!hasAnySets) {
            // Wygeneruj puste Collection Set 1, 2, 3
            const emptyChestIcon = '<:chest_none:1417793926324289638>';

            // Set 1: 4 skrzynki (1 linia po 4)
            const set1Value = emptyChestIcon.repeat(4);

            // Set 2 i 3: 8 skrzynek (2 linie po 4)
            const set23Value = emptyChestIcon.repeat(4) + '\n' + emptyChestIcon.repeat(4);

            embed.addFields(
                {
                    name: 'Collection Set 1',
                    value: set1Value,
                    inline: false
                },
                {
                    name: 'Collection Set 2',
                    value: set23Value,
                    inline: false
                },
                {
                    name: 'Collection Set 3',
                    value: set23Value,
                    inline: false
                }
            );
        }
    }

    /**
     * Dodaje pola Tech Parts do embeda
     */
    addTechPartsFields(embed, buildData) {
        // Sprawdź czy buildData ma techs
        let techsData = {};

        if (buildData.techs && buildData.techs.data) {
            techsData = buildData.techs.data;
        } else if (buildData.techs) {
            techsData = buildData.techs;
        }

        // Sprawdź czy mamy dane
        if (!techsData || Object.keys(techsData).length === 0) {
            embed.addFields({
                name: 'Resonance',
                value: 'Brak danych o Tech Parts',
                inline: true
            });
            return;
        }

        // Filtruj tylko deployed = true i sortuj po resonance (najwyższe na górze)
        const deployedTechs = [];

        for (const [techName, techData] of Object.entries(techsData)) {
            if (techData.deployed) {
                deployedTechs.push({
                    name: techName,
                    ...techData
                });
            }
        }

        // Sortuj po resonance (najwyższe na górze)
        deployedTechs.sort((a, b) => (b.resonance || 0) - (a.resonance || 0));

        if (deployedTechs.length === 0) {
            embed.addFields({
                name: 'Resonance',
                value: 'Brak wdrożonych Tech Parts',
                inline: true
            });
            return;
        }

        // Formatuj tech parts
        const techLines = deployedTechs.map(tech => {
            const icon = this.getTechPartIcon(tech.name, tech.rarity, tech.mode);
            const displayName = tech.mode || tech.name;
            const resonanceText = tech.resonance ? `**${tech.resonance}**` : '';

            return `${icon} ${displayName} • ${resonanceText}`;
        });

        embed.addFields({
            name: 'Resonance',
            value: techLines.join('\n') || 'Brak danych',
            inline: true
        });

        // Drugie pole: Zużyte zasoby
        this.addResourcesField(embed, buildData);
    }

    /**
     * Dodaje pole Zużyte zasoby do embeda
     */
    addResourcesField(embed, buildData) {


        // Sprawdź czy mamy nowe dane w formacie data.inputs/chips
        let resourceData = null;
        let chipCount = 0;
        let isNewFormat = false;

        // Nowy format z data.inputs i data.chips
        if (buildData.rawData && buildData.rawData.X && buildData.rawData.X.data) {
            resourceData = buildData.rawData.X.data;
            chipCount = resourceData.chips || 0;
            isNewFormat = true;
        } else if (buildData.X && buildData.X.data) {
            resourceData = buildData.X.data;
            chipCount = resourceData.chips || 0;
            isNewFormat = true;
        } else if (buildData.X && buildData.X.inputs && buildData.X.chips !== undefined) {
            // Nowy format bezpośrednio w X
            resourceData = buildData.X;
            chipCount = resourceData.chips || 0;
            isNewFormat = true;
        }
        // Stary format z U i V
        else if (buildData.rawData && buildData.rawData.X) {
            resourceData = buildData.rawData.X;
            chipCount = resourceData.U || 0;
            isNewFormat = false;
        } else if (buildData.X) {
            resourceData = buildData.X;
            chipCount = resourceData.U || 0;
            isNewFormat = false;
        }

        if (!resourceData) {
            embed.addFields({
                name: 'Zużyte zasoby',
                value: 'Brak danych o zasobach',
                inline: true
            });
            return;
        }

        const resourceLines = [
            `<:I_Chip:1418559789939822723> • **${chipCount}**`
        ];

        if (isNewFormat && resourceData.inputs) {
            // Nowy format - inputs jako obiekt
            const partMapping = [
                { key: 'Eternal', icon: '<:eternal:1418558858233909361>' },
                { key: 'Legend4', icon: '<:legend4:1418558885052153926>' },
                { key: 'Legend3', icon: '<:legend3:1418558899929350237>' },
                { key: 'Legend2', icon: '<:legend2:1418558932321959938>' },
                { key: 'Legend1', icon: '<:legend1:1418558955763793970>' },
                { key: 'Legend', icon: '<:legend:1418558973384200274>' },
                { key: 'Epic3', icon: '<:epic3:1420101183925649478>' },
                { key: 'Epic2', icon: '<:epic2:1420101201676210176>' },
                { key: 'Epic1', icon: '<:epic1:1420101213214478397>' }
            ];

            for (const part of partMapping) {
                const count = resourceData.inputs[part.key] || 0;
                if (count > 0) {
                    resourceLines.push(`${part.icon} • **${count}**`);
                }
            }
        } else {
            // Stary format - V jako tablica (może mieć 6 lub 9 elementów)
            const partCounts = resourceData.V || [];
            const partIcons = [
                '<:eternal:1418558858233909361>',   // 0 - eternal
                '<:legend4:1418558885052153926>',  // 1 - legend4
                '<:legend3:1418558899929350237>',  // 2 - legend3
                '<:legend2:1418558932321959938>',  // 3 - legend2
                '<:legend1:1418558955763793970>',  // 4 - legend1
                '<:legend:1418558973384200274>',   // 5 - legend
                '<:epic3:1420101183925649478>',    // 6 - epic3 (nowe)
                '<:epic2:1420101201676210176>',    // 7 - epic2 (nowe)
                '<:epic1:1420101213214478397>'     // 8 - epic1 (nowe)
            ];

            // Dodaj wszystkie rodzaje partów (obsługuje zarówno 6 jak i 9 elementów)
            for (let i = 0; i < Math.min(partIcons.length, partCounts.length); i++) {
                const count = partCounts[i] || 0;
                if (count > 0) {
                    resourceLines.push(`${partIcons[i]} • **${count}**`);
                }
            }
        }

        embed.addFields({
            name: 'Zużyte zasoby',
            value: resourceLines.join('\n'),
            inline: true
        });
    }

    /**
     * Pobiera ikonę Tech Part na podstawie nazwy, rarity i trybu
     */
    getTechPartIcon(techName, rarity, mode) {
        // Mapowanie ikon dla tech parts z trybami
        const modeIcons = {
            'legend': {
                'Soccer Mode': '<:legend_soccer_mode:1418545625959632977>',
                'Rocket Mode': '<:legend_rocket_mode:1418545607936704615>',
                'Lightning Mode': '<:legend_lightning_mode:1418545583328858142>',
                'Forcefield Mode': '<:legend_force_field_mode:1418545566870405180>',
                'Durian Mode': '<:legend_durian_mode:1418545546078982284>',
                'Drone Mode': '<:legend_drone_mode:1418545528429482004>',
                'Drill Shot Mode': '<:legend_drill_shot_mode:1418545511564312616>',
                'Boomerang Mode': '<:legend_boomerang_mode:1418545498725290024>'
            },
            'eternal': {
                'Soccer Mode': '<:eternal_soccer_mode:1418545480388055073>',
                'Rocket Mode': '<:eternal_rocket_mode:1418545458350919680>',
                'Lightning Mode': '<:eternal_lightning_mode:1418545442899230771>',
                'Forcefield Mode': '<:eternal_force_field_mode:1418545421831114752>',
                'Durian Mode': '<:eternal_durian_mode:1418545403028308048>',
                'Drone Mode': '<:eternal_drone_mode:1418545385202389044>',
                'Drill Shot Mode': '<:eternal_drill_shot_mode:1418545368106405999>',
                'Boomerang Mode': '<:eternal_boomerang_mode:1418545314222182491>'
            }
        };

        // Mapowanie ikon dla tech parts bez trybów
        const noModeIcons = {
            'Energy Diffuser': {
                'Legend': '<:Energy_Diffuser_legend:1418544688062926998>',
                'Eternal': '<:Energy_Diffuser_eternal:1418544672728678460>'
            },
            'Hi-Maintainer': {
                'Legend': '<:HiMaintainer_legend:1418544778320023643>',
                'Eternal': '<:HiMaintainer_eternal:1418544765107966042>'
            },
            'Antimatter Generator': {
                'Legend': '<:Antimatter_Generator_legend:1418544648128827572>',
                'Eternal': '<:Antimatter_Generator_eternal:1418544615518376006>'
            },
            'Precision Device': {
                'Legend': '<:Precision_Device_legend:1418544744857866331>',
                'Eternal': '<:Precision_Device_eternal:1418544725299953804>'
            }
        };

        // Sprawdź czy ma tryb
        if (mode && modeIcons[rarity?.toLowerCase()]) {
            return modeIcons[rarity.toLowerCase()][mode] || '⚙️';
        }

        // Sprawdź tech parts bez trybu
        if (noModeIcons[techName] && rarity) {
            return noModeIcons[techName][rarity] || '⚙️';
        }

        return '⚙️'; // Fallback icon
    }

    /**
     * Dodaje pola Start do embeda
     */
    async addStatisticsFields(embed, buildData, buildCode) {
        // Sprawdź klucz "I" w meta data - musimy sprawdzić surowy klucz przed dekodowaniem
        let statisticsValue = 'Brak danych';

        if (buildData.meta && buildData.meta.gameMode) {
            const gameMode = buildData.meta.gameMode;
            const originalGameMode = buildData.meta.originalGameMode;

            // Sprawdź oryginalny gameMode przed dekodowaniem
            if (originalGameMode === 'ee') {
                statisticsValue = 'Ustawienia dla trybu Ender\'s Echo';
            } else if (gameMode === 'lme1') {
                statisticsValue = 'Ustawienia dla 1 fazy LME';
            } else if (gameMode === 'lme2') {
                const lmeTestaments = buildData.meta.lmeTestaments || 0;
                embed.addFields({
                    name: 'Ustawienia dla 2 fazy LME',
                    value: `Punkty przeciwnika: **${lmeTestaments}**`,
                    inline: false
                });
                return; // Wyjdź wcześniej dla lme2
            }
        }

        embed.addFields({
            name: statisticsValue,
            value: '\u200B',
            inline: false
        });

        // Dodaj pole "Zużyte zasoby" z agregowanymi danymi
        await this.addStartResourcesField(embed, buildData);
    }




    addLegendCollectibleFields(embed, buildData) {
        // Użyj tego samego kodu co addCollectibleFields ale tylko dla Legend
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

        const { collectibleIcons, collectibleOrder, formatStars } = this.getCollectibleData();

        // Pola 1-8 (Legend) - z nagłówkami
        const fields = [];

        // Pola 1-8: collectibles z custom nagłówkami (przesunięte o 1 wstecz)
        for (let fieldNum = 1; fieldNum <= 8; fieldNum++) {
            const fieldItems = [];
            // Mapowanie: pole 1 = pozycje 0-3, pole 2 = pozycje 4-7, itd.
            const startIndex = (fieldNum - 1) * 4;

            // Dodaj collectibles dla tego pola
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

            // Wybierz odpowiedni nagłówek
            let fieldName = '\u200B';
            if (fieldNum === 1) fieldName = '<:pusto:1417874543283802143> <:I_LanceV1:1418181398115913788> Set';
            else if (fieldNum === 2) fieldName = '<:pusto:1417874543283802143> <:SSArmor:1418182494561501234> Set';
            else if (fieldNum === 3) fieldName = '<:pusto:1417874543283802143> <:SSNecklace:1418182845280813157> Set';
            else if (fieldNum === 4) fieldName = '<:pusto:1417874543283802143> <:SSBelt:1418182394384748615> Set';
            else if (fieldNum === 5) fieldName = '<:pusto:1417874543283802143> <:SSGloves:1418182564706914396> Set';
            else if (fieldNum === 6) fieldName = '<:pusto:1417874543283802143> <:SSBoots:1418182624819544145> Set';
            else if (fieldNum === 7) fieldName = '<:pusto:1417874543283802143> <:capy:1417809563301974117> Set';

            fields.push({
                name: fieldName,
                value: fieldItems.length > 0 ? fieldItems.join('\n') : '\u200B',
                inline: true
            });
        }

        if (fields.length === 0) {
            embed.addFields({
                name: 'Legend Collectibles',
                value: 'Brak danych o Legend collectibles w tym buildzie.',
                inline: false
            });
        } else {
            embed.addFields(...fields);

            // Oblicz liczbę użytych skrzynek Legend
            let legendBoxes = 0;
            for (let i = 0; i < 28; i++) { // Pierwsze 28 = Legend
                const collectibleName = collectibleOrder[i];
                const collectible = collectibles[collectibleName];

                if (collectible && collectible.stars > 0) {
                    const stars = collectible.stars;
                    let boxes = 0;

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

                    legendBoxes += boxes;
                }
            }

            embed.addFields({
                name: 'Użyte skrzynki',
                value: `<:J_CollRed:1402533014080065546> ${legendBoxes}`,
                inline: false
            });
        }
    }

    /**
     * Dodaje pola Epic Collectibles do embeda (pola 10-18)
     */
    addEpicCollectibleFields(embed, buildData) {
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

        const { collectibleIcons, collectibleOrder, formatStars } = this.getCollectibleData();

        // Tylko pola 11-18 (Epic) - pomijamy pole 10 z nagłówkiem
        const fields = [];
        for (let fieldNum = 11; fieldNum <= 18; fieldNum++) {
            const fieldItems = [];
            // Mapowanie: pole 11 = pozycje 36-39, pole 12 = pozycje 40-43, itd.
            // Ale Epic zaczyna się od pozycji 36 w collectibleOrder
            const startIndex = 36 + (fieldNum - 11) * 4;

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

            // Oblicz numer setu (1-8)
            const setNumber = fieldNum - 10;

            fields.push({
                name: `<:pusto:1417874543283802143> Set ${setNumber}`,
                value: fieldItems.length > 0 ? fieldItems.join('\n') : '\u200B',
                inline: true
            });
        }

        if (fields.length === 0) {
            embed.addFields({
                name: 'Epic Collectibles',
                value: 'Brak danych o Epic collectibles w tym buildzie.',
                inline: false
            });
        } else {
            embed.addFields(...fields);

            // Dodaj puste pole 9 dla układu
            embed.addFields({
                name: '\u200B',
                value: '\u200B',
                inline: true
            });

            // Oblicz liczbę użytych skrzynek Epic
            let epicBoxes = 0;
            for (let i = 28; i < collectibleOrder.length; i++) { // Od 28+ = Epic
                const collectibleName = collectibleOrder[i];
                const collectible = collectibles[collectibleName];

                if (collectible && collectible.stars > 0) {
                    const stars = collectible.stars;
                    let boxes = 0;

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

                    epicBoxes += boxes;
                }
            }

            embed.addFields({
                name: 'Użyte skrzynki',
                value: `<:J_CollYellow:1402532951492657172> ${epicBoxes}`,
                inline: false
            });
        }
    }

    /**
     * Zwraca dane collectibles (ikony, kolejność, formatowanie)
     */
    getCollectibleData() {
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
            'Dice of Destiny': '<:Coll_dice_of_destiny:1417581282916962427>',
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

        const collectibleOrder = [
            'Human Genome Mapping', 'Book of Ancient Wisdom', 'Immortal Lucky Coin', 'Instellar Transition Matrix Design',
            'Angelic Tear Crystal', 'Unicorn\'s Horn', 'Otherworld Key', 'Starcore Diamond',
            'High-Lat Energy Cube', 'Void Bloom', 'Eye of True Vision', 'Life Hourglass',
            'Nano-Mimetic Mask', 'Dice of Destiny', 'Dimension Foil', 'Mental Sync Helm',
            'Atomic Mech', 'Time Essence Bottle', 'Dragon Tooth', 'Hyper Neuron',
            'Cyber Totem', 'Clone Mirror', 'Dreamscape Puzzle', 'Gene Splicer',
            'Memory Editor', 'Temporal Rewinder', 'Spatial Rewinder', 'Holodream Fluid',
            '', '', '', '',
            '', '', '', '',
            'Golden Cutlery', 'Old Medical Book', 'Savior\'s Memento', 'Safehouse Map',
            'Lucky Charm', 'Scientific Luminary\'s Journal', 'Super Circuit Board', 'Mystical Halo',
            'Tablet of Epics', 'Primordial War Drum', 'Flaming Plume', 'Astral Dewdrop',
            'Nuclear Battery', 'Plasma Sword', 'Golden Horn', 'Elemental Ring',
            'Anti-Gravity Device', 'Hydraulic Flipper', 'Superhuman Pill', 'Comms Conch',
            'Mini Dyson Sphere', 'Micro Artificial Sun', 'Klein Bottle', 'Antiparticle Gourd',
            'Wildfire Furnace', 'Infinity Score', 'Cosmic Compass', 'Wormhole Detector',
            'Shuttle Capsule', 'Neurochip', 'Star-Rail Passenger Card', 'Portable Mech Case',
            '', '', '', ''
        ];

        const formatStars = (stars) => {
            if (stars === 0) return '-';
            if (stars <= 5) return '☆'.repeat(stars);
            return '★'.repeat(stars - 5);
        };

        return { collectibleIcons, collectibleOrder, formatStars };
    }

    /**
     * Oblicza szczegółowe statystyki buildu - wykorzystuje istniejącą funkcję
     */
    calculateBuildStatisticsDetailed(buildData) {
        return this.calculateBuildStatistics(buildData);
    }

    /**
     * Dodaje pola Pets do embeda
     */
    addPetsFields(embed, buildData) {
        let pets = {};

        // Sprawdź różne możliwe struktury
        if (buildData.pet && buildData.pet.data) {
            pets = buildData.pet.data;
        } else if (buildData.pet) {
            pets = buildData.pet;
        } else if (buildData.data && buildData.data.pet && buildData.data.pet.data) {
            pets = buildData.data.pet.data;
        } else if (buildData.data && buildData.data.pet) {
            pets = buildData.data.pet;
        }

        if (!pets || !pets.name || !pets.stars) {
            embed.addFields({
                name: 'Pets',
                value: 'Brak danych o petach w tym buildzie.',
                inline: false
            });
            return;
        }

        // Generowanie gwiazdek
        const stars = pets.stars || 0;
        let starDisplay = '';

        if (stars === 1) {
            starDisplay = '☆';
        } else if (stars === 2) {
            starDisplay = '☆☆';
        } else if (stars === 3) {
            starDisplay = '☆☆☆';
        } else if (stars === 4) {
            starDisplay = '☆☆☆☆';
        } else if (stars === 5) {
            starDisplay = '☆☆☆☆☆';
        } else if (stars === 6) {
            starDisplay = '☆☆☆☆☆\n★';
        } else if (stars === 7) {
            starDisplay = '☆☆☆☆☆\n★★';
        } else if (stars === 8) {
            starDisplay = '☆☆☆☆☆\n★★★';
        } else if (stars === 9) {
            starDisplay = '☆☆☆☆☆\n★★★★';
        } else if (stars === 10) {
            starDisplay = '☆☆☆☆☆\n★★★★★';
        }

        // Oblicz koszty kryształów w zależności od typu peta
        const petName = pets.name || 'Unknown';
        let resourceText = '';

        if (petName === 'Rex' || petName === 'Croaky') {
            // Rex i Croaky - tylko awakening crystals
            const awakeningCosts = [0, 5, 10, 20, 40, 70, 110, 170, 230, 290, 350];
            const awakeningCost = awakeningCosts[stars] || 0;

            if (awakeningCost > 0) {
                resourceText = `\n\n<:awakening_crystal:1417810137459982416> ${awakeningCost}`;
            }
        } else if (petName === 'Puffo' || petName === 'Clucker' || petName === 'Capy') {
            // Puffo, Clucker, Capy - awakening crystals + xeno pet cores
            const awakeningCosts = [0, 10, 30, 70, 130, 190, 250, 310, 370, 430, 490];
            const xenoCosts = [0, 0, 1, 2, 4, 7, 11, 17, 25, 35, 50];

            const awakeningCost = awakeningCosts[stars] || 0;
            const xenoCost = xenoCosts[stars] || 0;

            if (awakeningCost > 0 || xenoCost > 0) {
                resourceText = '\n\n';
                if (awakeningCost > 0) {
                    resourceText += `<:awakening_crystal:1417810137459982416> ${awakeningCost}`;
                }
                if (xenoCost > 0) {
                    if (awakeningCost > 0) resourceText += '\n';
                    resourceText += `<:xeno_pet_core:1417810117163749378> ${xenoCost}`;
                }
            }
        }

        // Pierwsze pole - tylko pet i gwiazdki
        embed.addFields({
            name: `${pets.icon || '❓'} ${pets.name || 'Unknown'}`,
            value: starDisplay || 'Brak gwiazdek',
            inline: true
        });

        // Drugie pole - koszty awakening crystals i xeno cores
        if (resourceText) {
            embed.addFields({
                name: 'Zużyte zasoby',
                value: resourceText.replace(/^\n\n/, ''), // Usuń początkowe nowe linie
                inline: true
            });
        }

        // Trzecie pole - puste
        embed.addFields({
            name: '​', // Invisible character
            value: '​', // Invisible character
            inline: true
        });

        // Czwarte pole - pet skills (nowy rząd)
        const petSkillsText = this.getPetSkillsText(buildData, petName);
        if (petSkillsText) {
            embed.addFields({
                name: `${pets.icon || '❓'} Pet Skills`,
                value: petSkillsText,
                inline: false
            });
        }
    }

    /**
     * Zwraca tekst z Pet Skills
     */
    getPetSkillsText(buildData, petName) {
        let petSkills = {};

        // Sprawdź różne możliwe struktury
        if (buildData.petSkills && buildData.petSkills.data) {
            petSkills = buildData.petSkills.data;
        } else if (buildData.petSkills) {
            petSkills = buildData.petSkills;
        } else if (buildData.data && buildData.data.petSkills && buildData.data.petSkills.data) {
            petSkills = buildData.data.petSkills.data;
        } else if (buildData.data && buildData.data.petSkills) {
            petSkills = buildData.data.petSkills;
        }

        if (!petSkills || Object.keys(petSkills).length === 0) {
            return null; // Brak pet skills - zwróć null
        }

        // Ikony dla pet skills
        const skillIcons = {
            'Motivation': '<:motivation:1417810080207736874>',
            'Inspiration': '<:inspiration:1417810056203730996>',
            'Encouragement': '<:encouragement:1417810034955517982>',
            'Battle Lust': '<:battle_lust:1417810016404246548>',
            'Gary': '<:gary:1417809708043206728>',
            'Sync Rate': '<:sync_rate:1417809974893219902>',
            'Resonance Chance': '<:resonance_chance:1417809949068755094>',
            'Resonance Damage': '<:resonance_damage:1417809758345367562>',
            'Dmg to Weakened': '<:dmg_to_weakened:1417809742528512021>',
            'Dmg to Poisoned': '<:dmg_to_poisoned:1417809726284107886>',
            'Dmg to Chilled': '<:dmg_to_chilled:1418183631901429780>',
            'Shield Damage': '<:shield_damage:1417809918211391600>'
        };

        // Mapowanie rarity na tekst
        const rarityToText = {
            'Excellent': 'Excellent',
            'Advanced': 'Epic',
            'Super': 'Legend'
        };

        let skillsText = '';

        if (petName === 'Rex' || petName === 'Croaky') {
            // Rex i Croaky - wyświetl enabled skills z rarity
            const skillOrder = ['Motivation', 'Inspiration', 'Encouragement', 'Battle Lust', 'Gary'];

            for (const skillName of skillOrder) {
                const skill = petSkills[skillName];
                if (skill && skill.enabled === true) {
                    const icon = skillIcons[skillName] || '❓';
                    const rarity = rarityToText[skill.rarity] || skill.rarity || '';
                    skillsText += `${icon} ${skillName}: ${rarity}\n`;
                }
            }
        } else if (petName === 'Puffo' || petName === 'Clucker' || petName === 'Capy') {
            // Puffo, Clucker, Capy - wyświetl value skills z %
            const skillOrder = ['Sync Rate', 'Resonance Chance', 'Resonance Damage', 'Dmg to Weakened', 'Dmg to Poisoned', 'Dmg to Chilled', 'Shield Damage'];

            for (const skillName of skillOrder) {
                const skill = petSkills[skillName];
                if (skill && skill.value !== undefined) {
                    const icon = skillIcons[skillName] || '❓';
                    skillsText += `${icon} ${skillName}: ${skill.value}%\n`;
                }
            }
        }

        return skillsText.trim() || null;
    }

    /**
     * Dekoduje dane heroes z tablicy
     */
    decodeHeroes(heroesData) {
        // Kolejność heroes w tablicy
        const heroNames = [
            'Common', 'Tsukuyomi', 'Catnips', 'Worm', 'King', 'Wesson', 'Yelena',
            'Master Yang', 'Metalia', 'Joey', 'Taloxa', 'Raphael', 'April',
            'Donatello', 'Splinter', 'Leonardo', 'Michelangelo', 'Squidward',
            'Spongebob', 'Sandy', 'Patrick'
        ];

        const heroIconMap = {
            'Common': '<:common:1418160762618118205>',
            'Tsukuyomi': '<:tsukuyomi:1418161037965922375>',
            'Catnips': '<:catnips:1418160740657004554>',
            'Worm': '<:worm:1418161060854235137>',
            'King': '<:king:1418160820021493790>',
            'Wesson': '<:wesson:1418161045754875934>',
            'Yelena': '<:yelena:1418161077031538709>',
            'Master Yang': '<:master_yang:1418160857019318274>',
            'Metalia': '<:metalia:1418160878519582740>',
            'Joey': '<:joey:1418160801704837252>',
            'Taloxa': '<:taloxa:1418161010094637107>',
            'Raphael': '<:raphael:1418160924899938396>',
            'April': '<:april:1418160722914840719>',
            'Donatello': '<:donatello:1418160783879176213>',
            'Splinter': '<:splinter:1418160960014647316>',
            'Leonardo': '<:leonardo:1418160838552064081>',
            'Michelangelo': '<:michelangelo:1418160892884811918>',
            'Squidward': '<:squidward:1418160994668122253>',
            'Spongebob': '<:spongebob:1418160975747485817>',
            'Sandy': '<:sandy:1418160939588386836>',
            'Patrick': '<:patrick:1418160909544853564>'
        };

        const heroes = {};

        // Przetwarzaj dane heroes jako tablicę
        if (Array.isArray(heroesData)) {
            for (let i = 0; i < heroesData.length && i < heroNames.length; i++) {
                const heroData = heroesData[i];
                const heroName = heroNames[i];
                const heroIcon = heroIconMap[heroName] || '';

                if (heroData && typeof heroData === 'object' && (heroData.r > 0 || heroData.q > 0)) {
                    heroes[heroName] = {
                        name: heroName,
                        icon: heroIcon,
                        stars: heroData.r || 0,  // 'r' to stars
                        level: heroData.q || null  // 'q' to level
                    };
                }
            }
        }

        return heroes;
    }

    /**
     * Dekoduje dane meta z obiektu
     */
    decodeMeta(metaData) {
        // Kolejność heroes dla mapowania indeksów
        const heroNames = [
            'Common', 'Tsukuyomi', 'Catnips', 'Worm', 'King', 'Wesson', 'Yelena',
            'Master Yang', 'Metalia', 'Joey', 'Taloxa', 'Raphael', 'April',
            'Donatello', 'Splinter', 'Leonardo', 'Michelangelo', 'Squidward',
            'Spongebob', 'Sandy', 'Patrick'
        ];

        const meta = {
            synergy: metaData.b === 1,  // b = synergy (boolean)
            synergyLevel: metaData.g || 0,  // g = synergyLevel
            mainHero: heroNames[metaData.c - 1] || 'Unknown',  // c = mainHero (indeks - 1)
            harmonyL: heroNames[metaData.d - 1] || 'Unknown',  // d = harmonyL (indeks - 1)
            harmonyR: heroNames[metaData.e - 1] || 'Unknown',  // e = harmonyR (indeks - 1)
            teamwork: [],  // f = teamwork (tablica indeksów)
            gameMode: this.decodeGameMode(metaData.I),  // I = gameMode
            originalGameMode: metaData.I,  // Zachowaj oryginalną wartość przed dekodowaniem
            lmeTestaments: metaData.J || 0,  // J = lmeTestaments
            eeSkills: metaData.K || []  // K = eeSkills
        };

        // Dekoduj teamwork (f - tablica indeksów)
        if (Array.isArray(metaData.f)) {
            meta.teamwork = metaData.f.map(index => heroNames[index - 1] || 'Unknown');
        }

        return meta;
    }

    /**
     * Oblicza tylko AW (totalCore) na podstawie bohaterów i synergii dla strony Start
     */
    calculateAWFromSurvivor(buildData) {
        let totalCore = 0;

        // Definicje grup bohaterów (kopiowane z calculateCoreAndPuzzle)
        const group1Heroes = ['Common', 'King', 'Yelena', 'Tsukuyomi', 'Catnips', 'Worm', 'Wesson'];
        const group2Heroes = ['Master Yang', 'Metalia', 'Joey', 'Taloxa'];
        const group3Heroes = ['Raphael', 'Leonardo', 'Donatello', 'Michelangelo', 'April', 'Splinter'];

        // Tabele konwersji Core dla grup 1 i 2 (kopiowane z calculateCoreAndPuzzle)
        const coreTableGroup1 = {
            7: 1, 8: 3, 9: 6, 10: 11, 11: 18, 12: 30
        };
        const coreTableGroup2 = {
            7: 1, 8: 3, 9: 7, 10: 15, 11: 30, 12: 60
        };

        // Tabela synergii (kopiowane z calculateCoreAndPuzzle)
        const synergyTable = {
            5: { core: 3, puzzle: 50 },
            10: { core: 6, puzzle: 130 },
            15: { core: 11, puzzle: 280 },
            20: { core: 16, puzzle: 480 },
            25: { core: 24, puzzle: 730 },
            30: { core: 32, puzzle: 1030 },
            35: { core: 40, puzzle: 1380 },
            40: { core: 48, puzzle: 1780 },
            45: { core: 63, puzzle: 2280 },
            50: { core: 78, puzzle: 2880 },
            55: { core: 93, puzzle: 3580 },
            60: { core: 108, puzzle: 4380 }
        };

        // Przetwarzaj bohaterów (kopiowane z calculateCoreAndPuzzle)
        if (buildData.heroes) {
            for (const [heroName, heroData] of Object.entries(buildData.heroes)) {
                const stars = heroData.stars || 0;

                if (group1Heroes.includes(heroName)) {
                    // Grupa 1: tylko Core dla 7-12 gwiazdek
                    if (stars >= 7 && stars <= 12) {
                        totalCore += coreTableGroup1[stars] || 0;
                    }
                } else if (group2Heroes.includes(heroName)) {
                    // Grupa 2: Core dla 7-12 gwiazdek
                    if (stars >= 7 && stars <= 12) {
                        totalCore += coreTableGroup2[stars] || 0;
                    }
                } else if (group3Heroes.includes(heroName)) {
                    // Grupa 3: 1 Core za każdą gwiazdkę od 7 do 12
                    if (stars >= 7 && stars <= 12) {
                        totalCore += (stars - 6); // 7 gwiazdek = 1 Core, 8 = 2, itd.
                    }
                }
            }
        }

        // Dodaj Core z synergii (kopiowane z calculateCoreAndPuzzle)
        if (buildData.meta && buildData.meta.synergyLevel) {
            const synergyLevel = buildData.meta.synergyLevel;
            const synergyBonus = synergyTable[synergyLevel];
            if (synergyBonus) {
                totalCore += synergyBonus.core;
            }
        }

        return totalCore;
    }

    /**
     * Oblicza tylko ilość Chip na podstawie danych z Tech Party dla strony Start
     */
    calculateChipFromTechParty(buildData) {
        // Szukaj danych w różnych miejscach (synchronizowane z addResourcesField)
        let resourceData = null;
        let chipCount = 0;

        // Nowy format z data.inputs i data.chips
        if (buildData.rawData && buildData.rawData.X && buildData.rawData.X.data) {
            resourceData = buildData.rawData.X.data;
            chipCount = resourceData.chips || 0;
        } else if (buildData.X && buildData.X.data) {
            resourceData = buildData.X.data;
            chipCount = resourceData.chips || 0;
        } else if (buildData.X && buildData.X.inputs && buildData.X.chips !== undefined) {
            // Nowy format bezpośrednio w X
            resourceData = buildData.X;
            chipCount = resourceData.chips || 0;
        }
        // Stary format z U
        else if (buildData.rawData && buildData.rawData.X) {
            resourceData = buildData.rawData.X;
            chipCount = resourceData.U || 0;
        } else if (buildData.X) {
            resourceData = buildData.X;
            chipCount = resourceData.U || 0;
        }

        return chipCount;
    }

    /**
     * Oblicza tylko ilość Xeno Pet Core na podstawie danych z Pets dla strony Start
     */
    calculateXenoCoreFromPets(buildData) {
        let pets = {};

        // Sprawdź różne możliwe struktury (kopiowane z addPetsFields)
        if (buildData.pet && buildData.pet.data) {
            pets = buildData.pet.data;
        } else if (buildData.pet) {
            pets = buildData.pet;
        } else if (buildData.data && buildData.data.pet && buildData.data.pet.data) {
            pets = buildData.data.pet.data;
        } else if (buildData.data && buildData.data.pet) {
            pets = buildData.data.pet;
        }

        if (!pets || !pets.name || !pets.stars) {
            return 0;
        }

        const petName = pets.name || 'Unknown';
        const stars = pets.stars || 0;

        // Tylko Puffo, Clucker, Capy używają xeno pet cores (kopiowane z addPetsFields)
        if (petName === 'Puffo' || petName === 'Clucker' || petName === 'Capy') {
            const xenoCosts = [0, 0, 1, 2, 4, 7, 11, 17, 25, 35, 50];
            const xenoCost = xenoCosts[stars] || 0;
            return xenoCost;
        }

        return 0;
    }

    /**
     * Oblicza Core i Puzzle na podstawie bohaterów i synergii oraz wyświetla synergie
     */
    calculateCoreAndPuzzle(buildData, meta) {
        let totalCore = 0;
        let totalPuzzle = 0;

        // Definicje grup bohaterów
        const group1Heroes = ['Common', 'King', 'Yelena', 'Tsukuyomi', 'Catnips', 'Worm', 'Wesson'];
        const group2Heroes = ['Master Yang', 'Metalia', 'Joey', 'Taloxa'];
        const group3Heroes = ['Raphael', 'Leonardo', 'Donatello', 'Michelangelo', 'April', 'Splinter'];

        // Tabele konwersji Core dla grup 1 i 2
        const coreTableGroup1 = {
            7: 1, 8: 3, 9: 6, 10: 11, 11: 18, 12: 30
        };
        const coreTableGroup2 = {
            7: 1, 8: 3, 9: 7, 10: 15, 11: 30, 12: 60
        };

        // Tabela konwersji Puzzle (tylko dla grupy 2)
        const puzzleTable = {
            1: 0, 2: 40, 3: 120, 4: 240, 5: 440, 6: 840,
            7: 1040, 8: 1290, 9: 1590, 10: 1940, 11: 2340, 12: 2840
        };

        // Tabela synergii
        const synergyTable = {
            5: { core: 3, puzzle: 50 },
            10: { core: 6, puzzle: 130 },
            15: { core: 11, puzzle: 280 },
            20: { core: 16, puzzle: 480 },
            25: { core: 24, puzzle: 730 },
            30: { core: 32, puzzle: 1030 },
            35: { core: 40, puzzle: 1380 },
            40: { core: 48, puzzle: 1780 },
            45: { core: 63, puzzle: 2280 },
            50: { core: 78, puzzle: 2880 },
            55: { core: 93, puzzle: 3580 },
            60: { core: 108, puzzle: 4380 }
        };

        // Przetwarzaj bohaterów
        if (buildData.heroes) {
            for (const [heroName, heroData] of Object.entries(buildData.heroes)) {
                const stars = heroData.stars || 0;

                if (group1Heroes.includes(heroName)) {
                    // Grupa 1: tylko Core dla 7-12 gwiazdek
                    if (stars >= 7 && stars <= 12) {
                        totalCore += coreTableGroup1[stars] || 0;
                    }
                } else if (group2Heroes.includes(heroName)) {
                    // Grupa 2: Core dla 7-12 gwiazdek + Puzzle dla 1-12 gwiazdek
                    if (stars >= 7 && stars <= 12) {
                        totalCore += coreTableGroup2[stars] || 0;
                    }
                    if (stars >= 1 && stars <= 12) {
                        totalPuzzle += puzzleTable[stars] || 0;
                    }
                } else if (group3Heroes.includes(heroName)) {
                    // Grupa 3: 1 Core za każdą gwiazdkę od 7 do 12
                    if (stars >= 7 && stars <= 12) {
                        totalCore += (stars - 6); // 7 gwiazdek = 1 Core, 8 = 2, itd.
                    }
                }
            }
        }

        // Dodaj Core i Puzzle z synergii
        if (buildData.meta && buildData.meta.synergyLevel) {
            const synergyLevel = buildData.meta.synergyLevel;
            const synergyBonus = synergyTable[synergyLevel];
            if (synergyBonus) {
                totalCore += synergyBonus.core;
                totalPuzzle += synergyBonus.puzzle;
            }
        }

        // Formatuj wynik - Core i Puzzle na górze, synergia na dole
        let result = '';

        // Core i Puzzle
        if (totalCore > 0) {
            result += `<:I_AW:1418241339497250928> ${totalCore}`;
        }
        if (totalPuzzle > 0) {
            if (result) result += '\n';
            result += `<:I_PandaShard:1418241395524767877> ${totalPuzzle}`;
        }

        // Synergia - zawsze pokazuj nagłówek
        if (result) result += '\n\n';
        result += `**Synergia**\n`;

        if (meta && meta.synergy && meta.synergyLevel > 0) {
            result += `<:lvl:1418173754692997130> ${meta.synergyLevel}`;
        } else {
            result += '-';
        }

        return result || '\u200B';
    }

    /**
     * Dekoduje gameMode z kodu
     */
    decodeGameMode(code) {
        const gameModeMap = {
            'ee': 'lme1',
            'lme': 'lme1',
            'daily': 'daily',
            'cx': 'cx'
        };
        return gameModeMap[code] || code || 'unknown';
    }

    /**
     * Pobiera ikonę hero na podstawie nazwy
     */
    getHeroIcon(heroName) {
        const heroIconMap = {
            'Common': '<:common:1418160762618118205>',
            'Tsukuyomi': '<:tsukuyomi:1418161037965922375>',
            'Catnips': '<:catnips:1418160740657004554>',
            'Worm': '<:worm:1418161060854235137>',
            'King': '<:king:1418160820021493790>',
            'Wesson': '<:wesson:1418161045754875934>',
            'Yelena': '<:yelena:1418161077031538709>',
            'Master Yang': '<:master_yang:1418160857019318274>',
            'Metalia': '<:metalia:1418160878519582740>',
            'Joey': '<:joey:1418160801704837252>',
            'Taloxa': '<:taloxa:1418161010094637107>',
            'Raphael': '<:raphael:1418160924899938396>',
            'April': '<:april:1418160722914840719>',
            'Donatello': '<:donatello:1418160783879176213>',
            'Splinter': '<:splinter:1418160960014647316>',
            'Leonardo': '<:leonardo:1418160838552064081>',
            'Michelangelo': '<:michelangelo:1418160892884811918>',
            'Squidward': '<:squidward:1418160994668122253>',
            'Spongebob': '<:spongebob:1418160975747485817>',
            'Sandy': '<:sandy:1418160939588386836>',
            'Patrick': '<:patrick:1418160909544853564>'
        };
        return heroIconMap[heroName] || '';
    }

    /**
     * Formatuje gwiazdki zgodnie z wymaganiami
     */
    formatStars(stars) {
        if (stars <= 6) {
            return '☆'.repeat(stars);
        } else if (stars <= 12) {
            const baseStars = '☆'.repeat(6);
            const extraStars = '★'.repeat(stars - 6);
            return baseStars + '\n' + ' '.repeat(4) + extraStars;
        }
        return '☆'.repeat(6) + '\n' + ' '.repeat(4) + '★'.repeat(6);
    }

    /**
     * Dodaje pole "Zużyte kluczowe zasoby" do strony Start
     */
    async addStartResourcesField(embed, buildData) {
        const resourceLines = [];

        try {
            // 1. RC z zakładki Ekwipunek (taka sama logika jak w linii 887)
            const stats = this.calculateBuildStatistics(buildData);
            if (stats && stats.totalPower && stats.totalPower > 0) {
                resourceLines.push(`<:II_RC:1385139885924421653> ${stats.totalPower}`);
            }

            // 2. AW z zakładki Survivor (logika z calculateCoreAndPuzzle)
            const awAmount = this.calculateAWFromSurvivor(buildData);
            if (awAmount > 0) {
                resourceLines.push(`<:I_AW:1418241339497250928> ${awAmount}`);
            }

            // 3. Chip z zakładki Tech Party (logika z addResourcesField)
            const chipAmount = this.calculateChipFromTechParty(buildData);
            if (chipAmount > 0) {
                resourceLines.push(`<:I_Chip:1418559789939822723> ${chipAmount}`);
            }

            // 4. Xeno Pet Core z zakładki Pets (logika z addPetsFields)
            const xenoCoreAmount = this.calculateXenoCoreFromPets(buildData);
            if (xenoCoreAmount > 0) {
                resourceLines.push(`<:xeno_pet_core:1417810117163749378> ${xenoCoreAmount}`);
            }

            // Dodaj pole tylko jeśli są jakiekolwiek zasoby
            if (resourceLines.length > 0) {
                embed.addFields({
                    name: 'Zużyte kluczowe zasoby',
                    value: resourceLines.join('\n'),
                    inline: false
                });
            }

        } catch (error) {
            // Cicha obsługa błędów - nie dodawaj pola jeśli wystąpi błąd
        }
    }
}

module.exports = SurvivorService;