/* =====================================================================
   STUDY HARD — script.js  (версия без ИИ)
   Остались: часы, календарь, оценки (формативы/СОР/СОЧ), цели,
   статистика, уведомления, таймер Pomodoro.
   Адреса сервера (/api/...) НЕ менялись — бэкенд на FastAPI трогать не нужно.
   (/api/ai/chat на сервере можно оставить — сайт его больше не вызывает.)

   ГДЕ ЧТО МЕНЯТЬ:
   - Откуда брать время           → USE_SERVER_TIME (ниже)
   - Длительность таймера          → TIMER_WORK / TIMER_BREAK / TIMER_LONG_BREAK
   - Названия экранов в шапке      → объект SCREENS
   ===================================================================== */
'use strict';

// ============================================================
// 0. НАСТРОЙКИ
// ============================================================
// false = часы берутся с самого телефона (быстро, работает офлайн).
// true  = как раньше: каждую секунду спрашивать время у сервера (/api/time).
const USE_SERVER_TIME = false;

// ============================================================
// 1. ПОМОЩНИКИ
// ============================================================
const $ = (id) => document.getElementById(id);

// Защита от «поломки» страницы, если в названии есть символы < > & "
function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function toISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + dd;
}
function todayISO() { return toISO(new Date()); }

// Пустое значение → тире
function fmt(v) { return (v === null || v === undefined || v === '') ? '\u2014' : v; }

// Всплывающее сообщение внизу (вместо alert)
function showToast(msg) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2400);
}

// Единая функция запросов к серверу.
// cache:'no-store' — браузер никогда не отдаёт старые данные из кэша.
async function api(url, opts = {}) {
    const init = { cache: 'no-store', ...opts };
    if (opts.json !== undefined) {
        init.method = opts.method || 'POST';
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(opts.json);
        delete init.json;
    }
    const r = await fetch(url, init);
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
    try { return await r.json(); } catch (e) { return null; }
}

// ============================================================
// 2. НАВИГАЦИЯ (нижняя панель + шторка «More»)
// ============================================================
// ✂ УДАЛЕНО: пункт ai из SCREENS, SHEET_SCREENS и ON_SHOW
const SCREENS = {
    clock: 'Time', calendar: 'Calendar', grades: 'Grades', timer: 'Timer',
    goals: 'Goals', stats: 'Statistics', notifications: 'Notifications',
};
const SHEET_SCREENS = ['goals', 'stats', 'notifications'];

const navButtons    = document.querySelectorAll('#nav .nav-btn[data-screen]');
const sheetItems    = document.querySelectorAll('.sheet-item[data-screen]');
const menuBtn       = $('menu-btn');
const sheet         = $('sheet');
const sheetBackdrop = $('sheet-backdrop');
const screenTitleEl = $('screen-title');

function openSheet() {
    sheet.classList.add('open');
    sheetBackdrop.classList.add('open');
    menuBtn.setAttribute('aria-expanded', 'true');
}
function closeSheet() {
    sheet.classList.remove('open');
    sheetBackdrop.classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
}

menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    sheet.classList.contains('open') ? closeSheet() : openSheet();
});
sheetBackdrop.addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

// Что обновлять при открытии экрана (данные всегда свежие)
const ON_SHOW = {
    clock:         () => loadTodayPlans(),
    calendar:      () => {
        if (!selectedDate) setSelectedDay(new Date());
        renderCalendar();
        loadEvents();
    },
    grades:        () => loadSubjects(),
    goals:         () => loadGoals(),
    stats:         () => loadStats(),
    notifications: () => loadNotifications(),
    timer:         () => { loadTimerSubjects(); loadTodayPomodoros(); },
};

function showScreen(name) {
    // Если в памяти осталась старая вкладка (например «ai») — откроется Time
    if (!SCREENS[name]) name = 'clock';

    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === name));

    navButtons.forEach((b) => b.classList.toggle('active', b.dataset.screen === name));
    menuBtn.classList.toggle('active', SHEET_SCREENS.includes(name));
    sheetItems.forEach((b) => b.classList.toggle('active', b.dataset.screen === name));

    screenTitleEl.textContent = SCREENS[name];
    closeSheet();
    window.scrollTo(0, 0);

    try { localStorage.setItem('sh_screen', name); } catch (e) { /* ignore */ }
    if (ON_SHOW[name]) ON_SHOW[name]();
}

navButtons.forEach((b) => b.addEventListener('click', () => showScreen(b.dataset.screen)));
sheetItems.forEach((b) => b.addEventListener('click', () => showScreen(b.dataset.screen)));

