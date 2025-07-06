const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const mikrotikSchema = new Schema(
    {
        credentials: {
            host: String,
            port: Number,
            user: String,
            password: String,
        },
        name: String,
        boardName: String,
        serialNumber: String,
        currentFirmware: String,
        addresses: [
            {
                address: String,
                network: String,
                interface: String,
                invalid: String,
                dynamic: String,
                disabled: String,
                comment: String,
            },
        ],
        description: String,
    },
    { timestamps: true }
);

module.exports = mongoose.model('Mikrotik', mikrotikSchema);
