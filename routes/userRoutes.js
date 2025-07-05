const express = require('express');
const { loginAdmin, loginUser, getUsers, createUser, deleteUser, getUserCount, validateUserId, getAdmins, deleteAdmin, getUserName, getAdminCount, getDashboardStats } = require('../controllers/userController');
const auth = require('../middleware/auth');
const router = express.Router();

// Debug endpoint to check API health
router.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    mongoUri: process.env.MONGO_URI ? 'Set' : 'Missing',
    jwtSecret: process.env.JWT_SECRET ? 'Set' : 'Missing'
  });
});

router.post('/admin/login', loginAdmin);
router.post('/login', loginUser);
router.get('/admins', auth, getAdmins);
router.get('/users', auth, getUsers);
router.post('/users', auth, createUser);
router.delete('/admins/:id', auth, deleteAdmin);
router.delete('/users/:id', auth, deleteUser);
router.get('/admins/count', auth, getAdminCount); // Add this line
router.get('/users/count', auth, getUserCount);
router.get('/dashboard/stats', auth, getDashboardStats); // Combined stats endpoint
router.get('/validate-user-id', validateUserId);
router.get('/users/username', auth, getUserName);



module.exports = router;