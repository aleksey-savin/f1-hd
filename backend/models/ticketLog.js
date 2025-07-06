const mongoose = require('mongoose');

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
        severity: {
            type: String,
            enum: ['info', 'warning', 'danger']
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('TicketLog', ticketLogSchema);
