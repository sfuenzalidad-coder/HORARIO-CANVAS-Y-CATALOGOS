const FILTER_CONFIG = [
  { id: 'area', label: 'ÁREA' },
  { id: 'materia', label: 'MATERIA' },
  { id: 'curso', label: 'CURSO' },
  { id: 'seccion', label: 'SECCIÓN' },
  { id: 'titulo', label: 'TÍTULO' },
  { id: 'nrc', label: 'NRC' },
  { id: 'conector', label: 'CONECTOR DE LIGA' },
  { id: 'lc', label: 'LC' },
  { id: 'sala', label: 'SALA' },
  { id: 'tipo', label: 'TIPO DE REUNIÓN' },
  { id: 'profesor', label: 'PROFESOR' }
];

const DAY_COLUMN_INDEX = { lunes: 9, martes: 10, miercoles: 11, jueves: 12, viernes: 13 };

let STATIC_CONFIG = null;
let STATIC_DATA = null;
let STATIC_PROFESORES = null;
let conflictReviewActive = false;
let currentRenderedRows = [];
let rawQueryRows = [];
let availableOptionsState = {};
let selectedValuesState = {};
let dayNonEmptyFilters = { lunes: false, martes: false, miercoles: false, jueves: false, viernes: false };
let accessContext = { role: '', basePlanScope: '', label: '' };
let legendCollapsed = false;

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function normalizeRut(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/\./g, '')
    .replace(/-/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function normalizeArray(arr) {
  return Array.isArray(arr) ? arr.map(normalizeText).filter(Boolean) : [];
}

function uniqueSorted(arr) {
  return [...new Set(arr.filter(v => String(v || '').trim() !== ''))]
    .sort((a, b) => String(a).localeCompare(String(b), 'es'));
}

function containsPE2026(planValue) {
  return normalizeText(planValue).includes('PE2026');
}

function containsPre2026(planValue) {
  const norm = normalizeText(planValue);
  const matches = norm.match(/PE20\d{2}/g) || [];
  return matches.some(m => m !== 'PE2026');
}

function matchPlanScope(planValue, selectedScope) {
  const selected = normalizeText(selectedScope);
  if (!selected) return true;
  if (selected === 'PE2026') return containsPE2026(planValue);
  if (selected === 'PE 2020, 2022, ETC.') return containsPre2026(planValue);
  return true;
}

function matchExactMulti(rowValue, selectedValues) {
  const selected = normalizeArray(selectedValues);
  if (!selected.length) return true;
  return selected.includes(normalizeText(rowValue));
}

function rowMatchesMeta(meta, state, excludeKey = null) {
  if (!matchPlanScope(meta.plan, state.basePlanScope || '')) return false;
  if (excludeKey !== 'area' && !matchExactMulti(meta.area, state.area || [])) return false;
  if (excludeKey !== 'materia' && !matchExactMulti(meta.materia, state.materia || [])) return false;
  if (excludeKey !== 'curso' && !matchExactMulti(meta.curso, state.curso || [])) return false;
  if (excludeKey !== 'seccion' && !matchExactMulti(meta.seccion, state.seccion || [])) return false;
  if (excludeKey !== 'titulo' && !matchExactMulti(meta.titulo, state.titulo || [])) return false;
  if (excludeKey !== 'nrc' && !matchExactMulti(meta.nrc, state.nrc || [])) return false;
  if (excludeKey !== 'conector' && !matchExactMulti(meta.conector, state.conector || [])) return false;
  if (excludeKey !== 'lc' && !matchExactMulti(meta.lc, state.lc || [])) return false;
  if (excludeKey !== 'sala' && !matchExactMulti(meta.sala, state.sala || [])) return false;
  if (excludeKey !== 'tipo' && !matchExactMulti(meta.tipo, state.tipo || [])) return false;
  if (excludeKey !== 'profesor' && !matchExactMulti(meta.profesor, state.profesor || [])) return false;
  return true;
}

function getOptionValueByKey(meta, key) {
  return meta[key] || '';
}

function buildFacetOptions(allRows, state) {
  const options = {};
  FILTER_CONFIG.forEach(cfg => {
    const compatibleRows = allRows.filter(row => rowMatchesMeta(row.meta, state, cfg.id));
    options[cfg.id] = uniqueSorted(compatibleRows.map(r => getOptionValueByKey(r.meta, cfg.id)));
  });
  return options;
}

function runStaticQuery(state) {
  const allRows = STATIC_DATA?.rows || [];
  const filteredRows = allRows.filter(row => rowMatchesMeta(row.meta, state, null));
  return {
    count: filteredRows.length,
    rows: filteredRows,
    options: buildFacetOptions(allRows, state),
    legendRows: STATIC_DATA?.legendRows || []
  };
}

async function loadStaticFiles() {
  const [configRes, dataRes, profesoresRes] = await Promise.all([
    fetch('./data/config.json', { cache: 'no-store' }),
    fetch('./data/data.json', { cache: 'no-store' }),
    fetch('./data/profesores.json', { cache: 'no-store' })
  ]);

  if (!configRes.ok) throw new Error('No se pudo cargar config.json');
  if (!dataRes.ok) throw new Error('No se pudo cargar data.json');
  if (!profesoresRes.ok) throw new Error('No se pudo cargar profesores.json');

  STATIC_CONFIG = await configRes.json();
  STATIC_DATA = await dataRes.json();
  STATIC_PROFESORES = await profesoresRes.json();
}

function setLoading(show) {
  const el = document.getElementById('loading');
  if (el) el.style.display = show ? 'block' : 'none';
}

function showModal(title, message) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalMessage').textContent = message;
  document.getElementById('modalOverlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
}

function showMainEntry() {
  document.getElementById('entryMain').classList.remove('hidden');
  document.getElementById('profesorSection').classList.add('hidden');
  document.getElementById('studentSection').classList.add('hidden');
  document.getElementById('appSection').classList.add('hidden');
  document.getElementById('profError').classList.add('hidden');
}

function showProfesorLogin() {
  document.getElementById('entryMain').classList.add('hidden');
  document.getElementById('studentSection').classList.add('hidden');
  document.getElementById('profesorSection').classList.remove('hidden');
  document.getElementById('profError').classList.add('hidden');
  document.getElementById('profRut').value = '';
}

function showStudentPlan() {
  document.getElementById('entryMain').classList.add('hidden');
  document.getElementById('profesorSection').classList.add('hidden');
  document.getElementById('studentSection').classList.remove('hidden');
}

function clearCatalogFrame() {
  const frame = document.getElementById('catalogoFrame');
  if (frame) frame.src = '';
}

function resetToEntry() {
  accessContext = { role: '', basePlanScope: '', label: '' };
  currentRenderedRows = [];
  rawQueryRows = [];
  conflictReviewActive = false;
  availableOptionsState = {};
  selectedValuesState = {};
  legendCollapsed = false;
  dayNonEmptyFilters = { lunes: false, martes: false, miercoles: false, jueves: false, viernes: false };
  clearCatalogFrame();
  updateConflictButton();
  updateDayFilterButtons();
  switchToHorarioView();
  showMainEntry();
}

function loadEntryConfig() {
  const sel = document.getElementById('studentPlan');
  sel.innerHTML = '';
  (STATIC_CONFIG?.planOptions || []).forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  });
}

