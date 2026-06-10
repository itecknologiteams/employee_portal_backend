const { Client } = require('pg');
(async () => {
  const c = new Client({ host:'192.168.21.31', database:'employee_portal', user:'employee_dev', password:'EmP$D3v#2026!qR4', port:6632 });
  await c.connect();
  console.log('--- leave_types ---');
  console.table((await c.query(`SELECT leave_type_id, leave_type_name, is_active FROM leave_types ORDER BY leave_type_id`)).rows);
  console.log('--- HODs + their leave_balance ---');
  const hods = await c.query(`
    SELECT d.department_id, d.hod_employee_id AS hod, e.employee_code,
           lb.annual_leave, lb.casual_leave, lb.sick_leave, lb.marriage_leave,
           lb.maternity_leave, lb.paternal_leave, lb.pilgrimage_leave
    FROM departments d
    JOIN employees e ON e.employee_id = d.hod_employee_id
    LEFT JOIN leave_balance lb ON lb.employee_id = d.hod_employee_id
    WHERE d.hod_employee_id IS NOT NULL
    ORDER BY d.department_id LIMIT 20`);
  console.table(hods.rows);
  await c.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
