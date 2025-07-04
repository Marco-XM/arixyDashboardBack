const express = require('express');
const { loginAdmin, loginUser, getUsers, createUser, deleteUser, getUserCount, validateUserId, getAdmins, deleteAdmin, getUserName, getAdminCount } = require('../controllers/userController');
const auth = require('../middleware/auth');
const router = express.Router();

router.post('/admin/login', loginAdmin);
router.post('/login', loginUser);
router.get('/admins', auth, getAdmins);
router.get('/users', auth, getUsers);
router.post('/users', auth, createUser);
router.delete('/admins/:id', auth, deleteAdmin);
router.delete('/users/:id', auth, deleteUser);
router.get('/admins/count', auth, getAdminCount); // Add this line
router.get('/users/count', auth, getUserCount);
router.get('/validate-user-id', validateUserId);
router.get('/users/username', auth, getUserName);



module.exports = router;