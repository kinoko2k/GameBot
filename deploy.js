const { REST, Routes } = require('discord.js');
const { applicationId, token, guildIds } = require('./config.json');
const fs = require('fs');
const path = require('path');

const guildCommands = [
    require('./commands/bot/about.js').data.toJSON(),
    require('./commands/tools/gameinvite.js').data.toJSON(),
    require('./commands/minecraft/mcid.js').data.toJSON(),
];

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        for (const guildId of guildIds) {
            console.log(`ギルドコマンドを登録中（Guild ID: ${guildId}）...`);
            await rest.put(
                Routes.applicationGuildCommands(applicationId, guildId),
                { body: guildCommands },
            );
            console.log(`ギルドコマンドが登録されました！（Guild ID: ${guildId}）`);
        }
    } catch (error) {
        console.error('コマンドの登録中にエラーが発生しました:', error);
    }
})();