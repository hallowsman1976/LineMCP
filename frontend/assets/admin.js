/**
 * admin.js — หน้าแอดมิน (index.html)
 *
 * LINE Login flow (Callback URL ใน LINE Developers Console = URL ของหน้านี้ = FRONTEND_URL):
 *   1. สุ่ม state เก็บใน sessionStorage → ขอ login URL จาก backend (getPublicConfig)
 *   2. LINE redirect กลับมาที่หน้านี้พร้อม ?code=&state= → ตรวจ state ตรงกับที่เก็บไว้ (กัน CSRF)
 *   3. ส่ง code ไปแลก session token ที่ backend (exchangeLoginCode) → เก็บใน localStorage
 */
var api = lmcp.api;
var esc = lmcp.esc;
var S = lmcp.session.get();
var TOKEN = S.token, ROLE = S.role, NAME = S.name;
var activeThreadId = null;
var pollTimer = null;
var STATE_KEY = 'lmcp_oauth_state';

function randomState() {
  var a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
}

function showLoginScreen(html) {
  document.getElementById('appScreen').classList.add('d-none');
  document.getElementById('loginScreen').classList.remove('d-none');
  document.getElementById('loginBody').innerHTML = html;
}

function renderLoginButton() {
  var state = randomState();
  try { sessionStorage.setItem(STATE_KEY, state); } catch (e) {}
  showLoginScreen('<div class="text-muted small py-3">กำลังโหลด...</div>');
  api('getPublicConfig', { state: state }).then(function (cfg) {
    var expected = lmcp.frontendBaseUrl();
    var html = '';
    if (cfg.setupIncomplete || !cfg.loginUrl) {
      html += '<p class="text-danger small">ยังตั้งค่าระบบไม่ครบ (LINE Login / FRONTEND_URL) กรุณาไปหน้าตั้งค่าก่อน</p>' +
        '<a class="btn btn-warning w-100" href="setup.html">ไปหน้าตั้งค่าระบบ</a>';
    } else {
      html += '<a class="btn btn-success w-100" href="' + esc(cfg.loginUrl) + '">เข้าสู่ระบบด้วย LINE</a>';
    }
    html += '<div class="text-start mt-3"><p class="hint mb-1">Callback URL ที่ต้องตั้งใน LINE Developers Console (LINE Login channel):</p>' +
      '<code class="redirect-uri-box">' + esc(cfg.redirectUri || expected) + '</code>';
    if (cfg.redirectUri && cfg.redirectUri !== expected) {
      html += '<p class="small text-danger mt-2 mb-0">⚠️ FRONTEND_URL ในระบบ (' + esc(cfg.redirectUri) + ') ไม่ตรงกับหน้านี้ (' + esc(expected) +
        ') — login แล้วจะถูกส่งกลับไปที่อื่น แก้ได้ที่หน้าตั้งค่า</p>';
    }
    html += '</div>';
    document.getElementById('loginBody').innerHTML = html;
  }).catch(function (err) {
    document.getElementById('loginBody').innerHTML = '<p class="text-danger small">เชื่อมต่อระบบไม่สำเร็จ: ' + esc(err.message) + '</p>' +
      '<button class="btn btn-outline-secondary btn-sm" onclick="renderLoginButton()">ลองใหม่</button>';
  });
}

