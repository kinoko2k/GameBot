const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mcidcheck')
        .setDescription('MCIDの情報を取得します。')
        .addStringOption(option =>
            option.setName('mcid')
                .setDescription('Minecraft ID')
                .setRequired(true)),
    async execute(interaction) {
        const mcid = interaction.options.getString('mcid');

        try {
            const response = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${mcid}`);
            const data = response.data;

            if (!data) {
                await interaction.reply('MCIDが見つかりませんでした。');
                return;
            }

            const uuid = data.id;

            const page1Embed = new EmbedBuilder()
                .setTitle('MCID checker')
                .addFields(
                    { name: 'MCID', value: data.name },
                    { name: 'UUID', value: uuid },
                    { name: 'プレイヤーの頭を取得する', value: '```' + `/give @p minecraft:player_head{SkullOwner:"${data.name}"}` + '```' }
                );

            const page2Embed = new EmbedBuilder()
                .setTitle('MCID checker')
                .setThumbnail(`https://mc-heads.net/avatar/${data.name}`)
                .setImage(`https://mc-heads.net/player/${data.name}`);

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('previousPage')
                        .setLabel('MCID')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('nextPage')
                        .setLabel('Skin')
                        .setStyle(ButtonStyle.Primary)
                );

            await interaction.reply({ embeds: [page1Embed], components: [row] });

            const filter = i => ['nextPage', 'previousPage'].includes(i.customId) && i.user.id === interaction.user.id;
            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });

            collector.on('collect', async i => {
                if (i.customId === 'nextPage') {
                    await i.update({ embeds: [page2Embed], components: [row] });
                } else if (i.customId === 'previousPage') {
                    await i.update({ embeds: [page1Embed], components: [row] });
                }
            });

        } catch (error) {
            console.error('Error occurred:', error);
            await interaction.reply('エラーが発生しました。');
        }
    },
};