/**
 * setup.js — หน้าตั้งค่าระบบ (setup.html)
 * เปิดให้กรอกได้โดยไม่ต้อง login จนกว่าจะตั้งค่าครบ + มีแอดมินเต็มแล้ว จากนั้นล็อกให้เฉพาะแอดมินเต็ม (ดู Settings.js)
 */
var api = lmcp.api;
var esc = lmcp.esc;
var TOKEN = lmcp.session.get().token;
var FRONTEND_BASE = lmcp.frontendBaseUrl();
var API_URL = lmcp.config.API_URL || '';

var FIELD_DEFS = [
  { key: 'LINE_CHANNEL_ACCESS_TOKEN', label: 'Messaging API — Channel access token', required: true, area: true,
    hint: 'LINE Developers Console > Messaging API channel > Messaging API > Channel access token (long-lived) > Issue' },
  { key: 'LINE_CHANNEL_SECRET', label: 'Messaging API — Channel secret', required: true,
    hint: 'Messaging API channel > Basic settings > Channel secret' },
  { key: 'LINE_LOGIN_CHANNEL_ID', label: 'LINE Login — Channel ID', required: true,
    hint: 'สร้าง LINE Login channel ใหม่ (Provider เดียวกับ Messaging API) > Basic settings' },
  { key: 'LINE_LOGIN_CHANNEL_SECRET', label: 'LINE Login — Channel secret', required: true, hint: '' },
  { key: 'FRONTEND_URL', label: 'Frontend URL (หน้าเว็บบน GitHub Pages)', required: true, suggest: FRONTEND_BASE,
    hint: 'ต้องตรงกับ Callback URL ที่ตั้งใน LINE Login channel เป๊ะ ๆ (รวม / ปิดท้าย)' },
  { key: 'WEBAPP_BASE_URL', label: 'Apps Script Web App URL (ลงท้าย /exec)', required: true, suggest: API_URL,
    hint: 'ใช้ประกอบ Webhook URL — ควรตรงกับ API_URL ใน assets/config.js' },
  { key: 'ADMIN_LINE_GROUP_ID', label: 'กลุ่ม LINE แอดมิน (Group ID) — ไม่บังคับ', required: false,
    hint: 'ไว้ push แจ้งเตือนข้อความค้างตอบเกิน 5 นาที เว้นว่างไว้ก่อนได้ ใส่ทีหลังได้' },
  { key: 'WEBHOOK_SECRET', label: 'Webhook secret — ไม่บังคับ (ระบบสุ่มให้อัตโนมัติถ้าเว้นว่าง)', required: false,
    hint: 'ใช้แทนการ verify signature ของ LINE (Apps Script อ่าน header ไม่ได้ — ดู WORKFLOW.md)' },
  { key: 'LIFF_ID', label: 'LIFF ID — ไม่บังคับ', required: false,
    hint: 'สำหรับหน้า "สถานะของฉัน" ของสมาชิก ใส่ทีหลังได้หลังสร้าง LIFF app' }
];

function setContent(html) { document.getElementById('content').innerHTML = html; }

function infoCard() {
  return '<div class="card"><div class="card-header">URL สำหรับ LINE Developers Console</div><div class="card-body">' +
    '<p class="hint mb-1">LINE Login channel > Callback URL</p><code class="copyable mb-3">' + esc(FRONTEND_BASE) + '</code>' +
    '<p class="hint mb-1">LIFF app > Endpoint URL (scope: <b>profile</b> และ <b>openid</b>)</p><code class="copyable mb-3">' + esc(FRONTEND_BASE + 'liff.html') + '</code>' +
    '<p class="hint mb-1">Messaging API channel > Webhook URL</p><code class="copyable" id="webhookUrlBox">กำลังโหลด...</code>' +
    '</div></div>';
}

function bootstrapCard() {
  var preset = new URLSearchParams(location.search).get('userId') || '';
  return '<div class="card"><div class="card-header">เพิ่มแอดมินเต็มคนแรก</div><div class="card-body">' +
    '<p class="hint">ยังไม่มีแอดมินในระบบ — ให้ไปกด "เข้าสู่ระบบด้วย LINE" ที่ <a href="./">หน้าแอดมิน</a> ก่อน 1 ครั้ง ' +
    'ระบบจะปฏิเสธแต่แสดง LINE User ID ให้ แล้วนำมากรอกที่นี่ (ช่องทางนี้ปิดตัวเองอัตโนมัติเมื่อมีแอดมินแล้ว)</p>' +
    '<div class="mb-2"><label>LINE User ID</label><input class="form-control form-control-sm" id="bsUserId" placeholder="Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value="' + esc(preset) + '"></div>' +
    '<div class="mb-3"><label>ชื่อที่แสดง</label><input class="form-control form-control-sm" id="bsName" placeholder="ชื่อของคุณ"></div>' +
    '<button class="btn btn-success w-100" id="bsBtn" onclick="doBootstrap()">เพิ่มเป็นแอดมินเต็ม</button>' +
    '</div></div>';
}

