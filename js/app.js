(function () {
  "use strict";

  var STORAGE_KEY = "worktouch:documents";
  var USER_KEY = "worktouch:userName";
  var THEME_KEY = "worktouch:theme";
  var TASK_STATUSES = ["예정", "진행중", "완료"];
  var PRIORITIES = ["높음", "보통", "낮음"];
  var TASK_TYPES = ["인계", "인수"];
  var DUE_SOON_DAYS = 3;

  var LEGACY_STATUS_MAP = { "미착수": "예정", "보류": "예정" };
  function normalizeStatus(raw) {
    var s = String(raw || "").trim();
    if (TASK_STATUSES.indexOf(s) >= 0) return s;
    if (LEGACY_STATUS_MAP[s]) return LEGACY_STATUS_MAP[s];
    return "예정";
  }
  function normalizePriority(raw) {
    var p = String(raw || "").trim();
    if (PRIORITIES.indexOf(p) >= 0) return p;
    if (p === "중요" || p.toUpperCase() === "Y" || p.toUpperCase() === "TRUE") return "높음";
    return "보통";
  }
  function normalizeType(raw, fallback) {
    var t = String(raw || "").trim();
    if (TASK_TYPES.indexOf(t) >= 0) return t;
    return fallback || "인계";
  }

  // ---------- 아이콘 (인라인 SVG) ----------
  function svg(inner, extra) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' + (extra || "") + '>' + inner + '</svg>';
  }
  var ICON_FILE = svg('<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z"/>');
  var ICON_FOLDER = svg('<path d="M3 7a2 2 0 0 1 2-2h3.5l1.5 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>');
  var ICON_ALERT = svg('<path d="M12 9v4"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 17h.01"/>');
  var ICON_CHECK = svg('<path d="M20 6 9 17l-5-5"/>');
  var ICON_PRINTER = svg('<path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/>');
  var ICON_EXCEL = svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>');
  var ICON_PIE = svg('<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>');
  var ICON_TRASH = svg('<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>');
  var ICON_PLUS = svg('<path d="M12 5v14"/><path d="M5 12h14"/>');

  // ---------- 상태 ----------
  var state = {
    userName: "",
    documents: [],
    currentView: "dashboard",
    wizardStep: 1,
    draft: null,
    selectedDocId: null,
    docSearch: "",
    taskFilter: { search: "", type: "", status: "", priority: "" }
  };

  // ---------- 저장소 ----------
  function loadState() {
    state.userName = localStorage.getItem(USER_KEY) || "";
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      state.documents = raw ? JSON.parse(raw) : [];
    } catch (e) {
      state.documents = [];
    }
  }

  function saveDocuments() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.documents));
  }

  function saveUserName() {
    localStorage.setItem(USER_KEY, state.userName);
  }

  // ---------- 다크모드 ----------
  function getSavedTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (e) {
      return null;
    }
  }

  function getEffectiveTheme() {
    var saved = getSavedTheme();
    if (saved === "light" || saved === "dark") return saved;
    return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  }

  function updateThemeToggleUI(theme) {
    var btn = document.getElementById("themeToggleBtn");
    if (!btn) return;
    btn.classList.toggle("is-dark", theme === "dark");
    var label = btn.querySelector(".theme-label");
    if (label) label.textContent = theme === "dark" ? "라이트 모드" : "다크 모드";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {}
    updateThemeToggleUI(theme);
  }

  // ---------- 유틸 ----------
  function uid(prefix) {
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function todayStr() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    var due = new Date(dateStr + "T00:00:00");
    if (isNaN(due.getTime())) return null;
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.round((due - now) / 86400000);
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function docOverallStatus(doc) {
    if (!doc.tasks.length) return "완료";
    if (doc.tasks.some(function (t) { return t.status === "진행중"; })) return "진행중";
    if (doc.tasks.every(function (t) { return t.status === "완료"; })) return "완료";
    return "예정";
  }

  function statusBadgeClass(status) {
    if (status === "진행중") return "badge-blue";
    if (status === "완료") return "badge-success";
    return "badge-gray";
  }

  function filterTasks(tasks) {
    var f = state.taskFilter;
    var q = f.search.trim().toLowerCase();
    return tasks.filter(function (t) {
      if (q && t.name.toLowerCase().indexOf(q) < 0) return false;
      if (f.type && t.type !== f.type) return false;
      if (f.status && t.status !== f.status) return false;
      if (f.priority && t.priority !== f.priority) return false;
      return true;
    });
  }

  function isTaskFilterActive() {
    var f = state.taskFilter;
    return !!(f.search.trim() || f.type || f.status || f.priority);
  }

  // ---------- 라우팅 ----------
  function switchView(view) {
    state.currentView = view;
    document.querySelectorAll(".view").forEach(function (el) {
      el.hidden = el.id !== "view-" + view;
    });
    document.querySelectorAll(".nav-item").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.dataset.view === view);
    });
    if (view === "dashboard") renderDashboard();
    if (view === "handover") renderWizard();
    if (view === "docbox") renderDocbox();
  }

  // ---------- 대시보드 ----------
  function renderDashboard() {
    var allTasks = [];
    state.documents.forEach(function (doc) {
      doc.tasks.forEach(function (t) { allTasks.push(t); });
    });

    var doneCount = allTasks.filter(function (t) { return t.status === "완료"; }).length;
    var completionRate = allTasks.length ? Math.round((doneCount / allTasks.length) * 100) : 0;

    document.getElementById("statTotal").textContent = allTasks.length;
    document.getElementById("statInProgress").textContent =
      allTasks.filter(function (t) { return t.status === "진행중"; }).length;
    document.getElementById("statDone").textContent = doneCount;
    document.getElementById("statCompletionRate").textContent = completionRate + "%";

    var dueSoonTasks = allTasks
      .map(function (t, i) { return { task: t, days: daysUntil(t.dueDate) }; })
      .filter(function (x) {
        return x.task.status !== "완료" && x.days !== null && x.days <= DUE_SOON_DAYS;
      })
      .sort(function (a, b) { return a.days - b.days; });

    document.getElementById("statDueSoon").textContent = dueSoonTasks.length;

    // 최근 인수인계 문서
    var recentDocs = state.documents
      .slice()
      .sort(function (a, b) { return (b.createdAt || "").localeCompare(a.createdAt || ""); })
      .slice(0, 5);

    var recentHtml = recentDocs.length ? recentDocs.map(function (doc) {
      var status = docOverallStatus(doc);
      return (
        '<div class="doc-row">' +
          '<div class="doc-row-icon">' + ICON_FILE + '</div>' +
          '<div class="doc-row-main">' +
            '<div class="doc-row-title">' + escapeHtml(doc.title) + '</div>' +
            '<div class="doc-row-sub">' + escapeHtml(doc.createdAt || "-") + '</div>' +
          '</div>' +
          '<div class="badge ' + statusBadgeClass(status) + '">' + status + '</div>' +
        '</div>'
      );
    }).join("") : '<div class="list-empty">아직 등록된 인수인계 문서가 없습니다.</div>';
    document.getElementById("recentDocList").innerHTML = recentHtml;

    // 마감 임박 업무
    var dueHtml = dueSoonTasks.length ? dueSoonTasks.slice(0, 6).map(function (x) {
      var chipLabel = x.days < 0 ? (-x.days) + "일 지남" : (x.days === 0 ? "D-day" : "D-" + x.days);
      return (
        '<div class="due-row">' +
          '<div class="due-icon">' + ICON_ALERT + '</div>' +
          '<div class="due-main">' +
            '<div class="due-title">' + escapeHtml(x.task.name) + '</div>' +
            '<div class="due-sub">기한 ' + escapeHtml(x.task.dueDate || "-") + '</div>' +
          '</div>' +
          '<div class="due-chip">' + chipLabel + '</div>' +
        '</div>'
      );
    }).join("") : '<div class="list-empty">마감 임박 업무가 없습니다.</div>';
    document.getElementById("dueSoonList").innerHTML = dueHtml;
  }

  // ---------- 인수인계 작성 (마법사) ----------
  function newDraft() {
    return {
      title: "",
      from: state.userName || "",
      to: "",
      date: todayStr(),
      tasks: []
    };
  }

  function newTaskRow(type) {
    return {
      id: uid("task"), name: "", assignee: "", dueDate: "",
      status: "예정", priority: "보통", type: type || "인계", memo: ""
    };
  }

  function renderWizard() {
    if (!state.draft) state.draft = newDraft();
    state.wizardStep = state.wizardStep || 1;

    document.querySelectorAll(".step").forEach(function (el) {
      var n = parseInt(el.dataset.step, 10);
      el.classList.toggle("is-active", n === state.wizardStep);
      el.classList.toggle("is-done", n < state.wizardStep);
    });

    for (var i = 1; i <= 4; i++) {
      document.getElementById("step-" + i).hidden = i !== state.wizardStep;
    }

    if (state.wizardStep === 1) {
      document.getElementById("docTitleInput").value = state.draft.title;
      document.getElementById("docFromInput").value = state.draft.from || state.userName;
      document.getElementById("docToInput").value = state.draft.to;
      document.getElementById("docDateInput").value = state.draft.date;
    }

    if (state.wizardStep === 2) {
      renderTaskTable();
    }

    if (state.wizardStep === 3) {
      renderReview();
    }

    var prevBtn = document.getElementById("prevStepBtn");
    var nextBtn = document.getElementById("nextStepBtn");
    var exportBtn = document.getElementById("exportDraftBtn");

    prevBtn.style.visibility = state.wizardStep === 1 ? "hidden" : "visible";
    exportBtn.style.visibility = state.wizardStep === 4 ? "hidden" : "visible";

    if (state.wizardStep === 4) {
      nextBtn.style.visibility = "hidden";
      prevBtn.style.visibility = "hidden";
    } else {
      nextBtn.style.visibility = "visible";
      nextBtn.textContent = state.wizardStep === 3 ? "저장" : "다음";
    }
  }

  function renderTaskTable() {
    var container = document.getElementById("taskTable");
    if (!state.draft.tasks.length) {
      container.innerHTML = '<div class="task-table-empty">등록된 업무가 없습니다. "+ 업무 추가"로 인계할 업무를 입력하세요.</div>';
      return;
    }
    container.innerHTML = state.draft.tasks.map(function (task) {
      return (
        '<div class="task-row" data-task-id="' + task.id + '">' +
          '<input type="text" class="t-name" placeholder="업무명" value="' + escapeHtml(task.name) + '">' +
          '<input type="text" class="t-assignee" placeholder="담당자" value="' + escapeHtml(task.assignee) + '">' +
          '<input type="date" class="t-due" value="' + escapeHtml(task.dueDate) + '">' +
          '<select class="t-status">' +
            TASK_STATUSES.map(function (s) {
              return '<option value="' + s + '"' + (s === task.status ? " selected" : "") + '>' + s + '</option>';
            }).join("") +
          '</select>' +
          '<select class="t-priority">' +
            PRIORITIES.map(function (p) {
              return '<option value="' + p + '"' + (p === task.priority ? " selected" : "") + '>' + p + '</option>';
            }).join("") +
          '</select>' +
          '<input type="text" class="t-memo" placeholder="메모" value="' + escapeHtml(task.memo) + '">' +
          '<button type="button" class="task-remove" title="삭제">✕</button>' +
        '</div>'
      );
    }).join("");
  }

  function syncTaskTableToDraft() {
    document.querySelectorAll("#taskTable .task-row").forEach(function (row) {
      var id = row.dataset.taskId;
      var task = state.draft.tasks.find(function (t) { return t.id === id; });
      if (!task) return;
      task.name = row.querySelector(".t-name").value.trim();
      task.assignee = row.querySelector(".t-assignee").value.trim();
      task.dueDate = row.querySelector(".t-due").value;
      task.status = row.querySelector(".t-status").value;
      task.priority = row.querySelector(".t-priority").value;
      task.memo = row.querySelector(".t-memo").value.trim();
    });
  }

  function renderReview() {
    document.getElementById("reviewMeta").innerHTML =
      ["문서명", "인계자", "인수자", "작성일"].map(function (label, i) {
        var value = [state.draft.title, state.draft.from, state.draft.to, state.draft.date][i];
        return (
          '<div class="review-meta-item">' +
            '<div class="review-meta-label">' + label + '</div>' +
            '<div class="review-meta-value">' + escapeHtml(value || "-") + '</div>' +
          '</div>'
        );
      }).join("");

    var container = document.getElementById("reviewTaskTable");
    if (!state.draft.tasks.length) {
      container.innerHTML = '<div class="task-table-empty">등록된 업무가 없습니다.</div>';
      return;
    }
    container.innerHTML = state.draft.tasks.map(function (task) {
      return (
        '<div class="task-row">' +
          '<div class="readonly-cell"><span class="readonly-cell-label">업무명</span>' + escapeHtml(task.name || "-") + '</div>' +
          '<div class="readonly-cell"><span class="readonly-cell-label">담당자</span>' + escapeHtml(task.assignee || "-") + '</div>' +
          '<div class="readonly-cell"><span class="readonly-cell-label">기한</span>' + escapeHtml(task.dueDate || "-") + '</div>' +
          '<div class="readonly-cell"><span class="readonly-cell-label">상태</span>' + escapeHtml(task.status) + '</div>' +
          '<div class="readonly-cell"><span class="readonly-cell-label">중요도</span>' + escapeHtml(task.priority || "보통") + '</div>' +
          '<div class="readonly-cell"><span class="readonly-cell-label">메모</span>' + escapeHtml(task.memo || "-") + '</div>' +
        '</div>'
      );
    }).join("");
  }

  function goStep(delta) {
    if (state.wizardStep === 1) {
      state.draft.title = document.getElementById("docTitleInput").value.trim();
      state.draft.from = document.getElementById("docFromInput").value.trim();
      state.draft.to = document.getElementById("docToInput").value.trim();
      state.draft.date = document.getElementById("docDateInput").value || todayStr();
      if (delta > 0 && !state.draft.title) {
        alert("문서명을 입력해 주세요.");
        return;
      }
    }
    if (state.wizardStep === 2) {
      syncTaskTableToDraft();
    }
    if (state.wizardStep === 3 && delta > 0) {
      commitDraftAsDocument();
      state.wizardStep = 4;
      renderWizard();
      return;
    }
    state.wizardStep = Math.min(4, Math.max(1, state.wizardStep + delta));
    renderWizard();
  }

  function commitDraftAsDocument() {
    var doc = {
      id: uid("doc"),
      type: "handover",
      title: state.draft.title || "제목 없는 인수인계서",
      from: state.draft.from,
      to: state.draft.to,
      createdAt: state.draft.date,
      confirmed: false,
      tasks: state.draft.tasks.map(function (t) {
        return {
          id: t.id, name: t.name, assignee: t.assignee, dueDate: t.dueDate,
          status: t.status, priority: t.priority || "보통", type: t.type || "인계", memo: t.memo
        };
      })
    };
    state.documents.push(doc);
    saveDocuments();
    state.selectedDocId = doc.id;
  }

  function resetWizard() {
    state.draft = newDraft();
    state.wizardStep = 1;
  }

  // ---------- Excel 내보내기 ----------
  function draftToWorkbook(draft) {
    var wb = XLSX.utils.book_new();

    var metaRows = [
      ["문서명", draft.title || ""],
      ["인계자", draft.from || ""],
      ["인수자", draft.to || ""],
      ["작성일", draft.date || ""]
    ];
    var metaSheet = XLSX.utils.aoa_to_sheet(metaRows);
    XLSX.utils.book_append_sheet(wb, metaSheet, "기본정보");

    var taskHeader = ["구분", "업무명", "담당자", "처리기한", "진행상태", "중요도", "메모"];
    var taskRows = draft.tasks.map(function (t) {
      return [t.type || "인계", t.name || "", t.assignee || "", t.dueDate || "", t.status || "예정", t.priority || "보통", t.memo || ""];
    });
    var taskSheet = XLSX.utils.aoa_to_sheet([taskHeader].concat(taskRows));
    XLSX.utils.book_append_sheet(wb, taskSheet, "업무내용");

    return wb;
  }

  function exportDraftToExcel() {
    if (state.wizardStep === 1) {
      state.draft.title = document.getElementById("docTitleInput").value.trim();
      state.draft.from = document.getElementById("docFromInput").value.trim();
      state.draft.to = document.getElementById("docToInput").value.trim();
      state.draft.date = document.getElementById("docDateInput").value || todayStr();
    }
    if (state.wizardStep === 2) {
      syncTaskTableToDraft();
    }
    if (!state.draft.tasks.length) {
      alert("내보낼 업무가 없습니다. 업무를 먼저 추가해 주세요.");
      return;
    }
    var wb = draftToWorkbook(state.draft);
    var filename = (state.draft.title || "인수인계서") + "_인계업무.xlsx";
    XLSX.writeFile(wb, filename);
  }

  function exportDocToExcel(doc) {
    var asDraft = { title: doc.title, from: doc.from, to: doc.to, date: doc.createdAt, tasks: doc.tasks };
    var wb = draftToWorkbook(asDraft);
    XLSX.writeFile(wb, (doc.title || "인수인계서") + "_인계업무.xlsx");
  }

  // ---------- Excel 불러오기 ----------
  function parseTaskSheetRows(rows, defaultType) {
    // rows: array of objects (header row 기준) - 유연하게 컬럼명 매칭
    return rows.map(function (row) {
      var name = row["업무명"] || row["업무"] || "";
      if (!name) return null;
      return {
        id: uid("task"),
        name: String(name).trim(),
        assignee: String(row["담당자"] || "").trim(),
        dueDate: normalizeExcelDate(row["처리기한"] || row["기한"] || ""),
        status: normalizeStatus(row["진행상태"] || row["상태"]),
        priority: normalizePriority(row["중요도"]),
        type: normalizeType(row["구분"] || row["유형"], defaultType),
        memo: String(row["메모"] || row["비고"] || "").trim()
      };
    }).filter(Boolean);
  }

  function normalizeExcelDate(value) {
    if (value == null || value === "") return "";
    if (typeof value === "number") {
      var parsed = XLSX.SSF.parse_date_code(value);
      if (parsed) {
        var m = String(parsed.m).padStart(2, "0");
        var d = String(parsed.d).padStart(2, "0");
        return parsed.y + "-" + m + "-" + d;
      }
    }
    var str = String(value).trim();
    var match = str.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
    if (match) {
      return match[1] + "-" + match[2].padStart(2, "0") + "-" + match[3].padStart(2, "0");
    }
    return str;
  }

  function importExcelFile(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = new Uint8Array(e.target.result);
        var wb = XLSX.read(data, { type: "array", cellDates: false });

        var meta = { title: "", from: "", to: "", date: "" };
        if (wb.SheetNames.indexOf("기본정보") >= 0) {
          var metaRows = XLSX.utils.sheet_to_json(wb.Sheets["기본정보"], { header: 1 });
          metaRows.forEach(function (r) {
            var key = r[0], val = r[1];
            if (key === "문서명") meta.title = val || "";
            if (key === "인계자") meta.from = val || "";
            if (key === "인수자") meta.to = val || "";
            if (key === "작성일") meta.date = normalizeExcelDate(val || "");
          });
        }

        var taskSheetName = wb.SheetNames.indexOf("업무내용") >= 0 ? "업무내용" : wb.SheetNames[0];
        var taskRowsRaw = XLSX.utils.sheet_to_json(wb.Sheets[taskSheetName], { defval: "" });
        var tasks = parseTaskSheetRows(taskRowsRaw, "인수");

        if (!tasks.length) {
          alert('불러올 업무 데이터를 찾지 못했습니다. "업무명" 열이 포함된 Excel 파일인지 확인해 주세요.');
          return;
        }

        var doc = {
          id: uid("doc"),
          type: "received",
          title: meta.title || file.name.replace(/\.(xlsx|xls)$/i, ""),
          from: meta.from || "-",
          to: meta.to || state.userName || "-",
          createdAt: meta.date || todayStr(),
          confirmed: false,
          tasks: tasks
        };
        state.documents.push(doc);
        saveDocuments();
        state.selectedDocId = doc.id;
        switchView("docbox");
        renderDocbox();
      } catch (err) {
        console.error(err);
        alert("Excel 파일을 읽는 중 오류가 발생했습니다. 파일 형식을 확인해 주세요.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // ---------- 문서함 ----------
  function renderDocbox() {
    var query = state.docSearch.trim().toLowerCase();
    var docs = state.documents
      .slice()
      .sort(function (a, b) { return (b.createdAt || "").localeCompare(a.createdAt || ""); })
      .filter(function (d) { return !query || d.title.toLowerCase().indexOf(query) >= 0; });

    if (!state.selectedDocId && docs.length) {
      state.selectedDocId = docs[0].id;
    }

    var listHtml = docs.length ? docs.map(function (doc) {
      var status = docOverallStatus(doc);
      var typeLabel = doc.type === "received" ? "인수받음" : "인계";
      var selected = doc.id === state.selectedDocId;
      return (
        '<div class="doc-item' + (selected ? " is-selected" : "") + '" data-doc-id="' + doc.id + '">' +
          '<div class="doc-item-icon">' + (doc.type === "received" ? ICON_FOLDER : ICON_FILE) + '</div>' +
          '<div class="doc-item-body">' +
            '<div class="doc-item-title">' + escapeHtml(doc.title) + '</div>' +
            '<div class="doc-item-sub">' + escapeHtml(doc.createdAt || "-") + ' · ' + typeLabel + ' · ' + status + '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("") : '<div class="list-empty">문서가 없습니다.</div>';
    document.getElementById("docList").innerHTML = listHtml;

    renderDocDetail(docs.find(function (d) { return d.id === state.selectedDocId; }));
  }

  function addDocTask(doc) {
    var defaultType = doc.type === "received" ? "인수" : "인계";
    doc.tasks.push(newTaskRow(defaultType));
    saveDocuments();
    renderDocbox();
  }

  function deleteDocTask(doc, taskId) {
    doc.tasks = doc.tasks.filter(function (t) { return t.id !== taskId; });
    saveDocuments();
    renderDocbox();
  }

  function refreshDocSummary(doc) {
    var status = docOverallStatus(doc);
    var headBadge = document.querySelector("#docDetail .doc-detail-head .badge");
    if (headBadge) {
      headBadge.className = "badge " + statusBadgeClass(status);
      headBadge.textContent = status;
    }
    var listItemSub = document.querySelector('.doc-item[data-doc-id="' + doc.id + '"] .doc-item-sub');
    if (listItemSub) {
      var typeLabel = doc.type === "received" ? "인수받음" : "인계";
      listItemSub.textContent = (doc.createdAt || "-") + " · " + typeLabel + " · " + status;
    }
  }

  function updateDocTaskField(doc, taskId, field, value) {
    var task = doc.tasks.find(function (t) { return t.id === taskId; });
    if (!task) return;
    task[field] = value;
    saveDocuments();
    refreshDocSummary(doc);
  }

  function buildTaskRowHtml(task) {
    return (
      '<div class="doc-task-row-edit" data-task-id="' + task.id + '">' +
        '<select class="dt-type">' +
          TASK_TYPES.map(function (t) {
            return '<option value="' + t + '"' + (t === task.type ? " selected" : "") + '>' + t + '</option>';
          }).join("") +
        '</select>' +
        '<input type="text" class="dt-name" placeholder="업무명" value="' + escapeHtml(task.name) + '">' +
        '<input type="text" class="dt-assignee" placeholder="담당자" value="' + escapeHtml(task.assignee) + '">' +
        '<input type="date" class="dt-due" value="' + escapeHtml(task.dueDate) + '">' +
        '<select class="dt-status">' +
          TASK_STATUSES.map(function (s) {
            return '<option value="' + s + '"' + (s === task.status ? " selected" : "") + '>' + s + '</option>';
          }).join("") +
        '</select>' +
        '<select class="dt-priority">' +
          PRIORITIES.map(function (p) {
            return '<option value="' + p + '"' + (p === task.priority ? " selected" : "") + '>' + p + '</option>';
          }).join("") +
        '</select>' +
        '<input type="text" class="dt-memo" placeholder="메모" value="' + escapeHtml(task.memo) + '">' +
        '<button type="button" class="task-remove dt-remove" title="삭제">✕</button>' +
      '</div>'
    );
  }

  function renderTaskRows(doc) {
    var container = document.getElementById("docTaskRows");
    if (!container) return;
    if (!doc.tasks.length) {
      container.innerHTML = '<div class="task-table-empty">등록된 업무가 없습니다. "업무 추가"로 새 업무를 등록하세요.</div>';
      return;
    }
    var visible = filterTasks(doc.tasks);
    if (!visible.length) {
      container.innerHTML = '<div class="task-table-empty">검색·필터 조건에 맞는 업무가 없습니다.</div>';
      return;
    }
    container.innerHTML = visible.map(buildTaskRowHtml).join("");
  }

  function renderDocDetail(doc) {
    var panel = document.getElementById("docDetail");
    if (!doc) {
      panel.innerHTML = '<div class="empty-state">왼쪽에서 문서를 선택하세요</div>';
      return;
    }
    var status = docOverallStatus(doc);
    var f = state.taskFilter;

    function optionsHtml(allLabel, values, current) {
      return '<option value="">' + allLabel + '</option>' + values.map(function (v) {
        return '<option value="' + v + '"' + (v === current ? " selected" : "") + '>' + v + '</option>';
      }).join("");
    }

    panel.innerHTML =
      '<div class="doc-detail-head">' +
        '<div class="doc-detail-title-row">' +
          '<div class="doc-detail-icon">' + (doc.type === "received" ? ICON_FOLDER : ICON_FILE) + '</div>' +
          '<div class="doc-detail-title">' + escapeHtml(doc.title) + '</div>' +
        '</div>' +
        '<div class="badge ' + statusBadgeClass(status) + '">' + status + '</div>' +
      '</div>' +
      '<div class="doc-info-grid">' +
        '<div class="doc-info-item"><div class="doc-info-label">인계자</div><div class="doc-info-value">' + escapeHtml(doc.from || "-") + '</div></div>' +
        '<div class="doc-info-item"><div class="doc-info-label">인수자</div><div class="doc-info-value">' + escapeHtml(doc.to || "-") + '</div></div>' +
        '<div class="doc-info-item"><div class="doc-info-label">작성일</div><div class="doc-info-value">' + escapeHtml(doc.createdAt || "-") + '</div></div>' +
      '</div>' +
      '<div class="doc-task-panel">' +
        '<div class="task-table-head">' +
          '<div class="panel-title">업무 내용</div>' +
          '<button class="btn btn-outline btn-small" id="addDocTaskBtn">' + ICON_PLUS + '업무 추가</button>' +
        '</div>' +
        '<div class="task-filter-bar">' +
          '<input type="text" id="taskSearchInput" class="task-search-input" placeholder="업무명 검색" value="' + escapeHtml(f.search) + '">' +
          '<select id="taskFilterType">' + optionsHtml("전체 구분", TASK_TYPES, f.type) + '</select>' +
          '<select id="taskFilterStatus">' + optionsHtml("전체 상태", TASK_STATUSES, f.status) + '</select>' +
          '<select id="taskFilterPriority">' + optionsHtml("전체 중요도", PRIORITIES, f.priority) + '</select>' +
        '</div>' +
        '<div class="doc-task-rows" id="docTaskRows"></div>' +
      '</div>' +
      '<div class="doc-actions">' +
        '<button class="btn btn-outline" id="exportDocBtn">' + ICON_EXCEL + 'Excel로 저장</button>' +
        '<button class="btn btn-outline" id="printDocBtn">' + ICON_PRINTER + '출력</button>' +
        '<button class="btn btn-primary" id="confirmDocBtn">' + ICON_CHECK + (doc.confirmed ? "확인 완료됨" : "확인 완료") + '</button>' +
      '</div>';

    renderTaskRows(doc);

    document.getElementById("exportDocBtn").addEventListener("click", function () {
      exportDocToExcel(doc);
    });
    document.getElementById("printDocBtn").addEventListener("click", function () {
      window.print();
    });
    document.getElementById("confirmDocBtn").addEventListener("click", function () {
      doc.confirmed = !doc.confirmed;
      saveDocuments();
      renderDocDetail(doc);
    });
    document.getElementById("addDocTaskBtn").addEventListener("click", function () {
      addDocTask(doc);
    });

    document.getElementById("taskSearchInput").addEventListener("input", function (e) {
      state.taskFilter.search = e.target.value;
      renderTaskRows(doc);
    });
    document.getElementById("taskFilterType").addEventListener("change", function (e) {
      state.taskFilter.type = e.target.value;
      renderTaskRows(doc);
    });
    document.getElementById("taskFilterStatus").addEventListener("change", function (e) {
      state.taskFilter.status = e.target.value;
      renderTaskRows(doc);
    });
    document.getElementById("taskFilterPriority").addEventListener("change", function (e) {
      state.taskFilter.priority = e.target.value;
      renderTaskRows(doc);
    });

    var taskPanel = panel.querySelector(".doc-task-panel");

    taskPanel.addEventListener("click", function (e) {
      if (e.target.classList.contains("dt-remove")) {
        var row = e.target.closest(".doc-task-row-edit");
        deleteDocTask(doc, row.dataset.taskId);
      }
    });

    taskPanel.addEventListener("change", function (e) {
      var row = e.target.closest(".doc-task-row-edit");
      if (!row) return;
      var taskId = row.dataset.taskId;
      if (e.target.classList.contains("dt-type")) updateDocTaskField(doc, taskId, "type", e.target.value);
      if (e.target.classList.contains("dt-due")) updateDocTaskField(doc, taskId, "dueDate", e.target.value);
      if (e.target.classList.contains("dt-status")) updateDocTaskField(doc, taskId, "status", e.target.value);
      if (e.target.classList.contains("dt-priority")) updateDocTaskField(doc, taskId, "priority", e.target.value);
    });

    taskPanel.addEventListener("blur", function (e) {
      var row = e.target.closest(".doc-task-row-edit");
      if (!row) return;
      var taskId = row.dataset.taskId;
      if (e.target.classList.contains("dt-name")) updateDocTaskField(doc, taskId, "name", e.target.value.trim());
      if (e.target.classList.contains("dt-assignee")) updateDocTaskField(doc, taskId, "assignee", e.target.value.trim());
      if (e.target.classList.contains("dt-memo")) updateDocTaskField(doc, taskId, "memo", e.target.value.trim());
    }, true);
  }

  // ---------- 이벤트 바인딩 ----------
  function bindEvents() {
    document.querySelectorAll(".nav-item").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.dataset.view === "handover" && state.wizardStep === 4) {
          resetWizard();
        }
        switchView(btn.dataset.view);
      });
    });

    var userNameInput = document.getElementById("userNameInput");
    userNameInput.value = state.userName;
    userNameInput.addEventListener("input", function () {
      state.userName = userNameInput.value;
      saveUserName();
    });

    updateThemeToggleUI(getEffectiveTheme());
    document.getElementById("themeToggleBtn").addEventListener("click", function () {
      applyTheme(getEffectiveTheme() === "dark" ? "light" : "dark");
    });

    document.getElementById("addTaskBtn").addEventListener("click", function () {
      syncTaskTableToDraft();
      state.draft.tasks.push(newTaskRow());
      renderTaskTable();
    });

    document.getElementById("taskTable").addEventListener("click", function (e) {
      if (e.target.classList.contains("task-remove")) {
        syncTaskTableToDraft();
        var row = e.target.closest(".task-row");
        var id = row.dataset.taskId;
        state.draft.tasks = state.draft.tasks.filter(function (t) { return t.id !== id; });
        renderTaskTable();
      }
    });

    document.getElementById("prevStepBtn").addEventListener("click", function () { goStep(-1); });
    document.getElementById("nextStepBtn").addEventListener("click", function () { goStep(1); });
    document.getElementById("exportDraftBtn").addEventListener("click", exportDraftToExcel);
    document.getElementById("goToDocboxBtn").addEventListener("click", function () {
      resetWizard();
      switchView("docbox");
    });

    var fileInput = document.getElementById("excelFileInput");
    document.getElementById("importExcelBtn").addEventListener("click", function () {
      fileInput.value = "";
      fileInput.click();
    });
    fileInput.addEventListener("change", function () {
      if (fileInput.files && fileInput.files[0]) {
        importExcelFile(fileInput.files[0]);
      }
    });

    document.getElementById("docSearchInput").addEventListener("input", function (e) {
      state.docSearch = e.target.value;
      renderDocbox();
    });

    document.getElementById("docList").addEventListener("click", function (e) {
      var item = e.target.closest(".doc-item");
      if (!item) return;
      state.selectedDocId = item.dataset.docId;
      renderDocbox();
    });
  }

  // ---------- 초기화 ----------
  function init() {
    loadState();
    state.draft = newDraft();
    document.getElementById("docDateInput").value = state.draft.date;
    bindEvents();
    switchView("dashboard");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
