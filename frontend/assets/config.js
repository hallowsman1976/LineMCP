/**
 * ค่าตั้งค่าของ frontend — แก้ไฟล์นี้ไฟล์เดียวเมื่อย้าย deployment
 * ไม่มีความลับในไฟล์นี้ (URL ของ API เป็นข้อมูลสาธารณะอยู่แล้ว) — token/secret ทั้งหมดอยู่ในชีต Setting ฝั่ง backend
 */
window.LMCP_CONFIG = {
  // URL ของ Apps Script web app (ลงท้าย /exec) — ใช้ deployment เดิมเสมอ (clasp deploy -i <deploymentId>) URL จะได้ไม่เปลี่ยน
  API_URL: 'https://script.google.com/macros/s/AKfycbyYJIpaIasNQCWcdaIjFDZ3j6z3uuSadYW-lkn2oh6RsottDIte_EREbgAC08-gCfCF/exec',

  // LIFF ID ของหน้า "สถานะของฉัน" — เว้นว่างได้ (หน้า liff.html จะไปดึงจาก backend แทน แต่เปิดช้ากว่า)
  LIFF_ID: ''
};