/** จัดการตอน LINE redirect กลับมา — คืน true ถ้าหน้านี้เป็น callback */
function handleOAuthCallback() {
  var params = new URLSearchParams(location.search);
  var code = params.get('code'), state = params.get('state'), error = params.get('error');
  if (!state || !(code || error)) return false;

  history.replaceState(null, '', location.pathname); // ลบ code ออกจาก URL ทันที (ใช้ได้ครั้งเดียวอยู่แล้ว)
  var expectedState = '';
  try { expectedState = sessionStorage.getItem(STATE_KEY) || ''; sessionStorage.removeItem(STATE_KEY); } catch (e) {}

  var retry = '<button class="btn btn-success w-100 mt-2" onclick="renderLoginButton()">ลองเข้าสู่ระบบอีกครั้ง</button>';
  if (error) {
    showLoginScreen('<p class="text-danger">เข้าสู่ระบบไม่สำเร็จ: ' + esc(params.get('error_description') || error) + '</p>' + retry);
    return true;
  }
  if (!expectedState || state !== expectedState) {
    showLoginScreen('<p class="text-danger">การเข้าสู่ระบบไม่ถูกต้องหรือหมดอายุ (state ไม่ตรง) กรุณาเริ่มใหม่จากหน้านี้</p>' + retry);
    return true;
  }

  showLoginScreen('<div class="text-muted py-3">กำลังยืนยันตัวตนกับ LINE...</div>');
  api('exchangeLoginCode', { code: code }).then(function (res) {
    if (!res.ok) {
      var html = '<p class="text-danger small text-start">' + esc(res.message) + '</p>';
      var m = /(U[0-9a-f]{32})/.exec(res.message || '');
      if (m) {
        html += '<p class="small text-muted text-start">ถ้ายังไม่มีแอดมินในระบบเลย ให้ไปเพิ่มตัวเองเป็นแอดมินคนแรกที่ ' +
          '<a href="setup.html?userId=' + encodeURIComponent(m[1]) + '">หน้าตั้งค่า</a></p>';
      }
      showLoginScreen(html + retry);
      return;
    }
    lmcp.session.set({ token: res.token, role: res.role, name: res.displayName });
    S = lmcp.session.get();
    TOKEN = S.token; ROLE = S.role; NAME = S.name;
    bootApp();
  }).catch(function (err) {
    showLoginScreen('<p class="text-danger">เกิดข้อผิดพลาด: ' + esc(err.message) + '</p>' + retry);
  });
  return true;
}

function doLogout() {
  if (pollTimer) clearInterval(pollTimer);
  var t = TOKEN;
  lmcp.session.clear();
  TOKEN = '';
  api('logoutAdmin', { token: t }).catch(function () {}).then(function () { location.replace(location.pathname); });
}

/** session หมดอายุ/ถูกถอดสิทธิ์ → เด้งกลับหน้า login แทนการโชว์ error ซ้ำทุก 18 วินาที */
function isSessionError(msg) {
  return /session|login|ถูกถอดสิทธิ์/i.test(msg || '');
}

function showError(res) {
  var msg = (res && res.message) || String(res || 'เกิดข้อผิดพลาด');
  if (isSessionError(msg)) {
    if (pollTimer) clearInterval(pollTimer);
    lmcp.session.clear();
    TOKEN = '';
    Swal.fire('กรุณาเข้าสู่ระบบใหม่', msg, 'warning').then(renderLoginButton);
    return;
  }
  Swal.fire('ผิดพลาด', msg, 'error');
}

function onNetErr(err) { showError({ message: 'เชื่อมต่อระบบไม่สำเร็จ: ' + (err && err.message || err) }); }

function bootApp() {
  document.getElementById('loginScreen').classList.add('d-none');
  document.getElementById('appScreen').classList.remove('d-none');
  document.getElementById('meLabel').textContent = NAME + ' (' + (ROLE === 'ADMIN_FULL' ? 'แอดมินเต็ม' : 'เจ้าหน้าที่ตอบแชท') + ')';
  var isFull = ROLE === 'ADMIN_FULL';
  document.getElementById('adminsTabItem').classList.toggle('d-none', !isFull);
  document.getElementById('settingsLink').classList.toggle('d-none', !isFull);

  switchTab('inbox');
  loadThreads();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(function () {
    if (document.hidden) return; // ไม่ยิง API ตอนแท็บถูกซ่อน ประหยัดโควตา Apps Script
    loadThreads(true);
    if (activeThreadId) loadMessages(activeThreadId, true);
  }, 18000); // poll ทุก 18 วินาที ตามที่ตกลงไว้ (15-20s)
}

document.querySelectorAll('#mainTabs .nav-link').forEach(function (btn) {
  btn.addEventListener('click', function () { switchTab(btn.dataset.tab); });
});

function switchTab(tab) {
  document.querySelectorAll('#mainTabs .nav-link').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === tab); });
  document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.add('d-none'); });
  document.getElementById('tab-' + tab).classList.remove('d-none');
  if (tab === 'welfare') loadClaims();
  if (tab === 'slips') loadSlips();
  if (tab === 'members') loadMembers();
  if (tab === 'admins') loadAdmins();
}

function loadingRow(tbodyId, cols) {
  document.getElementById(tbodyId).innerHTML = '<tr><td colspan="' + cols + '" class="text-center text-muted py-3">กำลังโหลด...</td></tr>';
}

