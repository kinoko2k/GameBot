const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType
} = require('discord.js');
const dayjs = require('dayjs');
const timezone = require('dayjs/plugin/timezone');
const utc = require('dayjs/plugin/utc');
const config = require('../../config.json');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault('Asia/Tokyo');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gameinvite')
    .setDescription('ゲームへの招待を送ります。')
    .addStringOption(opt =>
      opt.setName('title').setDescription('ゲーム名').setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('人数')
        .setDescription('募集人数')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(500))
    .addStringOption(opt =>
      opt.setName('時間').setDescription('開始時刻 (例: 21:35 または 12/25 21:35)').setRequired(true)),

  async execute(interaction) {
    let title = interaction.options.getString('title');
    let maxPlayers = interaction.options.getInteger('人数');
    let timeStr = interaction.options.getString('時間');

    const authorId = interaction.user.id;
    const authorNickname = interaction.member?.nickname || interaction.user.username;
    const createdAt = dayjs().tz().format('YYYY-MM-DD HH:mm:ss');

    let startTime;
    let timestamp;
    let msUntilStart;
    const participants = [];
    let isCancelled = false;

    let message;
    let collector;
    let gameStartTimeoutId;

    function calculateStartTimeDetails() {
      const now = dayjs().tz();

      if (/^\d{1,2}\/\d{1,2} \d{1,2}:\d{2}$/.test(timeStr)) {
        const [datePart, timePart] = timeStr.split(' ');
        const [month, day] = datePart.split('/').map(Number);
        const [hour, minute] = timePart.split(':').map(Number);

        if (isNaN(month) || isNaN(day) || isNaN(hour) || isNaN(minute) ||
          month < 1 || month > 12 || day < 1 || day > 31 ||
          hour < 0 || hour > 23 || minute < 0 || minute > 59) {
          startTime = dayjs().tz().add(1, 'hour');
        } else {
          const currentYear = now.year();
          startTime = dayjs().tz().year(currentYear).month(month - 1).date(day).hour(hour).minute(minute).second(0).millisecond(0);

          if (startTime.isBefore(now)) {
            startTime = startTime.add(1, 'year');
          }
        }
      }
      else if (/^\d{1,2}:\d{2}$/.test(timeStr)) {
        const timeParts = timeStr.split(':');
        if (timeParts.length !== 2) {
          startTime = dayjs().tz().add(1, 'hour');
        } else {
          const [hour, minute] = timeParts.map(Number);
          if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
            startTime = dayjs().tz().add(1, 'hour');
          } else {
            startTime = dayjs().tz().hour(hour).minute(minute).second(0).millisecond(0);

            if (startTime.isBefore(now)) {
              startTime = startTime.add(1, 'day');
            }
          }
        }
      }
      else {
        startTime = dayjs().tz().add(1, 'hour');
      }

      timestamp = startTime.unix();
      msUntilStart = startTime.diff(now);
    }

    if (!/^\d{1,2}:\d{2}$/.test(timeStr) && !/^\d{1,2}\/\d{1,2} \d{1,2}:\d{2}$/.test(timeStr)) {
      await interaction.reply({ content: '時間の形式が不正です。(HH:MM または MM/DD HH:MM)', ephemeral: true });
      return;
    }
    calculateStartTimeDetails();

    if (msUntilStart <= 0 && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '指定された時間が過去または不正です。', ephemeral: true });
      return;
    }


    const mainEmbed = new EmbedBuilder()
      .setColor(0x0099FF)
      .setFooter({ text: `募集者: ${authorNickname}` });

    const joinButton = new ButtonBuilder()
      .setCustomId('join_game')
      .setLabel('参加')
      .setStyle(ButtonStyle.Success);

    const leaveButton = new ButtonBuilder()
      .setCustomId('leave_game')
      .setLabel('退出')
      .setStyle(ButtonStyle.Danger);

    const cancelButton = new ButtonBuilder()
      .setCustomId('cancel_game')
      .setLabel('募集終了')
      .setStyle(ButtonStyle.Secondary);

    const editButton = new ButtonBuilder()
      .setCustomId('edit_game')
      .setLabel('編集')
      .setStyle(ButtonStyle.Primary);

    function createActionRow(buttonsDisabled = false) {
      const currentJoinButton = ButtonBuilder.from(joinButton)
        .setDisabled(buttonsDisabled || participants.length >= maxPlayers);
      const currentLeaveButton = ButtonBuilder.from(leaveButton).setDisabled(buttonsDisabled);
      const currentCancelButton = ButtonBuilder.from(cancelButton).setDisabled(buttonsDisabled);
      const currentEditButton = ButtonBuilder.from(editButton).setDisabled(buttonsDisabled || isCancelled);

      return new ActionRowBuilder().addComponents(currentJoinButton, currentLeaveButton, currentCancelButton, currentEditButton);
    }

    function updateEmbed() {
      const participantList = participants.length > 0
        ? participants.map(p => `<@${p.id}>`).join('\n')
        : 'なし';

      mainEmbed.setTitle(title)
        .setDescription(`募集人数: **${maxPlayers}人**（${participants.length}/${maxPlayers}）\n開始時間: <t:${timestamp}:F> (<t:${timestamp}:R>)`)
        .setFields([])
        .addFields({ name: '参加者リスト', value: participantList });

      if (isCancelled) {
        mainEmbed.addFields({ name: 'ステータス', value: '❌ 募集はキャンセルされました。' });
        mainEmbed.setColor(0x808080);
      } else {
        mainEmbed.setColor(0x0099FF);
      }
    }

    updateEmbed();
    try {
      message = await interaction.reply({
        embeds: [mainEmbed],
        components: [createActionRow()],
        fetchReply: true
      });
    } catch (error) {
      console.error("Failed to send initial reply:", error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.followUp({ content: 'メッセージの送信に失敗しました。', ephemeral: true }).catch(console.error);
      }
      return;
    }

    function setupCollectorAndTimeout() {
      if (collector && !collector.ended) {
        collector.stop('recreating');
      }
      if (gameStartTimeoutId) {
        clearTimeout(gameStartTimeoutId);
      }

      const collectorTime = msUntilStart > 0 ? msUntilStart : 1;

      collector = message.createMessageComponentCollector({
        time: collectorTime
      });

      collector.on('collect', async i => {
        const userId = i.user.id;

        if (i.customId === 'edit_game') {
          if (userId !== authorId) {
            await i.reply({ content: 'このボタンは募集者のみが使用できます。', ephemeral: true });
            return;
          }
          if (isCancelled) {
            await i.reply({ content: 'この募集はキャンセルされているため編集できません。', ephemeral: true });
            return;
          }

          const modal = new ModalBuilder()
            .setCustomId(`edit_game_modal_${message.id}_${Date.now()}`)
            .setTitle('ゲーム募集内容の編集');

          const titleInput = new TextInputBuilder()
            .setCustomId('edit_title_input')
            .setLabel('ゲーム名')
            .setStyle(TextInputStyle.Short)
            .setValue(title)
            .setRequired(true);

          const maxPlayersInput = new TextInputBuilder()
            .setCustomId('edit_max_players_input')
            .setLabel('募集人数 (1-500)')
            .setStyle(TextInputStyle.Short)
            .setValue(maxPlayers.toString())
            .setRequired(true);

          const timeInput = new TextInputBuilder()
            .setCustomId('edit_time_input')
            .setLabel('開始時間 (HH:MM または MM/DD HH:MM)')
            .setStyle(TextInputStyle.Short)
            .setValue(timeStr)
            .setPlaceholder('例: 21:35 または 12/25 21:35')
            .setRequired(true);

          modal.addComponents(
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(maxPlayersInput),
            new ActionRowBuilder().addComponents(timeInput)
          );
          await i.showModal(modal);

          try {
            const modalSubmitInteraction = await i.awaitModalSubmit({
              time: 120000,
              filter: mInteraction => mInteraction.customId === modal.data.custom_id && mInteraction.user.id === authorId,
            }).catch(() => null);

            if (!modalSubmitInteraction) {
              return;
            }

            const newTitle = modalSubmitInteraction.fields.getTextInputValue('edit_title_input');
            const newMaxPlayersStr = modalSubmitInteraction.fields.getTextInputValue('edit_max_players_input');
            const newTimeStr = modalSubmitInteraction.fields.getTextInputValue('edit_time_input');

            const newMaxPlayers = parseInt(newMaxPlayersStr, 10);
            if (isNaN(newMaxPlayers) || newMaxPlayers < 1 || newMaxPlayers > 500) {
              await modalSubmitInteraction.reply({ content: '募集人数の値が不正です。(1-500の範囲で入力してください)', ephemeral: true });
              return;
            }
            if (!/^\d{1,2}:\d{2}$/.test(newTimeStr) && !/^\d{1,2}\/\d{1,2} \d{1,2}:\d{2}$/.test(newTimeStr)) {
              await modalSubmitInteraction.reply({ content: '時間の形式が不正です。(HH:MM または MM/DD HH:MM形式で入力してください)', ephemeral: true });
              return;
            }
            const [newHour, newMinute] = newTimeStr.split(':').map(Number);
            if (isNaN(newHour) || isNaN(newMinute) || newHour < 0 || newHour > 23 || newMinute < 0 || newMinute > 59) {
              await modalSubmitInteraction.reply({ content: '時間の値が不正です。(時:0-23, 分:0-59)', ephemeral: true });
              return;
            }

            const tempTimeStr = timeStr;
            timeStr = newTimeStr;
            const oldMsUntilStart = msUntilStart;
            calculateStartTimeDetails();

            if (msUntilStart <= 0) {
              timeStr = tempTimeStr;
              calculateStartTimeDetails();
              msUntilStart = oldMsUntilStart;
              await modalSubmitInteraction.reply({ content: '指定された開始時間が過去の時刻です。時間は更新されませんでした。タイトルと人数は更新されます。', ephemeral: true });
            } else {
              await modalSubmitInteraction.deferUpdate();
            }

            title = newTitle;
            maxPlayers = newMaxPlayers;

            if (collector) collector.stop('edited');
            if (gameStartTimeoutId) clearTimeout(gameStartTimeoutId);

            updateEmbed();
            await message.edit({ embeds: [mainEmbed], components: [createActionRow()] });

            setupCollectorAndTimeout();

          } catch (error) {
            console.error('モーダル処理エラー:', error);
            if (error.code === 'InteractionCollectorError') {
            } else if (modalSubmitInteraction && !modalSubmitInteraction.replied && !modalSubmitInteraction.deferred) {
              await modalSubmitInteraction.reply({ content: '編集処理中にエラーが発生しました。', ephemeral: true }).catch(console.error);
            } else if (modalSubmitInteraction && modalSubmitInteraction.replied && !modalSubmitInteraction.deferred) {
              await modalSubmitInteraction.followUp({ content: '編集処理中にエラーが発生しました。', ephemeral: true }).catch(console.error);
            }
          }
          return;
        }


        if (isCancelled) {
          await i.reply({ content: 'この募集はすでに終了/キャンセルされています。', ephemeral: true });
          return;
        }

        switch (i.customId) {
          case 'join_game':
            if (participants.find(p => p.id === userId)) {
              await i.reply({ content: 'すでに参加しています。', ephemeral: true });
            } else if (participants.length >= maxPlayers) {
              await i.reply({ content: '募集定員に達しています。', ephemeral: true });
            } else {
              participants.push({ id: userId, tag: i.user.tag });
              updateEmbed();
              await i.update({ embeds: [mainEmbed], components: [createActionRow()] });
            }
            break;
          case 'leave_game':
            const participantIndex = participants.findIndex(p => p.id === userId);
            if (participantIndex === -1) {
              await i.reply({ content: 'まだ参加していません。', ephemeral: true });
            } else {
              participants.splice(participantIndex, 1);
              updateEmbed();
              await i.update({ embeds: [mainEmbed], components: [createActionRow()] });
            }
            break;
          case 'cancel_game':
            if (userId !== authorId) {
              await i.reply({ content: 'このボタンは募集者のみが使用できます。', ephemeral: true });
            } else {
              isCancelled = true;
              if (collector) collector.stop('cancelled_by_user');
              if (gameStartTimeoutId) clearTimeout(gameStartTimeoutId);
              updateEmbed();
              await i.update({ embeds: [mainEmbed], components: [createActionRow(true)] });
            }
            break;
        }
      });

      collector.on('end', async (collected, reason) => {
        if (reason === 'recreating' || reason === 'edited' || reason === 'cancelled_by_user') {
          return;
        }
        updateEmbed();
        await message.edit({ embeds: [mainEmbed], components: [createActionRow(true)] }).catch(console.error);
      });

      gameStartTimeoutId = setTimeout(async () => {
        if (isCancelled) return;

        updateEmbed();
        await message.edit({ embeds: [mainEmbed], components: [createActionRow(true)] }).catch(console.error);

        const logChannelIds = Array.isArray(config.logChannelIds) ? config.logChannelIds : (config.logChannelIds ? [config.logChannelIds] : []);

        if (logChannelIds.length === 0 || (logChannelIds.length === 1 && (logChannelIds[0] === 'YOUR_LOG_CHANNEL_ID' || !logChannelIds[0]))) {
          console.warn("警告: ログチャンネルIDが設定されていないか、無効です。config.jsonの'logChannelIds'を確認してください。ログは送信されません。");
        } else {
          const logEmbed = new EmbedBuilder()
            .setTitle(`ゲーム募集結果: ${title}`)
            .setDescription(`**参加者 (${participants.length}名):**\n${participants.length > 0 ? participants.map(p => `<@${p.id}>`).join('\n') : 'なし'}`)
            .addFields({ name: '募集ID', value: message.id })
            .setColor(participants.length > 0 ? 0x00FF00 : 0xFF0000)
            .setTimestamp();

          for (const id of logChannelIds) {
            if (id === 'YOUR_LOG_CHANNEL_ID' || !id) {
              console.warn(`警告: 無効なログチャンネルID '${id}' が含まれています。このIDへのログ送信はスキップされます。`);
              continue;
            }
            try {
              const logChannel = await interaction.client.channels.fetch(id);
              if (logChannel && logChannel.type === ChannelType.GuildText) {
                await logChannel.send({ embeds: [logEmbed] });
              } else {
                console.warn(`警告: ログチャンネル (ID: ${id}) が見つからないか、テキストチャンネルではありません。`);
              }
            } catch (err) {
              console.error(`ログチャンネル (ID: ${id}) への投稿試行中にエラーが発生しました:`, err.message);
            }
          }
        }

        const mentionList = participants.map(p => `<@${p.id}>`).join(' ');
        const gameStartContent = mentionList
          ? `ゲーム「${title}」の時間になりました！\n${mentionList}`
          : `ゲーム「${title}」には誰も参加しませんでした。`;
        await message.channel.send(gameStartContent).catch(console.error);
      }, collectorTime);
    }

    setupCollectorAndTimeout();
  }
};