function submitProfesorRut() {
  const rut = normalizeRut(document.getElementById('profRut').value || '');
  const valid = (STATIC_PROFESORES?.ruts || []).includes(rut);
  if (!valid) {
    document.getElementById('profError').classList.remove('hidden');
    return;
  }
  accessContext = { role: 'profesor', basePlanScope: '', label: 'Ingreso: Profesores/Administrativos' };
  enterApp();
}

function submitStudentPlan() {
  const selectedPlan = document.getElementById('studentPlan').value || '';
  accessContext = { role: 'estudiante', basePlanScope: selectedPlan, label: `Ingreso: Estudiantes · ${selectedPlan}` };
  enterApp();
}

function enterApp() {
  document.getElementById('entryMain').classList.add('hidden');
  document.getElementById('profesorSection').classList.add('hidden');
  document.getElementById('studentSection').classList.add('hidden');
  document.getElementById('appSection').classList.remove('hidden');
  document.getElementById('accessMeta').textContent = accessContext.label || '';
  initializeApp();
}

function buildFilters() {
  const grid = document.getElementById('filtersGrid');
  grid.innerHTML = '';

  FILTER_CONFIG.forEach(cfg => {
    selectedValuesState[cfg.id] = selectedValuesState[cfg.id] || [];
    const wrapper = document.createElement('div');
    wrapper.className = 'multiselect';
    wrapper.id = `wrap-${cfg.id}`;
    wrapper.innerHTML = `
      <label>${cfg.label}</label>
      <button type="button" id="btn-${cfg.id}" class="multi-btn" onclick="togglePanel('${cfg.id}')">Todos</button>
      <div id="panel-${cfg.id}" class="multi-panel">
        <div class="panel-topbar">
          <input id="search-${cfg.id}" class="panel-search" type="text" placeholder="Buscar" oninput="filterPanelOptions('${cfg.id}')" />
          <button type="button" class="panel-clear-btn" onclick="clearSingleFilter('${cfg.id}', event)">Limpiar</button>
        </div>
        <div id="options-${cfg.id}" class="multi-options"></div>
      </div>
    `;
    grid.appendChild(wrapper);
  });
}