// ---------- Inbox ----------

function loadThreads(silent) {
  return api('listChatThreads', { token: TOKEN }).then(function (res) {
    if (!res.ok) { if (!silent || isSessionError(res.message)) showError(res); return; }
    var el = document.getElementById('threadList');
    var totalUnread = 0;
    el.innerHTML = res.threads.map(function (t) {
      totalUnread += Number(t.UnreadCount || 0);
      return '<div class="thread-item' + (t.LineUserId === activeThreadId ? ' active' : '') + '" data-uid="' + esc(t.LineUserId) + '">' +
        '<div class="name">' + esc(t.MemberName || t.LineUserId) + (t.UnreadCount > 0 ? '<span class="unread">' + esc(t.UnreadCount) + '</span>' : '') + '</div>' +
        '<div class="preview">' + esc(t.LastMessageText || '') + '</div></div>';
    }).join('') || '<div class="p-3 text-muted small">ยังไม่มีการสนทนา</div>';
    var badge = document.getElementById('badgeUnread');
    if (totalUnread > 0) { badge.textContent = totalUnread; badge.classList.remove('d-none'); }
    else badge.classList.add('d-none');
  }).catch(function (err) { if (!silent) onNetErr(err); });
}

document.getElementById('threadList').addEventListener('click', function (ev) {
  var item = ev.target.closest('.thread-item');
  if (item) openThread(item.dataset.uid);
});

function openThread(lineUserId) {
  activeThreadId = lineUserId;
  document.getElementById('chatInputWrap').classList.remove('d-none');
  document.getElementById('chatMessages').innerHTML = '<div class="text-muted small py-3">กำลังโหลด...</div>';
  document.querySelectorAll('.thread-item').forEach(function (el) { el.classList.toggle('active', el.dataset.uid === lineUserId); });
  loadMessages(lineUserId, false);
  api('markThreadRead', { token: TOKEN, lineUserId: lineUserId }).then(function () { loadThreads(true); }).catch(function () {});
}

function loadMessages(lineUserId, silent) {
  api('getThreadMessages', { token: TOKEN, lineUserId: lineUserId, limit: 200 }).then(function (res) {
    if (lineUserId !== activeThreadId) return; // ผู้ใช้เปลี่ยนห้องไปแล้วระหว่างรอ
    if (!res.ok) { if (!silent || isSessionError(res.message)) showError(res); return; }
    var el = document.getElementById('chatMessages');
    var wasAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
    var first = res.messages[0];
    document.getElementById('chatHeader').textContent = first && first.MemberNo ? 'สมาชิกเลขที่ ' + first.MemberNo : lineUserId;
    el.innerHTML = res.messages.map(function (m) {
      var t = m.MsgType === 'text' ? esc(m.Text) : '[' + esc(m.MsgType) + '] ' + esc(m.Text || '');
      return '<div class="bubble ' + (m.Direction === 'IN' ? 'in' : 'out') + '">' + t +
        '<small>' + esc(new Date(m.CreatedAt).toLocaleString('th-TH')) + (m.HandledBy ? ' · ' + esc(m.HandledBy) : '') + '</small></div>';
    }).join('');
    if (!silent || wasAtBottom) el.scrollTop = el.scrollHeight;
  }).catch(function (err) { if (!silent) onNetErr(err); });
}

function doSendReply(ev) {
  ev.preventDefault();
  var input = document.getElementById('replyText');
  var btn = document.getElementById('replyBtn');
  var text = input.value.trim();
  if (!text || !activeThreadId) return false;
  var target = activeThreadId;
  btn.disabled = true;
  api('sendChatReply', { token: TOKEN, lineUserId: target, text: text }).then(function (res) {
    if (!res.ok) return showError(res);
    input.value = ''; // ล้างเมื่อส่งสำเร็จเท่านั้น — ส่งไม่ผ่านข้อความจะไม่หาย
    loadMessages(target, true);
    loadThreads(true);
  }).catch(onNetErr).finally(function () { btn.disabled = false; });
  return false;
}

// ---------- Welfare claims ----------

var STATUS_LABEL = { DRAFT: 'รอส่งเอกสาร', SUBMITTED: 'รอตรวจสอบ', UNDER_REVIEW: 'กำลังตรวจสอบ', APPROVED: 'อนุมัติแล้ว', REJECTED: 'ไม่อนุมัติ', PAID: 'จ่ายเงินแล้ว' };

