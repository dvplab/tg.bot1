import TelegramBot from 'node-telegram-bot-api';
import fetch from 'node-fetch';

// Укажите ваш токен Telegram бота и RapidAPI ключ
const TELEGRAM_TOKEN = '7595948986:AAEBT4Q6kBoUCb_fPsVxgcl6-ObxUK-bY9g'; // Замените на ваш токен
const RAPIDAPI_KEY = 'acfd6b6cf4mshf0d04ae3dde86a6p1855e8jsn6a715c2c667d'; // Замените на ваш ключ RapidAPI

// Инициализация бота
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Приветственное сообщение
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Привет! Пришлите ссылку на видео.');
});

// Обработка полученной ссылки
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;

    // Проверяем, есть ли текстовое сообщение
    if (msg.text && !msg.text.startsWith('/')) {
        const url = msg.text;

        // Отправляем запрос к API
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

            // Проверяем на ошибки и тип контента
            if (result.error) {
                bot.sendMessage(
                    chatId,
                    'Произошла ошибка при обработке ссылки.'
                );
                return;
            }

            // Если несколько медиа, отправляем все в одном сообщении
            if (result.type === 'multiple' && result.medias) {
                const mediaUrls = result.medias.map((media) => media.url);
                await bot.sendMediaGroup(
                    chatId,
                    mediaUrls.map((url) => ({ type: 'photo', media: url }))
                );
                await bot.sendMessage(
                    chatId,
                    result.title || 'Медиа из социальной сети'
                );
            } else if (result.type === 'image' || result.type === 'video') {
                const mediaType =
                    result.type === 'video' ? bot.sendVideo : bot.sendPhoto;
                await mediaType.call(bot, chatId, result.url, {
                    caption: result.title || 'Медиа из социальной сети',
                });
            } else {
                bot.sendMessage(chatId, 'Неподдерживаемый тип медиа.');
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
