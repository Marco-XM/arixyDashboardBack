const BlockedDate = require('../models/BlockedDate');

// 1. Get All Blocked Dates
const getBlockedDates = async (req, res) => {
    try {
        const blockedDates = await BlockedDate.find();
        res.send(blockedDates);
    } catch (error) {
        console.error('Error fetching blocked dates:', error);
        res.status(500).send(error);
    }
};

// 2. Add a Blocked Date (Real-Time)
const addBlockedDate = async (req, res) => {
    try {
        const blockedDate = new BlockedDate(req.body);
        await blockedDate.save();

        res.status(201).send(blockedDate);
    } catch (error) {
        console.error('Error adding blocked date:', error);
        res.status(400).send(error);
    }
};

// 3. Remove a Blocked Date by ID (Real-Time)
const removeBlockedDateById = async (req, res) => {
    try {
        const { id } = req.params;
        const blockedDate = await BlockedDate.findByIdAndDelete(id);

        if (!blockedDate) {
            return res.status(404).send({ error: 'Blocked date not found' });
        }

        res.send(blockedDate);
    } catch (error) {
        console.error('Error removing blocked date:', error);
        res.status(400).send(error);
    }
};

// 4. Get Count of Blocked Dates
const getBlockedDatesCount = async (req, res) => {
    try {
        const count = await BlockedDate.countDocuments();
        res.send({ count });
    } catch (error) {
        console.error('Error getting blocked dates count:', error);
        res.status(500).send(error);
    }
};

// Export Controllers
module.exports = {
    getBlockedDates,
    addBlockedDate,
    removeBlockedDateById,
    getBlockedDatesCount
};
