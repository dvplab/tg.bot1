import TelegramBot from 'node-telegram-bot-api';
import fetch from 'node-fetch';

const TELEGRAM_TOKEN = '7744884848:AAGhbEV9JYYn4INJHW3nPOulQLph5RmikKo';
const RAPIDAPI_KEY = 'acfd6b6cf4mshf0d04ae3dde86a6p1855e8jsn6a715c2c667d';
const CHANNEL_ID = '@botsmmhelp';

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Привет! Пожалуйста, отправьте ссылку на видео.');
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;

    // Проверка подписки
    try {
        const memberStatus = await bot.getChatMember(CHANNEL_ID, chatId);
        if (
            memberStatus.status === 'left' ||
            memberStatus.status === 'kicked'
        ) {
            bot.sendMessage(
                chatId,
                'Пожалуйста, подпишитесь на канал @botsmmhelp, чтобы использовать бота.'
            );
            return;
        }
    } catch (error) {
        console.error('Ошибка при проверке подписки:', error);
        bot.sendMessage(chatId, 'Не удалось проверить подписку на канал.');
        return;
    }

    if (msg.text && !msg.text.startsWith('/')) {
        const url = msg.text;

        try {
            const apiResponse = await fetch(
                'https://social-download-all-in-one.p.rapidapi.com/v1/social/autolink',
                {
                    method: 'POST',
                    headers: {
                        'x-rapidapi-key': RAPIDAPI_KEY,
                        'x-rapidapi-host':
                            'social-download-all-in-one.p.rapidapi.com',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ url }),
                }
            );

            const result = await apiResponse.json();

            if (result.error) {
                bot.sendMessage(
                    chatId,
                    'Произошла ошибка при обработке ссылки.'
                );
                return;
            }

            // Отправляем описание поста отдельно, если оно есть
            if (result.title) {
                await bot.sendMessage(chatId, result.title);
            }

            // Разделение медиа на группы по 10
            const mediaChunks = [];
            for (let i = 0; i < result.medias.length; i += 10) {
                mediaChunks.push(result.medias.slice(i, i + 10));
            }

            // Отправляем медиа с задержкой между группами
            for (let i = 0; i < mediaChunks.length; i++) {
                const chunk = mediaChunks[i];

                const mediaMessages = chunk.map((media, index, array) => ({
                    type: media.type === 'video' ? 'video' : 'photo',
                    media: media.url,
                    caption:
                        index === array.length - 1
                            ? `Скачано при помощи @DownloadVideoAllBot`
                            : undefined,
                }));

                await bot.sendMediaGroup(chatId, mediaMessages);

                // Задержка перед отправкой следующей группы (чтобы избежать лимитов Telegram API)
                if (i < mediaChunks.length - 1) {
                    await new Promise((resolve) => setTimeout(resolve, 2000)); // 1 секунда задержки
                }
            }
        } catch (error) {
            console.error(error);
            bot.sendMessage(
                chatId,
                'Произошла ошибка при выполнении запроса к API.'
            );
        }
    }
});

bot.on('polling_error', (error) => console.log(error));