function fmtDate(v) { return v ? new Date(v).toLocaleDateString('th-TH') : '-'; }

function loadClaims() {
  var status = document.getElementById('welfareStatusFilter').value;
  loadingRow('claimsBody', 9);
  api('listWelfareClaims', { token: TOKEN, status: status }).then(function (res) {
    if (!res.ok) return showError(res);
    document.getElementById('claimsBody').innerHTML = res.claims.map(function (c) {
      var actions = '';
      var id = esc(c.ClaimId);
      if (ROLE === 'ADMIN_FULL' && (c.Status === 'SUBMITTED' || c.Status === 'UNDER_REVIEW')) {
        actions = '<button class="btn btn-sm btn-success me-1" data-act="review" data-id="' + id + '" data-decision="APPROVED">อนุมัติ</button>' +
          '<button class="btn btn-sm btn-danger" data-act="review" data-id="' + id + '" data-decision="REJECTED">ไม่อนุมัติ</button>';
      } else if (ROLE === 'ADMIN_FULL' && c.Status === 'APPROVED') {
        actions = '<button class="btn btn-sm btn-primary" data-act="paid" data-id="' + id + '">บันทึกจ่ายเงินแล้ว</button>';
      }
      return '<tr><td>' + id + '</td><td>' + esc(c.MemberName) + ' (' + esc(c.MemberNo) + ')</td><td>' + esc(c.TypeLabel) +
        '</td><td>' + Number(c.AmountBaht || 0).toLocaleString() + ' บาท</td><td>' + esc(c.DocCount) + ' ไฟล์</td>' +
        '<td>' + fmtDate(c.SubmittedAt) + '</td><td>' + fmtDate(c.DeadlineDate) + '</td>' +
        '<td><span class="badge bg-secondary">' + esc(STATUS_LABEL[c.Status] || c.Status) + '</span></td>' +
        '<td class="text-nowrap">' + actions + '</td></tr>';
    }).join('') || '<tr><td colspan="9" class="text-center text-muted py-3">ไม่มีรายการ</td></tr>';
  }).catch(onNetErr);
}

document.getElementById('claimsBody').addEventListener('click', function (ev) {
  var b = ev.target.closest('button[data-act]');
  if (!b) return;
  if (b.dataset.act === 'review') doReview(b.dataset.id, b.dataset.decision);
  if (b.dataset.act === 'paid') doMarkPaid(b.dataset.id, b);
});

function doReview(claimId, decision) {
  Swal.fire({
    title: decision === 'APPROVED' ? 'ยืนยันการอนุมัติ' : 'ยืนยันไม่อนุมัติ',
    text: 'คำขอ ' + claimId,
    input: 'text', inputPlaceholder: 'หมายเหตุ (ถ้ามี)',
    showCancelButton: true, confirmButtonText: 'ยืนยัน', cancelButtonText: 'ยกเลิก',
    showLoaderOnConfirm: true,
    preConfirm: function (notes) {
      return api('reviewWelfareClaim', { token: TOKEN, claimId: claimId, decision: decision, notes: notes || '' })
        .catch(function (err) { return { ok: false, message: err.message }; });
    }
  }).then(function (r) {
    if (!r.isConfirmed) return;
    if (!r.value.ok) return showError(r.value);
    Swal.fire('สำเร็จ', 'บันทึกผลแล้ว', 'success');
    loadClaims();
  });
}

function doMarkPaid(claimId, btn) {
  Swal.fire({ title: 'บันทึกว่าจ่ายเงินแล้ว?', text: 'คำขอ ' + claimId, showCancelButton: true, confirmButtonText: 'ยืนยัน', cancelButtonText: 'ยกเลิก' })
    .then(function (r) {
      if (!r.isConfirmed) return;
      btn.disabled = true;
      api('markClaimPaid', { token: TOKEN, claimId: claimId }).then(function (res) {
        if (!res.ok) { btn.disabled = false; return showError(res); }
        loadClaims();
      }).catch(function (err) { btn.disabled = false; onNetErr(err); });
    });
}

// ---------- Payment slips ----------