// ============================================================
// 3. ЧАСЫ
// ============================================================
function renderClock() {
    const now = new Date();
    $('big-time').textContent = now.toLocaleTimeString('en-GB', { hour12: false });
    $('big-date').textContent = now.toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
}

async function tick() {
    if (!USE_SERVER_TIME) { renderClock(); return; }
    try {
        const data = await api('/api/time');
        $('big-time').textContent = data.time;
        $('big-date').textContent = data.weekday + ', ' + data.date;
    } catch (e) {
        console.error('Clock error:', e);
        renderClock();
    }
}
tick();
setInterval(tick, 1000);

// ============================================================
// 4. КАЛЕНДАРЬ
// ============================================================
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

let viewDate = new Date();          // какой месяц сейчас показан
viewDate.setDate(1);
let selectedDate = null;            // выбранный день в формате YYYY-MM-DD
let renderToken = 0;                // защита от «двойной отрисовки» при быстрых кликах

const grid       = $('calendar-grid');
const monthTitle = $('month-title');
const sideTitle  = $('selected-date-title');
const eventsList = $('events-list');
const eventForm  = $('event-form');

async function renderCalendar() {
    const token = ++renderToken;
    const year  = viewDate.getFullYear();
    const month = viewDate.getMonth();
    monthTitle.textContent = MONTHS[month] + ' ' + year;

    const monthStr = year + '-' + String(month + 1).padStart(2, '0');
    let eventDates = new Set();
    let goalDates  = new Set();

    try {
        const [ev, gl] = await Promise.all([api('/api/events'), api('/api/goals')]);
        (ev.events || []).forEach((e) => { if (e.date.startsWith(monthStr)) eventDates.add(e.date); });
        (gl.goals  || []).forEach((g) => { if (g.deadline.startsWith(monthStr)) goalDates.add(g.deadline); });
    } catch (e) { console.error(e); }

    if (token !== renderToken) return;   // пока грузилось — пользователь уже листнул дальше

    grid.innerHTML = '';
    DAYS.forEach((d) => {
        const el = document.createElement('div');
        el.className = 'day-name';
        el.textContent = d;
        grid.appendChild(el);
    });

    const lastDay = new Date(year, month + 1, 0).getDate();
    let startOffset = new Date(year, month, 1).getDay() - 1;   // неделя с понедельника
    if (startOffset < 0) startOffset = 6;

    // дни прошлого месяца
    for (let i = 0; i < startOffset; i++) {
        const prev = new Date(year, month, -startOffset + i + 1);
        const el = document.createElement('div');
        el.className = 'day other-month';
        el.textContent = prev.getDate();
        grid.appendChild(el);
    }

    const today = todayISO();
    for (let d = 1; d <= lastDay; d++) {
        const dateObj = new Date(year, month, d);
        const iso = toISO(dateObj);
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'day';
        el.textContent = d;
        el.dataset.date = iso;

        if (iso === today)        el.classList.add('today');
        if (iso === selectedDate) el.classList.add('selected');

        if (eventDates.has(iso)) {
            const dot = document.createElement('span');
            dot.className = 'dot';
            el.appendChild(dot);
        }
        if (goalDates.has(iso)) {
            const flag = document.createElement('span');
            flag.className = 'goal-flag';
            flag.textContent = '\uD83D\uDEA9';
            el.appendChild(flag);
        }
        el.addEventListener('click', () => selectDay(iso, dateObj));
        grid.appendChild(el);
    }

    // дни следующего месяца (чтобы последняя строка была полной)
    const filled = startOffset + lastDay;
    const tail = (7 - (filled % 7)) % 7;
    for (let i = 1; i <= tail; i++) {
        const el = document.createElement('div');
        el.className = 'day other-month';
        el.textContent = i;
        grid.appendChild(el);
    }
}

function setSelectedDay(dateObj) {
    selectedDate = toISO(dateObj);
    sideTitle.textContent = dateObj.toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric',
    });
}

function selectDay(iso, dateObj) {
    setSelectedDay(dateObj);
    document.querySelectorAll('.day[data-date]').forEach((el) => {
        el.classList.toggle('selected', el.dataset.date === iso);
    });
    loadEvents();
}

