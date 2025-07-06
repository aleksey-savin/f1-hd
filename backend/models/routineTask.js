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
        checklist: [
            {
                description: String,
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