function loadSlips() {
  loadingRow('slipsBody', 5);
  api('listPaymentSlips', { token: TOKEN, status: '' }).then(function (res) {
    if (!res.ok) return showError(res);
    document.getElementById('slipsBody').innerHTML = res.slips.map(function (s) {
      var action = s.Status === 'NEW' ? '<button class="btn btn-sm btn-primary" data-id="' + esc(s.SlipId) + '">บันทึกยอดแล้ว</button>' : '';
      return '<tr><td>' + esc(s.SlipId) + '</td><td>' + esc(s.MemberNo) + '</td><td>' + esc(new Date(s.UploadedAt).toLocaleString('th-TH')) +
        '</td><td><span class="badge bg-' + (s.Status === 'NEW' ? 'warning' : 'success') + '">' + esc(s.Status) + '</span></td><td>' + action + '</td></tr>';
    }).join('') || '<tr><td colspan="5" class="text-center text-muted py-3">ไม่มีรายการ</td></tr>';
  }).catch(onNetErr);
}

document.getElementById('slipsBody').addEventListener('click', function (ev) {
  var b = ev.target.closest('button[data-id]');
  if (!b) return;
  b.disabled = true;
  api('markSlipRecorded', { token: TOKEN, slipId: b.dataset.id }).then(function (res) {
    if (!res.ok) { b.disabled = false; return showError(res); }
    loadSlips();
  }).catch(function (err) { b.disabled = false; onNetErr(err); });
});

// ---------- Members ----------

function loadMembers() {
  var q = document.getElementById('memberSearch').value;
  loadingRow('membersBody', 4);
  api('listMembers', { token: TOKEN, query: q }).then(function (res) {
    if (!res.ok) return showError(res);
    document.getElementById('membersBody').innerHTML = res.members.map(function (m) {
      return '<tr><td>' + esc(m.MemberNo) + '</td><td>' + esc((m.Title || '') + (m.FirstName || '') + ' ' + (m.LastName || '')) +
        '</td><td>' + esc(m.Affiliation || '') + '</td><td>' + (m.LineUserId ? '✅' : '—') + '</td></tr>';
    }).join('') || '<tr><td colspan="4" class="text-center text-muted py-3">ไม่มีรายการ</td></tr>';
  }).catch(onNetErr);
}

// ---------- Admins ----------

function loadAdmins() {
  loadingRow('adminsBody', 5);
  api('listAdmins', { token: TOKEN }).then(function (res) {
    if (!res.ok) return showError(res);
    document.getElementById('adminsBody').innerHTML = res.admins.map(function (a) {
      var active = String(a.Active) !== 'false';
      return '<tr><td><code>' + esc(a.LineUserId) + '</code></td><td>' + esc(a.DisplayName) + '</td><td>' + (a.Role === 'ADMIN_FULL' ? 'แอดมินเต็ม' : 'เจ้าหน้าที่ตอบแชท') +
        '</td><td>' + (active ? 'เปิดใช้งาน' : 'ปิดใช้งาน') + '</td>' +
        '<td><button class="btn btn-sm btn-outline-secondary" data-id="' + esc(a.LineUserId) + '" data-activate="' + (!active) + '">' +
        (active ? 'ปิดใช้งาน' : 'เปิดใช้งาน') + '</button></td></tr>';
    }).join('');
  }).catch(onNetErr);
}

document.getElementById('adminsBody').addEventListener('click', function (ev) {
  var b = ev.target.closest('button[data-id]');
  if (!b) return;
  b.disabled = true;
  api('setAdminActive', { token: TOKEN, lineUserId: b.dataset.id, active: b.dataset.activate === 'true' }).then(function (res) {
    if (!res.ok) { b.disabled = false; return showError(res); }
    loadAdmins();
  }).catch(function (err) { b.disabled = false; onNetErr(err); });
});

function doAddAdmin() {
  var id = document.getElementById('newAdminId').value.trim();
  var name = document.getElementById('newAdminName').value.trim();
  var role = document.getElementById('newAdminRole').value;
  if (!id) return Swal.fire('ผิดพลาด', 'กรุณาระบุ LINE User ID', 'error');
  api('addAdmin', { token: TOKEN, lineUserId: id, displayName: name, role: role }).then(function (res) {
    if (!res.ok) return showError(res);
    document.getElementById('newAdminId').value = '';
    document.getElementById('newAdminName').value = '';
    loadAdmins();
  }).catch(onNetErr);
}

// ---------- boot ----------

if (!handleOAuthCallback()) {
  if (TOKEN) bootApp();
  else renderLoginButton();
}