async function loadEvents() {
    eventsList.innerHTML = '';
    if (!selectedDate) return;
    try {
        const data = await api('/api/events?date=' + selectedDate);
        const events = (data.events || []).slice().sort((a, b) => a.time.localeCompare(b.time));
        if (events.length === 0) {
            eventsList.innerHTML = '<li class="empty-hint">Nothing yet. Add an event above</li>';
            return;
        }
        events.forEach((ev) => {
            const li = document.createElement('li');
            li.className = ev.type;
            li.innerHTML =
                '<div>' +
                    '<div>' + escapeHtml(ev.title) + '</div>' +
                    '<div class="ev-time">' + escapeHtml(ev.time) + '</div>' +
                '</div>' +
                '<button class="ev-del" type="button" aria-label="Delete event">&times;</button>';
            li.querySelector('.ev-del').addEventListener('click', () => delEvent(ev.id));
            eventsList.appendChild(li);
        });
    } catch (e) { console.error(e); }
}

eventForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedDate) { showToast('Pick a day in the calendar first!'); return; }
    const title = $('event-title').value.trim();
    const time  = $('event-time').value;
    const type  = $('event-type').value;
    if (!title || !time) return;
    try {
        await api('/api/events', { json: { title: title, date: selectedDate, time: time, type: type } });
        eventForm.reset();
        await loadEvents();
        await renderCalendar();
        loadTodayPlans();
    } catch (err) { console.error(err); showToast('Could not save the event'); }
});

async function delEvent(id) {
    try {
        await api('/api/events/' + id, { method: 'DELETE' });
        await loadEvents();
        await renderCalendar();
        loadTodayPlans();
    } catch (e) { console.error(e); }
}

$('prev-month').addEventListener('click', () => {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
    renderCalendar();
});
$('next-month').addEventListener('click', () => {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
    renderCalendar();
});

// ============================================================
// 5. ОЦЕНКИ (формативы / СОР / СОЧ)
// ============================================================
const subjectsList  = $('subjects-list');
const subjectForm   = $('subject-form');
const overallGpaEl  = $('overall-gpa');
const subjectsCount = $('subjects-count');
const clearAllBtn   = $('clear-all-btn');

async function loadSubjects() {
    try {
        const data = await api('/api/subjects');
        renderSubjects(data);
    } catch (e) { console.error('Subjects error:', e); }
}

function renderSubjects(data) {
    const subjects = data.subjects || [];
    subjectsList.innerHTML = '';

    if (subjects.length === 0) {
        subjectsList.innerHTML = '<div class="empty-hint-block">No subjects yet. Add your first one above</div>';
        overallGpaEl.textContent = '\u2014';
        subjectsCount.textContent = 'No subjects yet';
        return;
    }

    subjects.forEach((sub) => {
        const card = document.createElement('div');
        card.className = 'subject-card';

        let gradesHtml = '';
        (sub.grades || []).forEach((g, i) => {
            const isObj = g && typeof g === 'object';
            const score = isObj ? g.score : g;
            const max   = isObj ? (g.max_score ?? 10) : 10;
            const type  = isObj ? (g.type || 'formative') : 'formative';
            const percent = max > 0 ? (score / max) * 100 : 0;

            let cls = 'grade-badge ';
            if (percent >= 85)      cls += 'grade-10';
            else if (percent >= 70) cls += 'grade-7';
            else if (percent >= 50) cls += 'grade-4';
            else                    cls += 'grade-1';

            // Форматив — просто цифра, СОР/СОЧ — дробь + маленькая подпись
            const text  = type === 'formative' ? score : score + '/' + max;
            const label = type === 'sor' ? 'СОР' : (type === 'soch' ? 'СОЧ' : '');

            gradesHtml +=
                '<button type="button" class="' + cls + '" data-idx="' + i + '" ' +
                'title="' + escapeHtml(type) + ': ' + score + '/' + max + ' (tap to delete)">' +
                escapeHtml(text) + (label ? '<small>' + label + '</small>' : '') +
                '</button>';
        });

        card.innerHTML =
            '<div class="subject-header">' +
                '<div>' +
                    '<span class="subject-name">' + escapeHtml(sub.name) + '</span>' +
                    '<div class="subject-avg">' +
                        '<span class="pill">avg ' + fmt(sub.percent) + (sub.percent != null ? '%' : '') + '</span>' +
                        '<span class="pill">Grade ' + fmt(sub.grade10) + '</span>' +
                        '<span class="pill pill--gold">GPA ' + fmt(sub.gpa) + '</span>' +
                    '</div>' +
                '</div>' +
                '<button class="subject-del" type="button" title="Delete subject" aria-label="Delete subject">&times;</button>' +
            '</div>' +
            '<div class="grades-row">' +
                (gradesHtml || '<span class="empty-hint">no grades yet</span>') +
            '</div>' +
            '<div class="add-grade-form">' +
                '<select class="field grade-type-select">' +
                    '<option value="formative">Форматив</option>' +
                    '<option value="sor">СОР</option>' +
                    '<option value="soch">СОЧ</option>' +
                '</select>' +
                '<input class="field grade-score" type="number" inputmode="decimal" placeholder="Балл" min="0" step="0.1">' +
                '<input class="field grade-max" type="number" inputmode="decimal" placeholder="Из" value="10" min="1">' +
                '<button class="add-grade-btn" type="button">+ Add</button>' +
            '</div>';

        card.querySelector('.subject-del').addEventListener('click', () => deleteSubject(sub.id));

        card.querySelectorAll('.grade-badge').forEach((badge) => {
            badge.addEventListener('click', () => {
                if (!confirm('Delete this grade?')) return;   // на телефоне легко нажать случайно
                deleteGrade(sub.id, parseInt(badge.dataset.idx, 10));
            });
        });

        card.querySelector('.add-grade-btn').addEventListener('click', () => {
            const type  = card.querySelector('.grade-type-select').value;
            const scoreInput = card.querySelector('.grade-score');
            const maxInput   = card.querySelector('.grade-max');
            const score = parseFloat(scoreInput.value);
            const max   = parseFloat(maxInput.value);

            if (isNaN(score) || isNaN(max) || score < 0 || max <= 0 || score > max) {
                showToast('Enter a valid score (0 ≤ score ≤ max)');
                return;
            }
            addGrade(sub.id, score, max, type);
            scoreInput.value = '';
        });

        subjectsList.appendChild(card);
    });

    overallGpaEl.textContent =
        (data.overall_gpa !== null && data.overall_gpa !== undefined)
            ? Number(data.overall_gpa).toFixed(2) : '\u2014';

    const n = data.total_subjects ?? subjects.length;
    subjectsCount.textContent = n + (n === 1 ? ' subject' : ' subjects');
}

subjectForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('subject-name').value.trim();
    if (!name) return;
    try {
        await api('/api/subjects', { json: { name: name } });
        subjectForm.reset();
        loadSubjects();
    } catch (err) { console.error(err); }
});

clearAllBtn.addEventListener('click', async () => {
    if (!confirm('Delete ALL subjects and ALL grades? This cannot be undone.')) return;
    try {
        await api('/api/subjects', { method: 'DELETE' });
        loadSubjects();
    } catch (e) { console.error(e); }
});

async function deleteSubject(id) {
    if (!confirm('Delete this subject with all its grades?')) return;
    try {
        await api('/api/subjects/' + id, { method: 'DELETE' });
        loadSubjects();
    } catch (e) { console.error(e); }
}

async function addGrade(subjectId, score, max_score, type) {
    try {
        await api('/api/subjects/' + subjectId + '/grades', {
            json: { score: score, max_score: max_score, type: type },
        });
        loadSubjects();
    } catch (e) { console.error(e); }
}

async function deleteGrade(subjectId, index) {
    try {
        await api('/api/subjects/' + subjectId + '/grades/' + index, { method: 'DELETE' });
        loadSubjects();
    } catch (e) { console.error(e); }
}

// ============================================================
// 6. ЦЕЛИ
// ============================================================
const goalsList = $('goals-list');
const goalForm  = $('goal-form');

async function loadGoals() {
    try {
        const data = await api('/api/goals');
        renderGoals(data.goals || []);
    } catch (e) { console.error('Goals error:', e); }
}

function renderGoals(goals) {
    goalsList.innerHTML = '';
    if (goals.length === 0) {
        goalsList.innerHTML = '<div class="empty-hint-block">No goals yet. Add your first one above</div>';
        return;
    }

    const today = todayISO();
    goals.forEach((g) => {
        const card = document.createElement('div');
        card.className = 'goal-card';
        const done = g.current >= g.target;
        if (done) card.classList.add('is-done');

        const percent = g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0;
        const isPast = g.deadline < today && !done;

        card.innerHTML =
            '<div class="goal-header">' +
                '<div>' +
                    '<div class="goal-title">' + escapeHtml(g.title) + '</div>' +
                    '<div class="goal-deadline' + (isPast ? ' is-past' : '') + '">deadline: ' + escapeHtml(g.deadline) + '</div>' +
                '</div>' +
                '<button class="goal-del" type="button" title="Delete goal" aria-label="Delete goal">&times;</button>' +
            '</div>' +
            '<div class="goal-progress-row">' +
                '<div class="goal-bar"><div class="goal-bar__fill" style="width:' + percent + '%"></div></div>' +
                '<div class="goal-count">' + g.current + ' / ' + g.target + '</div>' +
            '</div>' +
            '<div class="goal-actions">' +
                '<button class="goal-btn" type="button" data-delta="-1" aria-label="Minus one">&minus;</button>' +
                '<button class="goal-btn" type="button" data-delta="1" aria-label="Plus one">+</button>' +
            '</div>';

        card.querySelector('.goal-del').addEventListener('click', () => deleteGoal(g.id));
        card.querySelectorAll('.goal-btn').forEach((btn) => {
            btn.addEventListener('click', () => updateGoal(g.id, parseInt(btn.dataset.delta, 10)));
        });
        goalsList.appendChild(card);
    });
}

goalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title    = $('goal-title').value.trim();
    const deadline = $('goal-deadline').value;
    const target   = parseInt($('goal-target').value, 10) || 1;
    if (!title || !deadline) return;
    try {
        await api('/api/goals', { json: { title: title, deadline: deadline, target: target, current: 0 } });
        goalForm.reset();
        $('goal-target').value = 20;
        loadGoals();
    } catch (err) { console.error(err); }
});

async function updateGoal(id, delta) {
    try {
        await api('/api/goals/' + id + '/progress?delta=' + delta, { method: 'PATCH' });
        loadGoals();
    } catch (e) { console.error(e); }
}

async function deleteGoal(id) {
    if (!confirm('Delete this goal?')) return;
    try {
        await api('/api/goals/' + id, { method: 'DELETE' });
        loadGoals();
    } catch (e) { console.error(e); }
}

// ============================================================
// 7. ПЛАНЫ НА СЕГОДНЯ (экран Time)
// ============================================================
const todayPlansEl = $('today-plans');

const PLAN_CATEGORIES = [
    { key: 'study',    title: 'School' },
    { key: 'exam',     title: 'Exams' },
    { key: 'hobby',    title: 'Hobbies' },
    { key: 'personal', title: 'Personal' },
];

function minutesUntil(timeStr) {
    const parts = timeStr.split(':');
    const target = new Date();
    target.setHours(Number(parts[0]), Number(parts[1]), 0, 0);
    return Math.floor((target - new Date()) / 60000);
}

async function loadTodayPlans() {
    if (!todayPlansEl) return;
    try {
        const data = await api('/api/events?date=' + todayISO());
        const events = (data.events || []).slice().sort((a, b) => a.time.localeCompare(b.time));
        todayPlansEl.innerHTML = '';

        PLAN_CATEGORIES.forEach((cat) => {
            const col = document.createElement('div');
            col.className = 'plan-col';
            col.dataset.cat = cat.key;

            const h = document.createElement('div');
            h.className = 'plan-col__title';
            h.textContent = cat.title;
            col.appendChild(h);

            const items = events.filter((e) => e.type === cat.key);
            if (items.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'plan-col__empty';
                empty.textContent = '\u2014';
                col.appendChild(empty);
            } else {
                items.forEach((ev) => {
                    const diff = minutesUntil(ev.time);
                    const soon = diff >= 0 && diff <= 60;
                    const item = document.createElement('div');
                    item.className = 'plan-item' + (soon ? ' plan-item--soon' : '');
                    item.innerHTML =
                        '<span class="plan-item__time">' + escapeHtml(ev.time) + '</span>' +
                        '<span class="plan-item__title">' + escapeHtml(ev.title) + '</span>';
                    col.appendChild(item);
                });
            }
            todayPlansEl.appendChild(col);
        });
    } catch (e) {
        console.error('Today plans error:', e);
        todayPlansEl.innerHTML = '<div class="plan-col__empty">Error</div>';
    }
}
setInterval(loadTodayPlans, 60000);

// ============================================================
// 8. СТАТИСТИКА
// ============================================================
function statusFromGpa(gpa) {
    if (gpa >= 3.7) return 'excellent';
    if (gpa >= 3.0) return 'good';
    if (gpa >= 2.0) return 'ok';
    return 'needs work';
}

async function loadStats() {
    try {
        const data = await api('/api/subjects');
        const gpaEl  = $('stats-gpa');
        const hintEl = $('stats-gpa-hint');

        if (data.overall_gpa !== null && data.overall_gpa !== undefined) {
            gpaEl.textContent = Number(data.overall_gpa).toFixed(2);
            hintEl.textContent = statusFromGpa(data.overall_gpa);
        } else {
            gpaEl.textContent = '\u2014';
            hintEl.textContent = 'no grades yet';
        }

        $('kpi-subjects').textContent = data.total_subjects ?? 0;
        $('kpi-grades').textContent   = data.total_grades ?? 0;

        // Средний балл по 10-балльной шкале
        let sum = 0, count = 0;
        (data.subjects || []).forEach((s) => {
            (s.grades || []).forEach((g) => {
                const isObj = g && typeof g === 'object';
                const score = isObj ? g.score : g;
                const max   = isObj ? (g.max_score || 10) : 10;
                sum += (score / max) * 10;
                count++;
            });
        });
        $('kpi-avg10').textContent = count > 0 ? (sum / count).toFixed(2) : '\u2014';

        renderGradesChart(data.subjects || []);
        loadStatsGoals();
    } catch (e) { console.error('Stats error:', e); }
}

