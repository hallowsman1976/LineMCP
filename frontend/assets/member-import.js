/**
 * member-import.js — ฟอร์มนำเข้าสมาชิก (แท็บ "สมาชิก" ใน index.html, เฉพาะแอดมินเต็ม)
 *
 * อ่านไฟล์ .xlsx/.xls/.csv ในเบราว์เซอร์ด้วย SheetJS (โหลดเมื่อใช้ครั้งแรก) → จับคู่คอลัมน์ → ตรวจข้อมูล → แสดงตัวอย่าง
 * → ส่งเฉพาะคอลัมน์ที่จับคู่ไปที่ backend (action importMembers) ทีละ CHUNK แถว
 * ไฟล์ต้นฉบับไม่ถูกอัปโหลดขึ้นที่ไหน — คอลัมน์ที่ไม่ได้เลือก (บัญชีธนาคาร เงินเดือน หุ้น) ไม่ออกจากเครื่อง
 * ใช้ตัวแปร global จาก admin.js: api, esc, TOKEN, showError, onNetErr, loadMembers
 */
(function () {
  var SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
  var CHUNK = 250;
  var PREVIEW_ROWS = 20;
  var BOM_RE = new RegExp('^' + String.fromCharCode(0xFEFF));

  var FIELDS = [
    { key: 'MemberNo', label: 'เลขที่สมาชิก', required: true, re: /เลขที่สมาชิก|เลขสมาชิก|รหัสสมาชิก|^member_?no$/i },
    { key: 'Title', label: 'คำนำหน้า', re: /คำนำหน้า|^title$/i },
    { key: 'FirstName', label: 'ชื่อ', re: /^ชื่อ$|^first_?name$/i },
    { key: 'LastName', label: 'นามสกุล', re: /^(นาม)?สกุล$|^last_?name$/i },
    { key: 'NationalId', label: 'เลขบัตรประชาชน', re: /บัตรประชาชน|เลขบัตร|^national_?id$/i },
    { key: 'Affiliation', label: 'สังกัด', re: /สังกัด|หน่วยงาน|^affiliation$/i },
    { key: 'JoinDate', label: 'วันที่เข้า', re: /วันที่เข้า|วันเข้า|วันที่สมัคร|^join_?date$/i },
    { key: 'BirthDate', label: 'วันเกิด', re: /วันเกิด|^birth_?date$/i },
    { key: 'Phone', label: 'เบอร์โทร', re: /โทร|^phone$/i }
  ];
  // รูปแบบ Sheet2 ของ Member.xlsx: A เลขที่ | B คำนำหน้า | C ชื่อ | D สกุล | E เลขบัตร | F สังกัด | I วันที่เข้า | J วันเกิด
  var SHEET2_LAYOUT = { MemberNo: 0, Title: 1, FirstName: 2, LastName: 3, NationalId: 4, Affiliation: 5, JoinDate: 8, BirthDate: 9 };

  var st = { wb: null, rows: [], mapping: {}, valid: [], errors: [], busy: false };

  function $(id) { return document.getElementById(id); }

  // ---------- เปิด/ปิด + สลับโหมด ----------

  window.toggleImportPanel = function (show) {
    var panel = $('importPanel');
    if (show == null) show = panel.classList.contains('d-none');
    panel.classList.toggle('d-none', !show);
  };

  $('importModeTabs').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-imode]');
    if (!b) return;
    document.querySelectorAll('#importModeTabs .nav-link').forEach(function (x) { x.classList.toggle('active', x === b); });
    $('importFilePane').classList.toggle('d-none', b.dataset.imode !== 'file');
    $('importSinglePane').classList.toggle('d-none', b.dataset.imode !== 'single');
  });

  // ---------- โหลด SheetJS ----------

  var sheetJsPromise = null;
  function loadSheetJs() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (sheetJsPromise) return sheetJsPromise;
    sheetJsPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = SHEETJS_URL;
      s.onload = function () { resolve(window.XLSX); };
      s.onerror = function () { sheetJsPromise = null; reject(new Error('โหลดตัวอ่านไฟล์ Excel ไม่สำเร็จ — ตรวจการเชื่อมต่ออินเทอร์เน็ต')); };
      document.head.appendChild(s);
    });
    return sheetJsPromise;
  }

  // ---------- อ่านไฟล์ ----------

  $('importFile').addEventListener('change', function () {
    var file = this.files && this.files[0];
    resetResult();
    st.wb = null;
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { $('importPreview').innerHTML = alertBox('danger', 'ไฟล์ใหญ่เกิน 15 MB'); return; }
    $('importPreview').innerHTML = '<div class="text-muted small py-2">กำลังอ่านไฟล์...</div>';

    Promise.all([loadSheetJs(), file.arrayBuffer()]).then(function (r) {
      var XLSX = r[0], buf = r[1];
      if (/\.csv$/i.test(file.name)) {
        st.wb = XLSX.read(decodeCsv(buf), { type: 'string', raw: true }); // raw: คง 0 นำหน้าเลขสมาชิก/เลขบัตร
      } else {
        st.wb = XLSX.read(buf, { type: 'array', cellDates: true });
      }
      var names = st.wb.SheetNames;
      $('importSheet').innerHTML = names.map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('');
      $('importSheetWrap').classList.toggle('d-none', names.length < 2);
      var guess = guessSheet(XLSX);
      $('importSheet').value = guess.name;
      $('importHeaderRow').value = String(guess.headerRow);
      loadSheet();
    }).catch(function (err) {
      $('importPreview').innerHTML = alertBox('danger', 'อ่านไฟล์ไม่สำเร็จ: ' + (err.message || err));
    });
  });

  $('importSheet').addEventListener('change', loadSheet);
  $('importHeaderRow').addEventListener('change', loadSheet);

  /** CSV จาก Excel ภาษาไทยมักเป็น UTF-8 (มี BOM) หรือ Windows-874 */
  function decodeCsv(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(BOM_RE, ''); }
    catch (e) { return new TextDecoder('windows-874').decode(buf); }
  }

  /** เลือกชีต + แถวหัวตารางที่มีคำว่า "เลขที่สมาชิก" ในคอลัมน์ A ก่อน (Sheet2 ของ Member.xlsx) */
  function guessSheet(XLSX) {
    var names = st.wb.SheetNames;
    for (var i = 0; i < names.length; i++) {
      var rows = sheetRowsFromA1(st.wb.Sheets[names[i]]).slice(0, 3);
      for (var r = 0; r < rows.length; r++) {
        if (FIELDS[0].re.test(normHeader(rows[r][0]))) return { name: names[i], headerRow: r + 1 };
      }
    }
    return { name: names[0], headerRow: 1 };
  }

  function loadSheet() {
    if (!st.wb) return;
    var ws = st.wb.Sheets[$('importSheet').value];
    var all = sheetRowsFromA1(ws);
    var hr = Number($('importHeaderRow').value);
    var headers = hr ? (all[hr - 1] || []) : [];
    st.rows = [];
    for (var i = hr; i < all.length; i++) {
      var row = all[i];
      if (row.some(function (v) { return String(v).trim() !== ''; })) st.rows.push({ line: i + 1, cells: row });
    }
    var width = all.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    st.mapping = guessMapping(headers, hr);
    renderMapping(headers, width);
    validate();
  }

  /** อ่านทุกแถวโดยเริ่มนับจาก A1 เสมอ (ไม่งั้นชีตที่ข้อมูลเริ่มที่ B2 จะทำให้เลขแถว/คอลัมน์เพี้ยน) */
  function sheetRowsFromA1(ws) {
    if (!ws || !ws['!ref']) return [];
    var ref = XLSX.utils.decode_range(ws['!ref']);
    var range = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: ref.e });
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true, range: range });
  }

  function normHeader(v) { return String(v == null ? '' : v).replace(/\s+/g, '').trim(); }

  function guessMapping(headers, hr) {
    if (!hr) return Object.assign({}, SHEET2_LAYOUT);
    var map = {};
    var norm = headers.map(normHeader);
    FIELDS.forEach(function (f) {
      var idx = norm.findIndex(function (h) { return h && f.re.test(h); });
      if (idx !== -1) map[f.key] = idx;
    });
    // หัวตารางแบบ Member.xlsx: "ชื่อ - สกุล" คลุม 4 คอลัมน์ (คำนำหน้า/ชื่อ/สกุล/เลขบัตร) ถัดจากเลขที่สมาชิก
    var c = map.MemberNo;
    if (c != null && map.FirstName == null && map.NationalId == null && /ชื่อ-?สกุล/.test(norm[c + 1] || '')) {
      map.Title = c + 1; map.FirstName = c + 2; map.LastName = c + 3; map.NationalId = c + 4;
    }
    return map;
  }

  function colLetter(i) {
    var s = '';
    for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
    return s;
  }

  function renderMapping(headers, width) {
    var opts = function (sel) {
      var html = '<option value="">— ไม่นำเข้า —</option>';
      for (var i = 0; i < width; i++) {
        var h = String(headers[i] == null ? '' : headers[i]).trim();
        html += '<option value="' + i + '"' + (sel === i ? ' selected' : '') + '>' + colLetter(i) + (h ? ': ' + esc(h.slice(0, 30)) : '') + '</option>';
      }
      return html;
    };
    $('importMapping').innerHTML =
      '<div class="small fw-semibold mb-1">จับคู่คอลัมน์ในไฟล์ (ตรวจให้ตรงก่อนนำเข้า)</div><div class="row g-2 mb-3">' +
      FIELDS.map(function (f) {
        return '<div class="col-6 col-md-4 col-lg-3"><label class="form-label small mb-0">' + esc(f.label) +
          (f.required ? ' <span class="text-danger">*</span>' : '') + '</label>' +
          '<select class="form-select form-select-sm" data-map="' + f.key + '">' + opts(st.mapping[f.key]) + '</select></div>';
      }).join('') + '</div>';
    $('importMapping').classList.remove('d-none');
  }

  $('importMapping').addEventListener('change', function (ev) {
    var sel = ev.target.closest('select[data-map]');
    if (!sel) return;
    if (sel.value === '') delete st.mapping[sel.dataset.map];
    else st.mapping[sel.dataset.map] = Number(sel.value);
    validate();
  });

  // ---------- แปลงค่า + ตรวจ ----------

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function cellText(v, key) {
    if (v == null || v === '') return '';
    var isDateField = key === 'JoinDate' || key === 'BirthDate';
    if (v instanceof Date) {
      // SheetJS อาจให้เที่ยงคืนตามเวลาท้องถิ่นหรือ UTC — เลื่อน 12 ชม. แล้วอ่านแบบ UTC ได้วันที่ถูกทั้งสองแบบ
      var d = new Date(v.getTime() + 12 * 3600 * 1000);
      return pad2(d.getUTCDate()) + '/' + pad2(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
    }
    if (typeof v === 'number') {
      if (isDateField && v > 0 && v < 100000) {
        var p = XLSX.SSF.parse_date_code(v);
        return p ? pad2(p.d) + '/' + pad2(p.m) + '/' + p.y : String(v);
      }
      var s = String(Math.round(v));
      if (key === 'MemberNo' && s.length < 5) s = ('00000' + s).slice(-5); // Excel ตัด 0 นำหน้าทิ้ง — เลขสมาชิกใช้ 5 หลัก
      if (key === 'Phone' && /^[1-9]\d{7,8}$/.test(s)) s = '0' + s;
      return key === 'MemberNo' || key === 'NationalId' || key === 'Phone' ? s : String(v);
    }
    return String(v).replace(/\s+/g, ' ').trim();
  }

  function checkDate(s) {
    if (!s) return true;
    var m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(s) || /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return false;
    var y = Number(m[3].length === 4 ? m[3] : m[1]);
    var mo = Number(m[2]);
    var d = Number(m[3].length === 4 ? m[1] : m[3]);
    if (y > 2400) y -= 543;
    return y >= 1900 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
  }

  /** ตรวจแบบเดียวกับ cleanImportRow_ ใน Members.js — backend ตรวจซ้ำอีกรอบเสมอ */
  function checkRow(o) {
    if (!o.MemberNo) return 'ไม่มีเลขที่สมาชิก';
    if (!/^[0-9A-Za-z\-\/]{1,20}$/.test(o.MemberNo)) return 'เลขที่สมาชิกมีอักขระไม่ถูกต้อง';
    if (o.NationalId && !/^\d{13}$/.test(o.NationalId)) return 'เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก';
    if (o.Phone && !/^0\d{8,9}$/.test(o.Phone)) return 'เบอร์โทรไม่ถูกต้อง';
    if (!checkDate(o.JoinDate)) return 'วันที่เข้าอ่านไม่ได้ (' + o.JoinDate.slice(0, 20) + ')';
    if (!checkDate(o.BirthDate)) return 'วันเกิดอ่านไม่ได้ (' + o.BirthDate.slice(0, 20) + ')';
    return '';
  }

  function normalizeRow(o) {
    o.NationalId = (o.NationalId || '').replace(/[\s-]/g, '');
    o.Phone = (o.Phone || '').replace(/[\s-]/g, '');
    return o;
  }

  function validate() {
    resetResult();
    st.valid = []; st.errors = [];
    if (st.mapping.MemberNo == null) {
      $('importPreview').innerHTML = alertBox('warning', 'ยังไม่ได้เลือกคอลัมน์ "เลขที่สมาชิก"');
      return;
    }
    var seen = {};
    st.rows.forEach(function (r) {
      var o = { _line: r.line };
      FIELDS.forEach(function (f) {
        var idx = st.mapping[f.key];
        o[f.key] = idx == null ? '' : cellText(r.cells[idx], f.key);
      });
      normalizeRow(o);
      var err = checkRow(o);
      if (!err && seen[o.MemberNo]) err = 'เลขที่สมาชิก ' + o.MemberNo + ' ซ้ำกับแถว ' + seen[o.MemberNo];
      if (err) { st.errors.push({ line: r.line, message: err }); return; }
      seen[o.MemberNo] = r.line;
      st.valid.push(o);
    });
    renderPreview();
  }

  function maskId(s) { return s ? '•••••••••' + s.slice(-4) : ''; }

  function renderPreview() {
    var mapped = FIELDS.filter(function (f) { return st.mapping[f.key] != null; });
    var html = '<div class="d-flex flex-wrap gap-2 mb-2">' +
      '<span class="badge bg-success">พร้อมนำเข้า ' + st.valid.length + ' แถว</span>' +
      (st.errors.length ? '<span class="badge bg-danger">มีปัญหา ' + st.errors.length + ' แถว (จะถูกข้าม)</span>' : '') + '</div>';

    if (st.errors.length) {
      html += '<details class="small mb-2"><summary class="text-danger">ดูแถวที่มีปัญหา</summary><ul class="mb-0">' +
        st.errors.slice(0, 50).map(function (e) { return '<li>แถว ' + e.line + ': ' + esc(e.message) + '</li>'; }).join('') +
        (st.errors.length > 50 ? '<li>... และอีก ' + (st.errors.length - 50) + ' แถว</li>' : '') + '</ul></details>';
    }

    if (st.valid.length) {
      html += '<div class="table-wrap mb-2"><table class="table table-sm table-bordered bg-white mb-1"><thead><tr><th>แถว</th>' +
        mapped.map(function (f) { return '<th>' + esc(f.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        st.valid.slice(0, PREVIEW_ROWS).map(function (o) {
          return '<tr><td class="text-muted">' + o._line + '</td>' + mapped.map(function (f) {
            return '<td>' + esc(f.key === 'NationalId' ? maskId(o[f.key]) : o[f.key]) + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table>' +
        (st.valid.length > PREVIEW_ROWS ? '<div class="hint">แสดง ' + PREVIEW_ROWS + ' แถวแรกจาก ' + st.valid.length + ' แถว</div>' : '') + '</div>' +
        '<div class="row g-2 align-items-center">' +
        '<div class="col-md-6"><select class="form-select form-select-sm" id="importMode">' +
        '<option value="upsert">เพิ่มสมาชิกใหม่ + อัปเดตข้อมูลสมาชิกเดิม</option>' +
        '<option value="insertOnly">เพิ่มเฉพาะสมาชิกใหม่ (ข้ามเลขที่มีอยู่แล้ว)</option></select></div>' +
        '<div class="col-md-6"><button class="btn btn-sm btn-success w-100" id="importRunBtn">นำเข้า ' + st.valid.length + ' รายการ</button></div></div>' +
        '<p class="hint mt-1 mb-0">ช่องว่างในไฟล์จะไม่ลบค่าเดิม · การผูกบัญชี LINE ของสมาชิกไม่ถูกแก้ไข</p>' +
        '<div id="importProgress" class="mt-2"></div>';
    } else {
      html += alertBox('warning', 'ไม่มีแถวที่พร้อมนำเข้า — ตรวจการจับคู่คอลัมน์และแถวหัวตาราง');
    }
    $('importPreview').innerHTML = html;
    var btn = $('importRunBtn');
    if (btn) btn.addEventListener('click', runImport);
  }

  function resetResult() { var p = $('importProgress'); if (p) p.innerHTML = ''; }

  function alertBox(type, msg) { return '<div class="alert alert-' + type + ' small py-2 mb-2">' + esc(msg) + '</div>'; }

  // ---------- ส่งขึ้นระบบ ----------

  function runImport() {
    if (st.busy || !st.valid.length) return;
    var mode = $('importMode').value;
    Swal.fire({
      title: 'ยืนยันการนำเข้า',
      text: 'นำเข้าสมาชิก ' + st.valid.length + ' รายการ (' + (mode === 'upsert' ? 'เพิ่มใหม่ + อัปเดตของเดิม' : 'เพิ่มเฉพาะรายการใหม่') + ')',
      icon: 'question', showCancelButton: true, confirmButtonText: 'นำเข้า', cancelButtonText: 'ยกเลิก'
    }).then(function (c) { if (c.isConfirmed) sendChunks(st.valid.slice(), mode); });
  }

  function sendChunks(rows, mode) {
    st.busy = true;
    var btn = $('importRunBtn');
    btn.disabled = true;
    var total = rows.length, done = 0;
    var sum = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    var progress = function () {
      var pct = Math.round(done / total * 100);
      $('importProgress').innerHTML = '<div class="progress" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100">' +
        '<div class="progress-bar bg-success" style="width:' + pct + '%">' + done + ' / ' + total + '</div></div>';
    };
    progress();

    var next = function () {
      if (!rows.length) return finish(null);
      var batch = rows.splice(0, CHUNK);
      return api('importMembers', { token: TOKEN, rows: batch, mode: mode }).then(function (res) {
        if (!res.ok) return finish(res);
        sum.inserted += res.inserted; sum.updated += res.updated; sum.skipped += res.skipped;
        sum.errors = sum.errors.concat(res.errors || []);
        done += batch.length;
        progress();
        return next();
      });
    };

    var finish = function (failRes) {
      st.busy = false;
      btn.disabled = false;
      var lines = 'เพิ่มใหม่ ' + sum.inserted + ' · อัปเดต ' + sum.updated + ' · ข้าม (มีอยู่แล้ว) ' + sum.skipped +
        ' · ไม่ผ่านการตรวจ ' + (sum.errors.length + st.errors.length);
      if (sum.errors.length) {
        $('importProgress').insertAdjacentHTML('beforeend', '<ul class="small text-danger mt-2 mb-0">' +
          sum.errors.slice(0, 30).map(function (e) { return '<li>แถว ' + esc(e.line) + ': ' + esc(e.message) + '</li>'; }).join('') + '</ul>');
      }
      if (done) loadMembers();
      if (failRes) {
        var msg = failRes.message || String(failRes);
        if (/session|login|ถูกถอดสิทธิ์/i.test(msg)) return showError(failRes);
        Swal.fire('นำเข้าไม่ครบ', 'หยุดที่รายการที่ ' + (done + 1) + ' จาก ' + total + ': ' + msg +
          (done ? '\n\nรายการก่อนหน้านี้บันทึกแล้ว (' + lines + ') — กดนำเข้าซ้ำได้ ระบบจะอัปเดตทับรายการเดิม' : ''), 'error');
        return;
      }
      Swal.fire('นำเข้าเสร็จสิ้น', lines, 'success');
    };

    next().catch(function (err) { finish({ message: 'เชื่อมต่อระบบไม่สำเร็จ: ' + (err && err.message || err) }); });
  }

  // ---------- ไฟล์ตัวอย่าง ----------

  window.downloadImportTemplate = function () {
    var csv = String.fromCharCode(0xFEFF) + FIELDS.map(function (f) { return f.label; }).join(',') + '\r\n' +
      '00001,นาย,ตัวอย่าง,ทดสอบ,1234567890123,โรงพยาบาลตัวอย่าง,01/10/2560,15/06/2530,0812345678\r\n';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'member_import_template.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  };

  // ---------- เพิ่มทีละคน ----------

  window.doImportSingle = function (ev) {
    ev.preventDefault();
    var form = ev.target;
    var o = {};
    FIELDS.forEach(function (f) { o[f.key] = String(form.elements[f.key].value || '').replace(/\s+/g, ' ').trim(); });
    normalizeRow(o);
    var err = checkRow(o);
    if (err) { Swal.fire('ข้อมูลไม่ถูกต้อง', err, 'error'); return false; }

    var btn = $('importSingleBtn');
    btn.disabled = true;
    api('importMembers', { token: TOKEN, rows: [o], mode: 'upsert' }).then(function (res) {
      if (!res.ok) return showError(res);
      if (res.errors && res.errors.length) return Swal.fire('ข้อมูลไม่ถูกต้อง', res.errors[0].message, 'error');
      Swal.fire('บันทึกแล้ว', (res.inserted ? 'เพิ่มสมาชิกใหม่' : 'อัปเดตข้อมูลสมาชิก') + ' เลขที่ ' + o.MemberNo, 'success');
      form.reset();
      $('memberSearch').value = o.MemberNo;
      loadMembers();
    }).catch(onNetErr).finally(function () { btn.disabled = false; });
    return false;
  };
})();
