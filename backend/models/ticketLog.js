const mongoose = require('mongoose');

const { KINDS, classify } = require('../services/ticketEvents');

const Schema = mongoose.Schema;

const ticketLogSchema = new Schema(
    {
        ticket: Number,
        ticketId: {
            type: Schema.Types.ObjectId,
            ref: 'Ticket',
        },
        user: {
            firstName: String,
            lastName: String,
        },
        event: String,
        // Файлы события о вложениях: лента показывает их чипами, по которым
        // файл открывается прямо из хроники. Имена лежат отдельным полем, а не
        // в тексте события, потому что текст записи в ленте не показывается —
        // подпись даёт каталог видов (см. kind ниже).
        files: [
            {
                _id: false,
                name: String,
                originalName: String,
            },
        ],
        // Вид события — по нему хроника карточки решает, показать запись
        // строкой или свернуть в счётчик. Заполняется хуком ниже из текста
        // события: 27 мест записи остаются как есть, а каталог — один
        // (services/ticketEvents.js). Явно переданный kind хук не трогает.
        kind: {
            type: String,
            enum: Object.keys(KINDS),
        },
        severity: {
            type: String,
            enum: ['info', 'warning', 'danger']
        },
    },
    { timestamps: true }
);

ticketLogSchema.pre('validate', function assignKind() {
    if (!this.kind) this.kind = classify(this.event);
});

// Хроника читается двумя способами, и оба до этого шли полным сканом по
// четверти миллиона записей: карточка заявки берёт свои события, а главная —
// последнее НЕ служебное событие каждой открытой заявки (движение по заявке,
// см. services/ticketActivity.js). Второй запрос повторяется на каждом опросе
// дашборда, поэтому индекс обязателен, а не желателен.
ticketLogSchema.index({ ticketId: 1, kind: 1, createdAt: -1 });

// Живые обновления хроники заявки (см. services/pulseTopics.js)
ticketLogSchema.plugin(require('../services/pulsePlugin'), { model: 'TicketLog' });

module.exports = mongoose.model('TicketLog', ticketLogSchema);