function renderGradesChart(subjects) {
    const container = $('grades-chart');
    if (!container) return;

    if (!subjects.length) {
        container.innerHTML = '<div class="stats-placeholder">No subjects yet. Add some in the Grades tab.</div>';
        return;
    }
    const withGrades = subjects.filter((s) => s.grade10 !== null && s.grade10 !== undefined);
    if (!withGrades.length) {
        container.innerHTML = '<div class="stats-placeholder">No grades yet. Add grades to see the chart.</div>';
        return;
    }

    const MAX_HEIGHT = 230;
    container.innerHTML = '';
    withGrades.forEach((s) => {
        const avg = Number(s.grade10);
        const heightPx = Math.max(4, Math.round((avg / 10) * MAX_HEIGHT));
        const n = (s.grades || []).length;

        const col = document.createElement('div');
        col.className = 'chart-col';
        col.innerHTML =
            '<div class="chart-col__value">' + avg.toFixed(2) + '</div>' +
            '<div class="chart-col__bar chart-bar--' + Math.round(avg) + '" style="height:' + heightPx + 'px"></div>' +
            '<div class="chart-col__label" title="' + escapeHtml(s.name) + '">' + escapeHtml(s.name) + '</div>' +
            '<div class="chart-col__sub">' + n + ' grade' + (n === 1 ? '' : 's') + '</div>';
        container.appendChild(col);
    });
}

async function loadStatsGoals() {
    try {
        const data = await api('/api/goals');
        renderStatsGoals(data.goals || []);
    } catch (e) { console.error('Stats goals error:', e); }
}

function renderStatsGoals(goals) {
    const listEl = $('stats-goals-list');
    if (!listEl) return;

    const today = todayISO();
    let active = 0, completed = 0, overdue = 0, sumCurrent = 0, sumTarget = 0;

    goals.forEach((g) => {
        const done = g.current >= g.target;
        const isPast = g.deadline < today && !done;
        if (done) completed++; else if (isPast) overdue++; else active++;
        sumCurrent += Math.min(g.current, g.target);
        sumTarget  += g.target;
    });

    $('kpi-goals-active').textContent    = active;
    $('kpi-goals-completed').textContent = completed;
    $('kpi-goals-overdue').textContent   = overdue;

    const overallPercent = sumTarget > 0 ? Math.round((sumCurrent / sumTarget) * 100) : 0;
    $('overall-goals-count').textContent = sumCurrent + ' / ' + sumTarget;
    $('overall-goals-fill').style.width  = overallPercent + '%';

    listEl.innerHTML = '';
    if (!goals.length) {
        listEl.innerHTML = '<div class="empty-hint-block">No goals yet. Add some in the Goals tab.</div>';
        return;
    }

    goals.forEach((g) => {
        const done = g.current >= g.target;
        const isPast = g.deadline < today && !done;
        const percent = g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0;
        let rowClass = 'stat-goal-row';
        if (done) rowClass += ' is-done'; else if (isPast) rowClass += ' is-overdue';

        const row = document.createElement('div');
        row.className = rowClass;
        row.innerHTML =
            '<div class="stat-goal-row__main">' +
                '<div class="stat-goal-row__title">' + escapeHtml(g.title) + '</div>' +
                '<div class="stat-goal-row__deadline">deadline: ' + escapeHtml(g.deadline) + '</div>' +
            '</div>' +
            '<div class="stat-goal-row__progress">' +
                '<div class="goal-bar"><div class="goal-bar__fill" style="width:' + percent + '%"></div></div>' +
                '<div class="stat-goal-row__count">' + g.current + ' / ' + g.target + '</div>' +
            '</div>';
        listEl.appendChild(row);
    });
}

document.querySelectorAll('.stats-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.stats-tab').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.stab-panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        $('stab-' + btn.dataset.stab).classList.add('active');
    });
});

// ============================================================
// 9. УВЕДОМЛЕНИЯ (настройки)
// ============================================================
const NOTIF_KEYS = {
    'notif-reminder': 'reminder_before_event',
    'notif-morning':  'morning_summary',
    'notif-evening':  'evening_goals_check',
    'notif-gpa':      'gpa_drop_warning',
};

