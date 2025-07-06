const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const contractSchema = new Schema(
    {
        title: {
            type: String,
            required: true,
        },
        company: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
        },
        terms: { type: Date },
        autoRenewal: { type: Boolean },
        state: { type: String, enum: ['active', 'canceled'] },
        payments: {
            type: { type: String, enum: ['per-hour', 'fixed'] },
            period: { type: String, enum: ['monthly', 'one-time'] },
        },
        ticketCategories: [
            {
                type: Schema.Types.ObjectId,
                ref: 'TicketCategory',
            },
        ],
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: false,
        },
        updatedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: false,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Contract', contractSchema);
