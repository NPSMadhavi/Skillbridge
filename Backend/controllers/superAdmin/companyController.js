import { tenantService } from '../../services/tenantService.js';

export const listCompanies = async (req, res) => {
  try {
    const companies = await tenantService.listCompanies();
    res.json({ companies });
  } catch (error) {
    console.error('List companies error:', error);
    res.status(500).json({ error: error.message || 'Failed to retrieve companies.' });
  }
};

export const createCompany = async (req, res) => {
  const {
    fullName,
    nricFin,
    email,
    adminEmail,
    phone,
    companyName,
    name,
    department,
    slug,
    code,
    adminPassword
  } = req.body;

  try {
    const company = await tenantService.createTenant({
      fullName,
      nricFin,
      email,
      adminEmail,
      phone,
      companyName,
      name,
      department,
      slug,
      code,
      adminPassword
    });

    res.status(201).json({
      message: 'Company and dedicated database created successfully.',
      company
    });
  } catch (error) {
    console.error('Create company error:', error);
    res.status(400).json({ error: error.message || 'Failed to create company.' });
  }
};

export const getCompany = async (req, res) => {
  try {
    const company = await tenantService.getCompanyDetails(req.params.id);
    res.json({ company });
  } catch (error) {
    console.error('Get company error:', error);
    res.status(404).json({ error: error.message || 'Company not found.' });
  }
};

export const updateStatus = async (req, res) => {
  const { status } = req.body;
  try {
    const company = await tenantService.updateCompanyStatus(req.params.id, status);
    res.json({ message: 'Company status updated successfully.', company });
  } catch (error) {
    console.error('Update company status error:', error);
    res.status(400).json({ error: error.message || 'Failed to update company status.' });
  }
};

export const updateCompany = async (req, res) => {
  try {
    const company = await tenantService.updateCompany(req.params.id, req.body);
    res.json({ message: 'Company updated successfully.', company });
  } catch (error) {
    console.error('Update company error:', error);
    res.status(400).json({ error: error.message || 'Failed to update company.' });
  }
};

export const deleteCompany = async (req, res) => {
  const dropDatabase = req.query.dropDatabase !== 'false';
  try {
    const result = await tenantService.deleteCompany(req.params.id, { dropDatabase });
    res.json(result);
  } catch (error) {
    console.error('Delete company error:', error);
    res.status(400).json({ error: error.message || 'Failed to delete company.' });
  }
};
