const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const routineTaskSchema = new Schema(
    {
        title: {
            type: String,
            required: true,
        },
        description: String,
        company: {
            _id: {
                type: Schema.Types.ObjectId,
                ref: 'Company',
                required: true,
            },
            alias: {
                type: String,
                required: true,
            },
        },
        applicant: {
            _id: {
                type: Schema.Types.ObjectId,
                ref: 'User',
                required: true,
            },
            firstName: {
                type: String,
                required: true,
            },
            lastName: String,
        },
        category: {
            _id: {
                type: Schema.Types.ObjectId,
                ref: 'TicketCategory',
                required: true,
            },
            title: {
                type: String,
                required: true,
            },
        },
        isActive: {
            type: Boolean,
            default: false,
        },
        cronSchedule: String,
        // Опционально: кого назначить на создаваемую заявку (сотрудники поддержки).
        responsibles: [
            {
                _id: {
                    type: Schema.Types.ObjectId,
                    ref: 'User',
                },
                firstName: String,
                lastName: String,
                email: String,
                phone: String,
                position: String,
                role: String,
                isActive: Boolean,
            },
        ],
        // Ссылка на шаблон-источник (регламент создан «на основе» шаблона).
        // Снимок: поля скопированы, но связь хранится для показа и синхронизации.
        sourceTemplate: {
            _id: {
                type: Schema.Types.ObjectId,
                ref: 'TicketTemplate',
            },
            title: String,
        },
        // Пропустить одно ближайшее плановое срабатывание (ставится при ручном
        // «создать заявку сейчас»); планировщик сбрасывает флаг на следующем запуске.
        skipNextRun: {
            type: Boolean,
            default: false,
        },
        checklist: [
            {
                description: String,
                mandatory: Boolean,
                checked: Boolean,
            },
        ],
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
        updatedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('RoutineTask', routineTaskSchema);
