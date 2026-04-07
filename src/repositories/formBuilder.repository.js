import { executeQuery, executeTransaction } from '../../config/database.js'

/**
 * Get all form field types for form builder dropdown
 */
export async function getFormFieldTypes() {
  const rows = await executeQuery(
    `SELECT id, type_key, label, pg_data_type, default_options
     FROM form_field_types 
     WHERE is_active = true 
     ORDER BY id`
  )
  return rows
}

/**
 * Get all form definitions with category info
 */
export async function getAllFormDefinitions() {
  const rows = await executeQuery(
    `SELECT fd.*, c.name AS category_name, 
            e.first_name || ' ' || e.last_name AS created_by_name
     FROM requisition_form_definitions fd
     JOIN requisition_category c ON fd.category_id = c.id
     LEFT JOIN employees e ON fd.created_by = e.employee_id
     ORDER BY fd.created_at DESC`
  )
  return rows
}

/**
 * Get form definition by ID
 */
export async function getFormDefinitionById(id) {
  const rows = await executeQuery(
    `SELECT fd.*, c.name AS category_name,
            e.first_name || ' ' || e.last_name AS created_by_name
     FROM requisition_form_definitions fd
     JOIN requisition_category c ON fd.category_id = c.id
     LEFT JOIN employees e ON fd.created_by = e.employee_id
     WHERE fd.id = $1`,
    [id]
  )
  return rows[0] || null
}

/**
 * Get form definition by category ID
 * (Each category can have only one form)
 */
export async function getFormDefinitionByCategoryId(categoryId) {
  const rows = await executeQuery(
    `SELECT fd.*, c.name AS category_name,
            e.first_name || ' ' || e.last_name AS created_by_name
     FROM requisition_form_definitions fd
     JOIN requisition_category c ON fd.category_id = c.id
     LEFT JOIN employees e ON fd.created_by = e.employee_id
     WHERE fd.category_id = $1`,
    [categoryId]
  )
  return rows[0] || null
}

/**
 * Check if a form already exists for a category
 */
export async function hasFormForCategory(categoryId) {
  const rows = await executeQuery(
    `SELECT COUNT(*) AS count FROM requisition_form_definitions 
     WHERE category_id = $1`,
    [categoryId]
  )
  return parseInt(rows[0]?.count || 0, 10) > 0
}

/**
 * Create new form definition (DRAFT status)
 */
export async function createFormDefinition(formName, categoryId, formConfig, tableName, createdBy) {
  const rows = await executeQuery(
    `INSERT INTO requisition_form_definitions 
     (form_name, category_id, form_config, table_name, status, created_by)
     VALUES ($1, $2, $3::jsonb, $4, 'draft', $5)
     RETURNING *`,
    [formName, categoryId, JSON.stringify(formConfig), tableName, createdBy]
  )
  return rows[0]
}

/**
 * Update form definition configuration
 */
export async function updateFormDefinition(id, formConfig, updatedBy) {
  const rows = await executeQuery(
    `UPDATE requisition_form_definitions 
     SET form_config = $1::jsonb, 
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING *`,
    [JSON.stringify(formConfig), id]
  )
  return rows[0] || null
}

/**
 * Update form definition status (draft -> active -> archived)
 */
export async function updateFormStatus(id, status) {
  const rows = await executeQuery(
    `UPDATE requisition_form_definitions 
     SET status = $1, 
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING *`,
    [status, id]
  )
  return rows[0] || null
}

/**
 * Delete form definition
 */
export async function deleteFormDefinition(id) {
  const rows = await executeQuery(
    `DELETE FROM requisition_form_definitions 
     WHERE id = $1 
     RETURNING id, table_name`,
    [id]
  )
  return rows[0] || null
}

/**
 * Generate CREATE TABLE SQL using database function
 */
export async function generateCreateTableSql(tableName, formConfig) {
  const rows = await executeQuery(
    `SELECT generate_form_table_sql($1, $2::jsonb) AS sql`,
    [tableName, JSON.stringify(formConfig)]
  )
  return rows[0]?.sql || ''
}

/**
 * Execute raw SQL to create the form data table
 * NOTE: This should be used carefully - SQL injection prevention is built in
 */
export async function executeCreateTableSql(sql) {
  // Note: This executes the SQL directly. The SQL is generated internally
  // using the generate_form_table_sql function which validates table names
  // and uses proper escaping.
  await executeQuery(sql)
}

/**
 * Link form to requisition category
 */
export async function linkFormToCategory(categoryId, formDefinitionId) {
  await executeQuery(
    `UPDATE requisition_category 
     SET custom_form_id = $1 
     WHERE id = $2`,
    [formDefinitionId, categoryId]
  )
}

/**
 * Check if generated table already exists
 */
export async function checkTableExists(tableName) {
  const rows = await executeQuery(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables 
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [tableName.toLowerCase()]
  )
  return rows[0]?.exists || false
}

/**
 * Get requisition categories without forms
 */
export async function getCategoriesWithoutForms() {
  const rows = await executeQuery(
    `SELECT c.id, c.name 
     FROM requisition_category c
     LEFT JOIN requisition_form_definitions fd ON c.id = fd.category_id
     WHERE fd.id IS NULL
     ORDER BY c.name`
  )
  return rows
}

/**
 * Get all requisition categories with form status
 */
export async function getAllCategoriesWithFormStatus() {
  const rows = await executeQuery(
    `SELECT c.id, c.name, 
            fd.id AS form_id, 
            fd.form_name, 
            fd.status AS form_status,
            fd.table_name
     FROM requisition_category c
     LEFT JOIN requisition_form_definitions fd ON c.id = fd.category_id
     ORDER BY c.name`
  )
  return rows
}

/**
 * Validate field name to be SQL-safe
 */
export function validateFieldName(fieldName) {
  // Only allow alphanumeric and underscore, must start with letter or underscore
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(fieldName)
}

/**
 * Sanitize table name for PostgreSQL
 */
export function sanitizeTableName(baseName) {
  // Remove special characters, convert to lowercase, add prefix
  const clean = baseName
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[^a-z_]/, '_')
  return `req_form_${clean}_${Date.now()}`
}
