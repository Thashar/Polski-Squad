const fs = require('fs').promises;
const path = require('path');

/**
 * Skrypt migracji ról z ENV do special_roles.json
 */
async function migrateRolesFromEnv() {
    try {
        console.log('🔄 Rozpoczynam migrację ról z ENV do pliku special_roles.json...');
        
        // Role z pliku ENV (aktualne)
        const envRoles = [
            '1253443506664509460',
            '1368694965244526724', 
            '1384606143296569384',
            '1214545429572755506',
            '1358519032130703633',
            '1384602562627502180',
            '1213231669843066880',
            '1344493329475174432',
            '1356893847820566538',
            '1214553572352593950',
            '1291841958859378779',
            '1347580239374581760',
            '1361288225439875072',
            '1356899230148464660',
            '1386417255990034593',
            '1387366857195126804',
            '1388803877247254548'
        ];
        
        const specialRolesFile = './Muteusz/data/special_roles.json';
        
        // Upewnij się, że katalog istnieje
        const dir = path.dirname(specialRolesFile);
        await fs.mkdir(dir, { recursive: true });
        
        // Sprawdź czy plik już istnieje
        let existingRoles = [];
        try {
            const data = await fs.readFile(specialRolesFile, 'utf8');
            const parsed = JSON.parse(data);
            existingRoles = parsed.roles || [];
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error('❌ Błąd odczytu istniejącego pliku:', error.message);
            }
        }
        
        // Połącz role (usuń duplikaty)
        const allRoles = [...new Set([...existingRoles, ...envRoles])];
        
        // Utwórz nowy plik
        const data = {
            roles: allRoles,
            lastModified: new Date().toISOString(),
            version: "1.0",
            migratedFromEnv: true,
            migrationDate: new Date().toISOString(),
            originalEnvRoles: envRoles
        };
        
        await fs.writeFile(specialRolesFile, JSON.stringify(data, null, 2), 'utf8');
        
        console.log(`✅ Migracja zakończona pomyślnie!`);
        console.log(`📊 Statystyki migracji:`);
        console.log(`   - Role z ENV: ${envRoles.length}`);
        console.log(`   - Istniejące role specjalne: ${existingRoles.length}`);
        console.log(`   - Łączna liczba ról: ${allRoles.length}`);
        console.log(`   - Duplikaty usunięte: ${(envRoles.length + existingRoles.length) - allRoles.length}`);
        
        return {
            success: true,
            envRoles: envRoles.length,
            existingRoles: existingRoles.length,
            totalRoles: allRoles.length,
            duplicatesRemoved: (envRoles.length + existingRoles.length) - allRoles.length
        };
        
    } catch (error) {
        console.error('❌ Błąd podczas migracji:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

// Eksportuj funkcję migracji
module.exports = {
    migrateRolesFromEnv
};

// Jeśli skrypt jest uruchamiany bezpośrednio
if (require.main === module) {
    migrateRolesFromEnv().then(result => {
        if (result.success) {
            console.log('🎉 Migracja zakończona sukcesem!');
            process.exit(0);
        } else {
            console.error('💥 Migracja nie powiodła się:', result.error);
            process.exit(1);
        }
    });
}