async function loadNotifications() {
    try {
        const data = await api('/api/settings');
        Object.entries(NOTIF_KEYS).forEach(([htmlId, key]) => {
            const el = $(htmlId);
            if (el) el.checked = !!data[key];
        });
    } catch (e) { console.error('Settings load error:', e); }
}

function showStatus(text) {
    const statusEl = $('notif-status');
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.remove('is-hidden');
    clearTimeout(statusEl._timer);
    statusEl._timer = setTimeout(() => statusEl.classList.add('is-hidden'), 1500);
}

async function saveNotifications() {
    const payload = {};
    Object.entries(NOTIF_KEYS).forEach(([htmlId, key]) => {
        const el = $(htmlId);
        payload[key] = el ? el.checked : false;
    });
    try {
        await api('/api/settings', { json: payload });
        showStatus('Saved');
    } catch (e) {
        console.error('Settings save error:', e);
        showStatus('Error saving');
    }
}

Object.keys(NOTIF_KEYS).forEach((htmlId) => {
    const el = $(htmlId);
    if (el) el.addEventListener('change', saveNotifications);
});

// ============================================================
// 10. ТАЙМЕР (POMODORO)
// ============================================================
const TIMER_WORK       = 25 * 60;   // ← длительность работы (секунды)
const TIMER_BREAK      = 5 * 60;    // ← короткий перерыв
const TIMER_LONG_BREAK = 15 * 60;   // ← длинный перерыв
const TIMER_CYCLES     = 4;         // сколько «помидорок» до длинного перерыва
const RING_LENGTH      = 565.5;     // длина окружности кольца (2·π·90)

let timerRemaining = TIMER_WORK;
let timerRunning   = false;
let timerMode      = 'work';
let timerPomsDone  = 0;
let timerInterval  = null;
let timerEndAt     = 0;             // момент окончания — таймер не «отстаёт», даже если экран гаснет

const timerModeEl    = $('timer-mode');
const timerDisplayEl = $('timer-display');
const timerRingBox   = $('timer-ring-box');
const timerRingEl    = $('timer-ring');
const timerPomsEl    = $('timer-poms');
const timerHintEl    = $('timer-hint');
const timerStartBtn  = $('timer-start');
const timerPauseBtn  = $('timer-pause');
const timerResetBtn  = $('timer-reset');
const timerSubjectSelect = $('timer-subject-select');
const pomodoroTodayList  = $('pomodoro-today-list');

function formatTime(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return m + ':' + s;
}

function timerTotal() {
    if (timerMode === 'break') return TIMER_BREAK;
    if (timerMode === 'long')  return TIMER_LONG_BREAK;
    return TIMER_WORK;
}

function updateTimerDisplay() {
    timerDisplayEl.textContent = formatTime(timerRemaining);

    // кольцо прогресса
    const progress = 1 - timerRemaining / timerTotal();
    timerRingEl.style.strokeDasharray  = RING_LENGTH;
    timerRingEl.style.strokeDashoffset = (RING_LENGTH * progress).toFixed(2);

    ['is-break', 'is-long'].forEach((c) => {
        timerModeEl.classList.remove(c);
        timerRingBox.classList.remove(c);
    });

    if (timerMode === 'work') {
        timerModeEl.textContent = 'WORK';
        timerHintEl.textContent = '4 work sessions, then a long break';
    } else if (timerMode === 'break') {
        timerModeEl.textContent = 'BREAK';
        timerModeEl.classList.add('is-break');
        timerRingBox.classList.add('is-break');
        timerHintEl.textContent = 'Short break — relax';
    } else {
        timerModeEl.textContent = 'LONG BREAK';
        timerModeEl.classList.add('is-long');
        timerRingBox.classList.add('is-long');
        timerHintEl.textContent = 'Long break — you earned it';
    }

    timerPomsEl.innerHTML = '';
    for (let i = 0; i < TIMER_CYCLES; i++) {
        const pom = document.createElement('div');
        pom.className = 'pom' + (i < timerPomsDone ? ' is-done' : '');
        timerPomsEl.appendChild(pom);
    }

    timerStartBtn.disabled = timerRunning;
    timerPauseBtn.disabled = !timerRunning;

    // время в названии вкладки, пока таймер идёт
    document.title = timerRunning ? formatTime(timerRemaining) + ' · Study Hard' : 'Study Hard';
}

function setMode(mode) {
    timerMode = mode;
    timerRemaining = timerTotal();
    updateTimerDisplay();
}

