const Report = require('../models/Report');

// 1. Create Report (Real-Time)
const createReport = async (req, res) => {
    try {
        const report = new Report(req.body);
        await report.save();

        res.status(201).send(report);
    } catch (error) {
        console.error('Error creating report:', error);
        res.status(400).send(error);
    }
};

// 2. Get All Reports (No Change Needed)
const getReports = async (req, res) => {
    try {
        const reports = await Report.find();
        res.send(reports);
    } catch (error) {
        console.error('Error fetching reports:', error);
        res.status(500).send(error);
    }
};

// 3. Get Report Count (Real-Time Count Updates Optional)
const getReportCount = async (req, res) => {
    try {
        const count = await Report.countDocuments();
        res.send({ count });
    } catch (error) {
        console.error('Error getting report count:', error);
        res.status(500).send(error);
    }
};

// 4. Delete Report (Real-Time)
const deleteReportById = async (req, res) => {
    try {
        const { id } = req.params;
        const report = await Report.findByIdAndDelete(id);

        if (!report) {
            return res.status(404).send({ error: 'Report not found' });
        }

        res.send(report);
    } catch (error) {
        console.error('Error deleting report:', error);
        res.status(400).send(error);
    }
};

module.exports = {
    createReport,
    getReports,
    getReportCount,
    deleteReportById
};