function renderForm(status) {
  var lockedNote = status.locked
    ? '<div class="alert alert-info small">ตั้งค่าครบแล้ว — การแก้ไขค่าต่อจากนี้ถูกล็อกไว้เฉพาะแอดมินเต็มที่ login แล้วเท่านั้น</div>'
    : '<div class="alert alert-warning small">ยังตั้งค่าไม่ครบ — หน้านี้เปิดให้กรอกได้โดยไม่ต้อง login ชั่วคราว (เพราะ LINE Login ยังใช้งานไม่ได้จนกว่าจะกรอกครบ) พอกรอกครบและมีแอดมินแล้วหน้านี้จะถูกล็อกอัตโนมัติ</div>';

  var fieldsHtml = FIELD_DEFS.map(function (f) {
    var current = status.values[f.key] || '';
    var input = f.area
      ? '<textarea class="form-control form-control-sm" id="f_' + f.key + '" rows="2" placeholder="' + esc(current || 'ยังไม่ได้ตั้งค่า') + '"></textarea>'
      : '<input type="text" class="form-control form-control-sm" id="f_' + f.key + '" placeholder="' + esc(current || 'ยังไม่ได้ตั้งค่า') + '">';
    var suggest = (f.suggest && current !== f.suggest)
      ? '<button type="button" class="btn btn-sm btn-outline-primary mt-1 text-break text-start" data-fill="' + f.key + '" data-value="' + esc(f.suggest) + '">ใช้ค่านี้: ' + esc(f.suggest) + '</button>'
      : '';
    return '<div class="mb-3"><label>' + esc(f.label) + (f.required ? ' <span class="text-danger">*</span>' : '') + '</label>' +
      (current ? '<div class="hint mb-1">ค่าปัจจุบัน: <code>' + esc(current) + '</code></div>' : '') +
      input + suggest + (f.hint ? '<div class="hint mt-1">' + esc(f.hint) + '</div>' : '') + '</div>';
  }).join('');

  setContent(
    lockedNote +
    (status.hasAdmin ? '' : bootstrapCard()) +
    '<div class="card"><div class="card-header">ค่าตั้งค่าระบบ (บันทึกลงชีต "Setting")</div><div class="card-body">' +
    fieldsHtml +
    '<button class="btn btn-success w-100" id="saveBtn" onclick="doSave()">บันทึก</button>' +
    '</div></div>' +
    infoCard() +
    '<div class="text-center"><a href="./" class="btn btn-outline-secondary btn-sm">กลับหน้าแอดมิน</a></div>'
  );
  loadWebhookPreview();
}

document.getElementById('content').addEventListener('click', function (ev) {
  var b = ev.target.closest('button[data-fill]');
  if (b) document.getElementById('f_' + b.dataset.fill).value = b.dataset.value;
});

function loadWebhookPreview() {
  api('getWebhookUrlPreview', { token: TOKEN }).then(function (res) {
    var box = document.getElementById('webhookUrlBox');
    if (box) box.textContent = (res.ok && res.url) ? res.url : 'บันทึกข้อมูลก่อนเพื่อสร้าง URL';
  }).catch(function () {});
}

function doSave() {
  var payload = {};
  FIELD_DEFS.forEach(function (f) {
    var el = document.getElementById('f_' + f.key);
    if (el && el.value.trim()) payload[f.key] = el.value.trim();
  });
  if (!Object.keys(payload).length) return Swal.fire('ยังไม่มีข้อมูล', 'กรอกเฉพาะช่องที่ต้องการเปลี่ยน แล้วกดบันทึก', 'info');
  var btn = document.getElementById('saveBtn');
  btn.disabled = true;
  api('saveSetupProperties', { token: TOKEN, payload: payload }).then(function (res) {
    if (!res.ok) { Swal.fire('ผิดพลาด', res.message, 'error'); return; }
    Swal.fire('บันทึกแล้ว', res.locked ? 'ตั้งค่าครบแล้ว ระบบพร้อมใช้งาน' : 'บันทึกแล้ว กรอกส่วนที่เหลือต่อได้', 'success').then(boot);
  }).catch(function (err) {
    Swal.fire('ผิดพลาด', err.message, 'error');
  }).finally(function () { btn.disabled = false; });
}

function doBootstrap() {
  var userId = document.getElementById('bsUserId').value.trim();
  var name = document.getElementById('bsName').value.trim();
  if (!userId) return Swal.fire('ผิดพลาด', 'กรุณาระบุ LINE User ID', 'error');
  var btn = document.getElementById('bsBtn');
  btn.disabled = true;
  api('bootstrapFirstAdmin', { userId: userId, name: name }).then(function (res) {
    if (!res.ok) { Swal.fire('ผิดพลาด', res.message, 'error'); return; }
    Swal.fire('สำเร็จ', 'เพิ่มแอดมินเต็มแล้ว — กลับไป login ที่หน้าแอดมินได้เลย', 'success').then(function () { location.href = './'; });
  }).catch(function (err) {
    Swal.fire('ผิดพลาด', err.message, 'error');
  }).finally(function () { btn.disabled = false; });
}

function boot() {
  api('getSetupStatus', { token: TOKEN }).then(function (res) {
    if (!res.ok) {
      setContent('<div class="alert alert-danger">' + esc(res.message) + '</div>' +
        '<a href="./" class="btn btn-success">เข้าสู่ระบบด้วย LINE (แอดมินเต็ม)</a>');
      return;
    }
    renderForm(res);
  }).catch(function (err) {
    setContent('<div class="alert alert-danger">เกิดข้อผิดพลาด: ' + esc(err.message) + '</div>' +
      '<p class="hint">API_URL ที่ใช้อยู่: <code>' + esc(API_URL) + '</code> (แก้ได้ที่ assets/config.js)</p>');
  });
}

boot();
