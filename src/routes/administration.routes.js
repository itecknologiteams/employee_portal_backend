import express from 'express'
import * as adminController from '../controllers/administration.controller.js'

const router = express.Router()

router.get('/departments', adminController.listDepartments)
router.post('/departments', adminController.createDepartment)
router.put('/departments/:id', adminController.updateDepartment)
router.delete('/departments/:id', adminController.deleteDepartment)

router.get('/designations', adminController.listDesignations)
router.post('/designations', adminController.createDesignation)
router.put('/designations/:id', adminController.updateDesignation)
router.delete('/designations/:id', adminController.deleteDesignation)

router.get('/employee-types', adminController.listEmployeeTypes)
router.post('/employee-types', adminController.createEmployeeType)
router.put('/employee-types/:id', adminController.updateEmployeeType)
router.delete('/employee-types/:id', adminController.deleteEmployeeType)

router.get('/stations', adminController.listStations)
router.post('/stations', adminController.createStation)
router.put('/stations/:id', adminController.updateStation)
router.delete('/stations/:id', adminController.deleteStation)

router.get('/cities', adminController.listCities)
router.post('/cities', adminController.createCity)
router.put('/cities/:id', adminController.updateCity)
router.delete('/cities/:id', adminController.deleteCity)

router.get('/employees', adminController.listEmployees)
router.post('/employees', adminController.createEmployee)
router.put('/employees/:id', adminController.updateEmployee)
router.delete('/employees/:id', adminController.deactivateEmployee)

router.get('/superadmin-status', adminController.getSuperAdminStatus)
router.get('/role-defaults/:role', adminController.getRoleDefaults)
router.get('/user-by-employee/:empId', adminController.getUserByEmployee)

router.get('/requisition-categories', adminController.listRequisitionCategories)
router.post('/requisition-categories', adminController.createRequisitionCategory)
router.put('/requisition-categories/:id', adminController.updateRequisitionCategory)
router.delete('/requisition-categories/:id', adminController.deleteRequisitionCategory)

export default router
