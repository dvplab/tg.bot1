const TelegramBot = require('node-telegram-bot-api');
const http = require('https');
const fs = require('fs');
const path = require('path');

// Укажите ваш токен бота
const token = '7927813451:AAGxQbdLC9PRahY9EzNSJpYA10ywd6JD2cI'; // Замените на ваш токен
const bot = new TelegramBot(token, { polling: true });

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Отправьте ссылку на пост в Instagram.');
});

bot.onText(
    /https:\/\/www\.instagram\.com\/reel\/([a-zA-Z0-9_-]+)/,
    (msg, match) => {
        const shortcode = match[1];
        const apiUrl = `https://instagram-bulk-scraper-latest.p.rapidapi.com/media_download_by_shortcode/${shortcode}`;

        const options = {
            method: 'GET',
            hostname: 'instagram-bulk-scraper-latest.p.rapidapi.com',
            port: null,
            path: `/media_download_by_shortcode/${shortcode}`,
            headers: {
                'x-rapidapi-key':
                    'acfd6b6cf4mshf0d04ae3dde86a6p1855e8jsn6a715c2c667d', // Замените на ваш ключ
                'x-rapidapi-host':
                    'instagram-bulk-scraper-latest.p.rapidapi.com',
            },
        };

        const req = http.request(options, (res) => {
            const chunks = [];

            res.on('data', (chunk) => {
                chunks.push(chunk);
            });

            res.on('end', () => {
                const body = JSON.parse(Buffer.concat(chunks).toString());
                console.log(body); // Выводим ответ API в консоль

                if (body.status === 'ok') {  // вот тут скорее всего статус не тот получает и он идет далье на скачивание и пропускает шаги
                    const videoUrl = body.data.main_media_hd; // Получаем URL видео
                    const caption = body.data.caption; // Получаем текст под постом

                    console.log('Ссылка на видео:', videoUrl); // Логируем URL видео
                    console.log('Текст под постом:', caption); // Логируем текст под постом

                    if (videoUrl) {
                        const file = fs.createWriteStream(
                            path.join(__dirname, 'video.mp4')
                        );

                        http.get(videoUrl, (response) => {
                            response.pipe(file);

                            file.on('finish', () => {
                                file.close(() => {
                                    // Отправляем видео и текст в одном сообщении
                                    const message = caption
                                        ? `🎥 *Видео:* [Скачать](${videoUrl})\n\n📝 *Описание:* ${caption}`
                                        : `🎥 *Видео:* [Скачать](${videoUrl})\n\n📝 *Описание отсутствует.*`;

                                    bot.sendVideo(
                                        msg.chat.id,
                                        path.join(__dirname, 'video.mp4'),
                                        {
                                            caption: message,
                                            parse_mode: 'Markdown',
                                        }
                                    ).catch((err) => {
                                        console.error(
                                            'Ошибка при отправке видео:',
                                            err.message
                                        );
                                        bot.sendMessage(
                                            msg.chat.id,
                                            'Произошла ошибка при отправке видео.'
                                        );
                                    });
                                });
                            });
                        }).on('error', (err) => {
                            console.error(
                                'Ошибка при скачивании видео:',
                                err.message
                            );
                            bot.sendMessage(
                                msg.chat.id,
                                'Произошла ошибка при скачивании видео. Убедитесь, что ссылка корректна.'
                            );
                        });
                    } else {
                        bot.sendMessage(
                            msg.chat.id,
                            'Не удалось получить URL видео.'
                        );
                    }
                } else {
                    bot.sendMessage(
                        msg.chat.id,
                        'Произошла ошибка при обработке ссылки. Убедитесь, что ссылка корректна.'
                    );
                }
            });
        });

        req.on('error', (error) => {
            console.error('Ошибка при выполнении запроса:', error);
            bot.sendMessage(
                msg.chat.id,
                'Произошла ошибка при обработке ссылки. Убедитесь, что ссылка корректна.'
            );
        });

        req.end();
    }
);