function nextMode() {
    if (timerMode === 'work') {
        savePomodoro();
        timerPomsDone++;
        setMode(timerPomsDone >= TIMER_CYCLES ? 'long' : 'break');
    } else {
        if (timerMode === 'long') timerPomsDone = 0;
        setMode('work');
    }
}

function tickTimer() {
    timerRemaining = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
    if (timerRemaining <= 0) {
        stopTimer();
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        nextMode();
    } else {
        updateTimerDisplay();
    }
}

function startTimer() {
    if (timerRunning) return;
    if (timerMode === 'work' && timerSubjectSelect && !timerSubjectSelect.value) {
        showToast('Tip: pick a subject so this pomodoro is counted');
    }
    timerRunning = true;
    timerEndAt = Date.now() + timerRemaining * 1000;
    timerInterval = setInterval(tickTimer, 250);
    updateTimerDisplay();
}

function stopTimer() {
    if (timerRunning) {
        timerRemaining = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
    }
    timerRunning = false;
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    updateTimerDisplay();
}

function resetTimer() {
    stopTimer();
    timerPomsDone = 0;
    setMode('work');
}

timerStartBtn.addEventListener('click', startTimer);
timerPauseBtn.addEventListener('click', stopTimer);
timerResetBtn.addEventListener('click', resetTimer);
document.addEventListener('visibilitychange', () => { if (timerRunning) tickTimer(); });
updateTimerDisplay();

// --- таймер → предмет + статистика помидорок ---
async function loadTimerSubjects() {
    if (!timerSubjectSelect) return;
    try {
        const data = await api('/api/subjects');
        const current = timerSubjectSelect.value;
        timerSubjectSelect.innerHTML = '<option value="">— pick a subject —</option>';
        (data.subjects || []).forEach((sub) => {
            const opt = document.createElement('option');
            opt.value = sub.id;
            opt.textContent = sub.name;
            opt.dataset.name = sub.name;
            timerSubjectSelect.appendChild(opt);
        });
        if (current) timerSubjectSelect.value = current;
    } catch (e) { console.error('Timer subjects error:', e); }
}

async function loadTodayPomodoros() {
    if (!pomodoroTodayList) return;
    try {
        const data = await api('/api/pomodoros?date=' + todayISO());
        pomodoroTodayList.innerHTML = '';
        if (!data.by_subject || data.by_subject.length === 0) {
            pomodoroTodayList.innerHTML = '<div class="pomodoro-empty">No pomodoros yet today.</div>';
            return;
        }
        data.by_subject.forEach((item) => {
            const row = document.createElement('div');
            row.className = 'pomodoro-row';
            row.innerHTML =
                '<div class="pomodoro-row__name">' + escapeHtml(item.subject_name) + '</div>' +
                '<div class="pomodoro-row__count">' + item.count + '</div>';
            pomodoroTodayList.appendChild(row);
        });
    } catch (e) { console.error('Pomodoros load error:', e); }
}

async function savePomodoro() {
    if (!timerSubjectSelect) return;
    const subjectId   = timerSubjectSelect.value;
    const subjectName = timerSubjectSelect.options[timerSubjectSelect.selectedIndex]?.dataset.name;
    if (!subjectId || !subjectName) return;
    try {
        await api('/api/pomodoros', {
            json: { subject_id: subjectId, subject_name: subjectName, date: todayISO() },
        });
        loadTodayPomodoros();
    } catch (e) { console.error('Pomodoro save error:', e); }
}

// ============================================================
// 11. AI CHAT
// ✂ УДАЛЕНО ПОЛНОСТЬЮ: formatAIText, addAIMessage, addTypingIndicator,
//   removeTypingIndicator, обработчик формы чата, кнопки быстрых вопросов
//   и все константы aiForm / aiInput / aiSubmitBtn / aiChatContainer / aiChips.
// ============================================================

// ============================================================
// 12. SERVICE WORKER (PWA) — регистрируется ОДИН раз
// ============================================================
if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;

    // Когда появляется новая версия sw.js — один раз перезагружаем страницу,
    // чтобы пользователь сразу увидел свежие файлы (а не «вчерашние»).
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloading) return;
        reloading = true;
        window.location.reload();
    });

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then((reg) => reg.update())          // при каждом открытии проверяем обновления
            .catch((err) => console.log('SW error:', err));
    });
}

// ============================================================
// 13. ЗАПУСК
// ============================================================
(function init() {
    let start = 'clock';
    try { start = localStorage.getItem('sh_screen') || 'clock'; } catch (e) { /* ignore */ }
    showScreen(start);          // открываем последний экран и грузим его данные
})();
