const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'EndersEcho', 'data', 'guild_configs.json');

const raw = fs.readFileSync(configPath, 'utf8');
const configs = JSON.parse(raw);

let changed = 0;
for (const [guildId, cfg] of Object.entries(configs)) {
    if (cfg.topRoles !== null && cfg.topRoles !== undefined) {
        console.log(`[${guildId}] topRoles: ${JSON.stringify(cfg.topRoles)} → null`);
        cfg.topRoles = null;
        changed++;
    } else {
        console.log(`[${guildId}] topRoles już null — pomijam`);
    }
}

fs.writeFileSync(configPath, JSON.stringify(configs, null, 2), 'utf8');
console.log(`\nGotowe. Zmodyfikowano ${changed} serwerów.`);
