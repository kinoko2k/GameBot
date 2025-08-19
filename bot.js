const {
    Client,
    Events,
    GatewayIntentBits,
    SimpleShardingStrategy,
    EmbedBuilder,
    Partials,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    Collection,
    ModalSubmitInteraction,
    TextInputComponent,
} = require("discord.js");
const { token } = require("./config.json");
const fs = require("fs");
const path = require("path");

const commands = [
    require("./commands/bot/about.js"),
];

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.once(Events.ClientReady, async (c) => {
    console.log(`準備OKです! ${c.user.tag}がログインします。`);
});

client.commands = new Collection();
client.contextMenus = [];

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand() || interaction.isUserContextMenuCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(error);
            if (!interaction.replied) {
                await interaction.reply({ content: 'コマンドの実行中にエラーが発生しました。', ephemeral: true });
            }
        }
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (
        !interaction.isChatInputCommand() &&
        !interaction.isMessageContextMenuCommand()
    )
        return;

    const command = commands
        .filter(cmd => cmd && cmd.data)
        .find(cmd => cmd.data.name === interaction.commandName);


    if (command) {
        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({
                    content: "コマンド実行時にエラーになりました。",
                    ephemeral: true,
                });
            } else {
                await interaction.reply({
                    content: "コマンド実行時にエラーになりました。",
                    ephemeral: true,
                });
            }
        }
    } else {
        console.error(
            `${interaction.commandName}というコマンドには対応していません。`
        );
    }
});

client.login(token);