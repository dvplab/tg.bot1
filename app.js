import dotenv from 'dotenv';
dotenv.config();
import TelegramBot from 'node-telegram-bot-api';
import fetch from 'node-fetch';
import mongoose from 'mongoose';

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const CHANNEL_ID = process.env.CHANNEL_ID;

// Подключение к MongoDB
mongoose
    .connect(process.env.MONGO_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    })
    .then(() => console.log('MongoDB подключена'))
    .catch((err) => console.error('Ошибка подключения к MongoDB:', err));

// Определение схемы и модели
const saveBotSchema = new mongoose.Schema({
    userId: { type: Number, required: true, unique: true },
    chatId: { type: Number, required: true },
});
const SaveBot = mongoose.model('SaveBot', saveBotSchema);

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Новый обработчик для сохранения в базу
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
        const existingUser = await SaveBot.findOne({ userId });
        if (!existingUser) {
            const newUser = new SaveBot({ userId, chatId });
            await newUser.save();
            console.log('Новый пользователь сохранён в savebot');
        } else {
            console.log('Пользователь уже существует в savebot');
        }
    } catch (err) {
        console.error('Ошибка при сохранении в MongoDB:', err);
    }

    bot.sendMessage(chatId, 'Привет! Пожалуйста, отправьте ссылку на видео.');
});

// Исходный код бота (без изменений)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    try {
        const memberStatus = await bot.getChatMember(CHANNEL_ID, chatId);
        if (
            memberStatus.status === 'left' ||
            memberStatus.status === 'kicked'
        ) {
            bot.sendMessage(
                chatId,
                `Пожалуйста, подпишитесь на канал ${CHANNEL_ID}, чтобы использовать бота.`
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

            if (result.title) await bot.sendMessage(chatId, result.title);

            const mediaChunks = [];
            for (let i = 0; i < result.medias.length; i += 10) {
                mediaChunks.push(result.medias.slice(i, i + 10));
            }

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
                if (i < mediaChunks.length - 1) {
                    await new Promise((resolve) => setTimeout(resolve, 2000));
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
