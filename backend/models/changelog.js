const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const ChangelogSchema = new Schema(
    {
        title: String,
        body: String,
        isPublic: Boolean,
    },
    { timestamps: true }
);

module.exports = mongoose.model('Changelog', ChangelogSchema);
