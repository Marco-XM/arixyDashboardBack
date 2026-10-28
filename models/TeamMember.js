const mongoose = require('mongoose');

// An Arixy Tech team member and their monthly salary. Salary changes are kept
// as history (each entry applies from its month onwards) so past months keep
// the salary that was actually paid.
const salarySchema = new mongoose.Schema({
    amount: { type: Number, required: true, min: 0 },
    from: { type: Date, required: true }, // first month this salary applies (UTC, day 1)
}, { _id: false });

const teamMemberSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    // Dashboard account this person was picked from (empty → entered manually).
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: false },
    role: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    currency: { type: String, trim: true, uppercase: true, default: 'EGP' },
    salaries: [salarySchema],
    startDate: { type: Date, required: true },
    // Last month they were paid for (empty → still on the team).
    endDate: { type: Date },
    notes: { type: String, trim: true, default: '' },
}, { timestamps: true });

teamMemberSchema.pre('save', function (next) {
    this.salaries.sort((a, b) => new Date(a.from) - new Date(b.from));
    next();
});

module.exports = mongoose.model('TeamMember', teamMemberSchema);
