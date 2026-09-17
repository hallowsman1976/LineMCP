/**
 * Code.js — entry point ของ Apps Script ที่ทำหน้าที่เป็น API อย่างเดียว
 *
 * หน้าเว็บทั้งหมด (แอดมิน / ตั้งค่า / LIFF สมาชิก) ย้ายไปโฮสต์ภายนอกที่ GitHub Pages แล้ว (โฟลเดอร์ frontend/)
 * เหตุผล: HtmlService serve หน้าเว็บใน sandbox iframe เสมอ ทำให้ liff.init() พังบน iOS, redirect อัตโนมัติไม่ได้
 * และต้องแก้ลิงก์ให้มี target="_top" ทุกจุด — frontend ภายนอกเรียก backend ผ่าน fetch() แทน (ดู Api.js)
 *
 * doPost อยู่ใน LineWebhook.js (รับทั้ง LINE webhook และ JSON API)
 */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var frontendUrl = '';
  try { frontendUrl = getConfig_('FRONTEND_URL'); } catch (err) {}

  // LINE Login callback ที่ยังชี้มาที่ URL ของ Apps Script (ตั้งค่าแบบเดิม) — แจ้งให้ย้าย Callback URL ไป frontend
  if (p.state && (p.code || p.error)) {
    return jsonOutput_({
      ok: false,
      message: 'Callback URL ของ LINE Login ยังชี้มาที่ Apps Script — กรุณาเปลี่ยนเป็น FRONTEND_URL ใน LINE Developers Console',
      frontendUrl: frontendUrl
    });
  }
  return jsonOutput_({ ok: true, service: 'LineMCP API', frontendUrl: frontendUrl });
}

/** URL ของ Apps Script web app (/exec) — ใช้ประกอบ webhook URL */
function getBaseUrl_() {
  var url = '';
  try { url = getConfig_('WEBAPP_BASE_URL'); } catch (e) {}
  if (!url) url = ScriptApp.getService().getUrl() || '';
  return url;
}