function setFilterOptions(id, values) {
  availableOptionsState[id] = values || [];
  const optionsBox = document.getElementById(`options-${id}`);
  const selected = selectedValuesState[id] || [];
  optionsBox.innerHTML = '';

  (availableOptionsState[id] || []).forEach(v => {
    const checked = selected.includes(v) ? 'checked' : '';
    const safeValue = String(v).replace(/"/g, '&quot;');
    const row = document.createElement('label');
    row.className = 'multi-option';
    row.setAttribute('data-label', String(v).toLowerCase());
    row.innerHTML = `<input type="checkbox" value="${safeValue}" ${checked} onchange="onFilterChange('${id}')"> <span>${v}</span>`;
    optionsBox.appendChild(row);
  });

  filterPanelOptions(id);
  updateFilterButton(id);
}

function filterPanelOptions(id) {
  const query = (document.getElementById(`search-${id}`).value || '').toLowerCase().trim();
  document.querySelectorAll(`#options-${id} .multi-option`).forEach(row => {
    const label = row.getAttribute('data-label') || '';
    row.style.display = !query || label.includes(query) ? 'flex' : 'none';
  });
}

function getVisibleCheckedValues(id) {
  return [...document.querySelectorAll(`#options-${id} input[type="checkbox"]:checked`)].map(el => el.value);
}

function syncSelectionFromDom(id) {
  const available = availableOptionsState[id] || [];
  const domSelected = getVisibleCheckedValues(id);
  const previous = selectedValuesState[id] || [];
  const hiddenSelected = previous.filter(v => !available.includes(v));
  selectedValuesState[id] = [...hiddenSelected, ...domSelected];
}

function updateFilterButton(id) {
  const btn = document.getElementById(`btn-${id}`);
  const selected = selectedValuesState[id] || [];
  if (!selected.length) {
    btn.textContent = 'Todos';
    btn.classList.remove('active');
  } else if (selected.length === 1) {
    btn.textContent = selected[0];
    btn.classList.add('active');
  } else {
    btn.textContent = `${selected.length} seleccionados`;
    btn.classList.add('active');
  }
}

function resetConflictReviewState() {
  conflictReviewActive = false;
  updateConflictButton();
  clearConflictHighlights();
}

function onFilterChange(id) {
  syncSelectionFromDom(id);
  updateFilterButton(id);
  resetConflictReviewState();
  buscarAuto();
}

function clearSingleFilter(id, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  selectedValuesState[id] = [];
  document.querySelectorAll(`#options-${id} input[type="checkbox"]`).forEach(chk => {
    chk.checked = false;
  });
  document.getElementById(`search-${id}`).value = '';
  filterPanelOptions(id);
  updateFilterButton(id);
  resetConflictReviewState();
  buscarAuto();
}

function togglePanel(id) {
  document.querySelectorAll('.multi-panel').forEach(p => {
    if (p.id !== `panel-${id}`) p.classList.remove('open');
  });
  document.getElementById(`panel-${id}`).classList.toggle('open');
}

document.addEventListener('click', function (e) {
  if (!e.target.closest('.multiselect')) {
    document.querySelectorAll('.multi-panel').forEach(p => p.classList.remove('open'));
  }
});

function getState() {
  const state = { basePlanScope: accessContext.basePlanScope || '' };
  FILTER_CONFIG.forEach(cfg => {
    state[cfg.id] = [...(selectedValuesState[cfg.id] || [])];
  });
  return state;
}

function renderLegend(rows) {
  const tbody = document.getElementById('legendBody');
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = '<tr><td>No hay leyenda cargada.</td></tr>';
    return;
  }
  rows.forEach(row => {
    const tr = document.createElement('tr');
    row.cells.forEach(cell => {
      const td = document.createElement('td');
      td.textContent = cell.value || '';
      td.style.background = cell.bg || '#ffffff';
      td.style.color = cell.color || '#111827';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function toggleLegend() {
  legendCollapsed = !legendCollapsed;
  const wrap = document.getElementById('legendWrap');
  const btn = document.getElementById('legendToggleBtn');
  if (legendCollapsed) {
    wrap.classList.add('hidden');
    btn.textContent = 'Mostrar leyenda';
  } else {
    wrap.classList.remove('hidden');
    btn.textContent = 'Ocultar leyenda';
  }
}

function rowPassesDayNonEmptyFilters(row) {
  for (const day of Object.keys(dayNonEmptyFilters)) {
    if (!dayNonEmptyFilters[day]) continue;
    const value = row.meta?.[day] || '';
    if (!String(value).trim()) return false;
  }
  return true;
}

function applyDayNonEmptyFilters(rows) {
  return (rows || []).filter(row => rowPassesDayNonEmptyFilters(row));
}

function updateDayFilterButtons() {
  const mapping = { lunes: 'btnLunes', martes: 'btnMartes', miercoles: 'btnMiercoles', jueves: 'btnJueves', viernes: 'btnViernes' };
  Object.entries(mapping).forEach(([day, id]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    if (dayNonEmptyFilters[day]) btn.classList.add('active');
    else btn.classList.remove('active');
  });
}

function toggleDayNonEmpty(day) {
  dayNonEmptyFilters[day] = !dayNonEmptyFilters[day];
  updateDayFilterButtons();
  resetConflictReviewState();
  renderResults(applyDayNonEmptyFilters(rawQueryRows));
  updateMetaCount();
  syncScrollWidth();
}

function clearDayNonEmptyFilters() {
  dayNonEmptyFilters = { lunes: false, martes: false, miercoles: false, jueves: false, viernes: false };
  updateDayFilterButtons();
  resetConflictReviewState();
  renderResults(applyDayNonEmptyFilters(rawQueryRows));
  updateMetaCount();
  syncScrollWidth();
}

function updateMetaCount() {
  document.getElementById('meta').textContent = `Resultados encontrados: ${currentRenderedRows.length || 0}`;
}

function renderResults(rows) {
  const tbody = document.getElementById('resultsBody');
  tbody.innerHTML = '';
  currentRenderedRows = rows || [];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="19">No se encontraron resultados.</td></tr>';
    return;
  }
  rows.forEach((row, rowIndex) => {
    const tr = document.createElement('tr');
    tr.dataset.rowIndex = rowIndex;
    row.cells.forEach((cell, colIndex) => {
      const td = document.createElement('td');
      const value = cell.value || '';
      td.textContent = value;
      td.style.background = cell.bg || '#ffffff';
      td.style.color = cell.color || '#111827';
      td.dataset.baseBg = cell.bg || '#ffffff';
      td.dataset.baseColor = cell.color || '#111827';
      td.dataset.rowIndex = rowIndex;
      td.dataset.colIndex = colIndex;
      td.dataset.conflicts = '';
      td.title = '';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function applyResponse(data) {
  FILTER_CONFIG.forEach(cfg => {
    setFilterOptions(cfg.id, data.options?.[cfg.id] || []);
  });
  rawQueryRows = data.rows || [];
  renderResults(applyDayNonEmptyFilters(rawQueryRows));
  updateMetaCount();
  renderLegend(data.legendRows || []);
  syncScrollWidth();
}

function queryAndRender() {
  const state = getState();
  setLoading(true);
  try {
    const data = runStaticQuery(state);
    applyResponse(data);
    setLoading(false);
  } catch (err) {
    setLoading(false);
    showModal('Error', 'Error al consultar: ' + err.message);
  }
}

function buscarAuto() {
  queryAndRender();
}

function limpiar() {
  FILTER_CONFIG.forEach(cfg => {
    selectedValuesState[cfg.id] = [];
    document.querySelectorAll(`#options-${cfg.id} input[type="checkbox"]`).forEach(chk => {
      chk.checked = false;
    });
    document.getElementById(`search-${cfg.id}`).value = '';
    filterPanelOptions(cfg.id);
    updateFilterButton(cfg.id);
  });
  dayNonEmptyFilters = { lunes: false, martes: false, miercoles: false, jueves: false, viernes: false };
  updateDayFilterButtons();
  resetConflictReviewState();
  buscarAuto();
}

function toggleConflictReview() {
  if (conflictReviewActive) {
    resetConflictReviewState();
    return;
  }
  const found = applyConflictHighlights();
  conflictReviewActive = true;
  updateConflictButton();
  if (found) {
    showModal('Revisión de topes', 'Tope encontrado, revisar las celdas resaltadas en rojo para más información.');
  } else {
    showModal('Revisión de topes', 'No se encuentran topes en la selección actual.');
  }
}

function updateConflictButton() {
  const btn = document.getElementById('conflictBtn');
  if (!btn) return;
  if (conflictReviewActive) btn.classList.add('active');
  else btn.classList.remove('active');
}

function clearConflictHighlights() {
  document.querySelectorAll('#resultsBody td').forEach(td => {
    td.style.background = td.dataset.baseBg || '#ffffff';
    td.style.color = td.dataset.baseColor || '#111827';
    td.dataset.conflicts = '';
    td.title = '';
  });
}

function parseTimeRange(text) {
  const m = String(text || '').match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return { start, end };
}

function overlaps(a, b) {
  return Math.max(a.start, b.start) < Math.min(a.end, b.end);
}

function normalizeTipo(value) {
  return normalizeText(value);
}

function isWeeklyTipo(tipo) {
  const t = normalizeTipo(tipo);
  return t === 'CLAS' || t === 'AYUD' || t === 'LAB/TALLER' || t === 'LABT' || t === 'TALLER';
}

function isDatedTipo(tipo) {
  const t = normalizeTipo(tipo);
  return t === 'PRBA' || t === 'EXAM';
}

function rowDayTimePairs(meta) {
  const out = [];
  ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'].forEach(day => {
    const range = parseTimeRange(meta[day]);
    if (range) out.push({ day, range, colIndex: DAY_COLUMN_INDEX[day] });
  });
  return out;
}

function sameLcException(a, b) {
  const lcA = normalizeText(a.lc);
  const lcB = normalizeText(b.lc);
  return lcA && lcB && lcA === lcB;
}

function sameNrc(a, b) {
  return normalizeText(a.nrc) && normalizeText(a.nrc) === normalizeText(b.nrc);
}

function sameCourse(a, b) {
  const materiaA = normalizeText(a.materia);
  const materiaB = normalizeText(b.materia);
  const cursoA = normalizeText(a.curso);
  const cursoB = normalizeText(b.curso);
  return materiaA && materiaB && cursoA && cursoB && materiaA === materiaB && cursoA === cursoB;
}

function addConflictMessage(rowIndex, colIndex, message) {
  const tr = document.querySelectorAll('#resultsBody tr')[rowIndex];
  if (!tr) return;
  const td = tr.children[colIndex];
  if (!td) return;
  td.style.background = '#fecaca';
  td.style.color = td.dataset.baseColor || '#111827';
  let messages = [];
  try {
    messages = td.dataset.conflicts ? JSON.parse(td.dataset.conflicts) : [];
  } catch (e) {
    messages = [];
  }
  if (!messages.includes(message)) messages.push(message);
  td.dataset.conflicts = JSON.stringify(messages);
  td.title = messages.join('\n');
}

function applyConflictHighlights() {
  clearConflictHighlights();
  const rows = currentRenderedRows || [];
  let foundConflict = false;

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i].meta;
      const b = rows[j].meta;
      if (sameNrc(a, b)) continue;
      if (sameCourse(a, b)) continue;
      if (sameLcException(a, b)) continue;

      const tipoA = normalizeTipo(a.tipo);
      const tipoB = normalizeTipo(b.tipo);

      if (isWeeklyTipo(tipoA) && isWeeklyTipo(tipoB)) {
        const pairsA = rowDayTimePairs(a);
        const pairsB = rowDayTimePairs(b);
        pairsA.forEach(pa => {
          pairsB.forEach(pb => {
            if (pa.day === pb.day && overlaps(pa.range, pb.range)) {
              foundConflict = true;
              const msg = `Tope ${tipoA}-${tipoB} entre NRC ${a.nrc} y ${b.nrc}`;
              addConflictMessage(i, pa.colIndex, msg);
              addConflictMessage(j, pb.colIndex, msg);
            }
          });
        });
      }

      if (isDatedTipo(tipoA) && isDatedTipo(tipoB)) {
        const sameDate = normalizeText(a.inicio) && normalizeText(a.inicio) === normalizeText(b.inicio);
        if (!sameDate) continue;
        const pairsA = rowDayTimePairs(a);
        const pairsB = rowDayTimePairs(b);
        pairsA.forEach(pa => {
          pairsB.forEach(pb => {
            if (overlaps(pa.range, pb.range)) {
              foundConflict = true;
              const msg = `Tope ${tipoA}-${tipoB} entre NRC ${a.nrc} y ${b.nrc}`;
              addConflictMessage(i, 14, msg);
              addConflictMessage(j, 14, msg);
              addConflictMessage(i, pa.colIndex, msg);
              addConflictMessage(j, pb.colIndex, msg);
            }
          });
        });
      }
    }
  }

  return foundConflict;
}

function descargarExcelOriginal() {
  const url = STATIC_CONFIG?.horarioOnlyDownloadUrl || '';
  if (!url) {
    showModal('Error', 'No se encontró la URL de descarga de HORARIO en config.json.');
    return;
  }
  window.open(url, '_blank');
}

function syncScrollWidth() {
  const table = document.getElementById('mainTable');
  const topScrollInner = document.getElementById('topScrollInner');
  if (table && topScrollInner) {
    topScrollInner.style.width = table.scrollWidth + 'px';
  }
}

function initScrollSync() {
  const topScroll = document.getElementById('topScroll');
  const tableWrap = document.getElementById('tableWrap');
  if (!topScroll || !tableWrap) return;
  let syncingTop = false;
  let syncingBottom = false;

  topScroll.addEventListener('scroll', () => {
    if (syncingBottom) return;
    syncingTop = true;
    tableWrap.scrollLeft = topScroll.scrollLeft;
    syncingTop = false;
  });

  tableWrap.addEventListener('scroll', () => {
    if (syncingTop) return;
    syncingBottom = true;
    topScroll.scrollLeft = tableWrap.scrollLeft;
    syncingBottom = false;
  });

  window.addEventListener('resize', syncScrollWidth);
}

function getCatalogoConfigForCurrentAccess() {
  const plan = accessContext?.basePlanScope || '';
  return STATIC_CONFIG?.catalogos?.[plan] || null;
}

function updateCatalogoButton() {
  const btn = document.getElementById('btnVerCatalogo');
  if (!btn) return;

  const cfg = getCatalogoConfigForCurrentAccess();
  if (accessContext?.role !== 'estudiante' || !cfg?.url) {
    btn.classList.add('hidden');
    return;
  }

  btn.classList.remove('hidden');
  btn.textContent = cfg.label || 'Ver Catálogo y Malla';
}

function switchToCatalogoView() {
  const cfg = getCatalogoConfigForCurrentAccess();
  if (!cfg?.url) {
    showModal('Información', 'No hay catálogo configurado para este plan.');
    return;
  }

  const horarioView = document.getElementById('horarioView');
  const catalogoView = document.getElementById('catalogoView');
  const catalogoFrame = document.getElementById('catalogoFrame');
  const catalogoTitle = document.getElementById('catalogoTitle');

  catalogoFrame.src = cfg.url;
  if (catalogoTitle) catalogoTitle.textContent = cfg.title || 'Catálogo y Malla';

  horarioView.classList.add('hidden');
  catalogoView.classList.remove('hidden');
}

function switchToHorarioView() {
  const horarioView = document.getElementById('horarioView');
  const catalogoView = document.getElementById('catalogoView');
  if (!horarioView || !catalogoView) return;
  catalogoView.classList.add('hidden');
  horarioView.classList.remove('hidden');
}

function initializeApp() {
  buildFilters();
  updateConflictButton();
  updateDayFilterButtons();
  updateCatalogoButton();
  switchToHorarioView();

  const data = runStaticQuery({ basePlanScope: accessContext.basePlanScope || '' });
  FILTER_CONFIG.forEach(cfg => {
    selectedValuesState[cfg.id] = selectedValuesState[cfg.id] || [];
    setFilterOptions(cfg.id, data.options?.[cfg.id] || []);
  });
  rawQueryRows = data.rows || [];
  renderResults(applyDayNonEmptyFilters(rawQueryRows));
  updateMetaCount();
  renderLegend(data.legendRows || []);
  syncScrollWidth();
}

window.addEventListener('load', async () => {
  try {
    setLoading(true);
    await loadStaticFiles();
    initScrollSync();
    loadEntryConfig();
    setLoading(false);
  } catch (err) {
    setLoading(false);
    showModal('Error', 'No se pudieron cargar los archivos estáticos: ' + err.message);
  }
});
