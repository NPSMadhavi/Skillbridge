import express from 'express';
import { requireSuperAdmin } from '../middleware/superAdminAuth.js';
import * as authCtrl from '../controllers/superAdmin/superAdminAuthController.js';
import * as companyCtrl from '../controllers/superAdmin/companyController.js';

const router = express.Router();

// Public Super Admin authentication
router.post('/auth/login', authCtrl.login);

// Protected Super Admin routes
router.use(requireSuperAdmin);

router.get('/auth/me', authCtrl.me);
router.get('/companies', companyCtrl.listCompanies);
router.post('/companies', companyCtrl.createCompany);
router.get('/companies/:id', companyCtrl.getCompany);
router.put('/companies/:id', companyCtrl.updateCompany);
router.patch('/companies/:id/status', companyCtrl.updateStatus);
router.delete('/companies/:id', companyCtrl.deleteCompany);

// Super Admin Management routes
router.get('/admins', authCtrl.listSuperAdmins);
router.post('/admins', authCtrl.createSuperAdmin);
router.delete('/admins/:id', authCtrl.deleteSuperAdmin);

export default router;
