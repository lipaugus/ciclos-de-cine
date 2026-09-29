// URLs para exportar las pestañas "tabla" y "corrientes" en formato CSV
const SHEET_TABLA_URL = 'https://docs.google.com/spreadsheets/d/1QXjX7o41PRM4mGq0IqWW0J2evxDioc7x8i9Us-kDZ0M/gviz/tq?tqx=out:csv&sheet=tabla';
const SHEET_CORRIENTES_URL = 'https://docs.google.com/spreadsheets/d/1QXjX7o41PRM4mGq0IqWW0J2evxDioc7x8i9Us-kDZ0M/gviz/tq?tqx=out:csv&sheet=corrientes';

let moviesData = [];
let corrientesMap = {}; // Mapa para buscar info de corrientes por nombre

// Elementos DOM
const tbody = document.getElementById('movies-tbody');
const searchInput = document.getElementById('search-input');
const filterCiclo = document.getElementById('filter-ciclo');
const filterCorriente = document.getElementById('filter-corriente');
const filterDuracion = document.getElementById('filter-duracion');
const duracionVal = document.getElementById('duracion-val');
const resetBtn = document.getElementById('reset-filters');
const resultsCount = document.getElementById('results-count');

// Modal Elements
const modal = document.getElementById('movie-modal');
const closeModal = document.querySelector('.close-modal');

document.addEventListener('DOMContentLoaded', () => {
  loadAllData();
  setupEventListeners();
});

// Helper para envolver PapaParse en una Promesa
function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    Papa.parse(url, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data),
      error: (err) => reject(err)
    });
  });
}

// 1. Cargar ambas hojas en paralelo
async function loadAllData() {
  try {
    const [tablaRows, corrientesRows] = await Promise.all([
      fetchCSV(SHEET_TABLA_URL),
      fetchCSV(SHEET_CORRIENTES_URL)
    ]);

    // Mapear información de las corrientes
    corrientesRows.forEach(row => {
      const nombreCorriente = row['corriente'] ? row['corriente'].trim() : '';
      if (nombreCorriente) {
        corrientesMap[nombreCorriente] = {
          anios: row['años'] || row['anios'] || '',
          descripcion: row['descripcion'] || ''
        };
      }
    });

    // Mapear películas
    moviesData = tablaRows.map(row => ({
      ciclos: parseList(row['ciclos']),
      corrientes: parseList(row['corrientes']),
      titulo: row['titulo'] || 'Sin título',
      director: row['director'] || 'Desconocido',
      anio: parseInt(row['año']) || '-',
      duracion: parseInt(row['duracion']) || 0,
      poster: row['URLposter'] || ''
    }));

    populateFilterSelects();
    renderTable(moviesData);
  } catch (err) {
    console.error("Error al cargar datos desde Google Sheets:", err);
    resultsCount.textContent = "Error al cargar la base de datos.";
  }
}

// Auxiliar para separar texto delimitado por ";"
function parseList(field) {
  if (!field) return [];
  return field.split(';').map(item => item.trim()).filter(Boolean);
}

// 2. Poblar opciones de selectores
function populateFilterSelects() {
  const ciclosSet = new Set();
  const corrientesSet = new Set();
  let maxDur = 0;

  moviesData.forEach(movie => {
    movie.ciclos.forEach(c => ciclosSet.add(c));
    movie.corrientes.forEach(c => corrientesSet.add(c));
    if (movie.duracion > maxDur) maxDur = movie.duracion;
  });

  if (maxDur > 0) {
    filterDuracion.max = maxDur;
    filterDuracion.value = maxDur;
    duracionVal.textContent = `${maxDur} min`;
  }

  Array.from(ciclosSet).sort().forEach(ciclo => {
    const opt = document.createElement('option');
    opt.value = ciclo;
    opt.textContent = ciclo;
    filterCiclo.appendChild(opt);
  });

  Array.from(corrientesSet).sort().forEach(corriente => {
    const opt = document.createElement('option');
    opt.value = corriente;
    opt.textContent = corriente;
    filterCorriente.appendChild(opt);
  });
}

// 3. Renderizar la Tabla
function renderTable(data) {
  tbody.innerHTML = '';
  resultsCount.textContent = `Mostrando ${data.length} de ${moviesData.length} películas`;

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2rem; color: var(--text-muted);">No se encontraron películas.</td></tr>`;
    return;
  }

  data.forEach(movie => {
    const tr = document.createElement('tr');

    const ciclosTags = movie.ciclos.map(c => `<span class="tag">${c}</span>`).join(' ');
    const corrientesTags = movie.corrientes.map(c => `<span class="tag tag-corriente">${c}</span>`).join(' ');

    const posterImg = movie.poster 
      ? `<img src="${movie.poster}" alt="${movie.titulo}" class="poster-thumb" loading="lazy" />` 
      : `<div class="poster-thumb" style="display:flex;align-items:center;justify-content:center;font-size:0.6rem;color:#666;">Sin foto</div>`;

    tr.innerHTML = `
      <td>${posterImg}</td>
      <td class="movie-title-cell">${movie.titulo}</td>
      <td>${movie.director}</td>
      <td>${movie.anio}</td>
      <td>${movie.duracion ? movie.duracion + ' min' : '-'}</td>
      <td>${ciclosTags || '-'}</td>
      <td>${corrientesTags || '-'}</td>
    `;

    tr.addEventListener('click', () => openModal(movie));
    tbody.appendChild(tr);
  });
}

// 4. Lógica de Filtrado
function applyFilters() {
  const query = searchInput.value.toLowerCase();
  const selectedCiclo = filterCiclo.value;
  const selectedCorriente = filterCorriente.value;
  const maxDur = parseInt(filterDuracion.value);

  const filtered = moviesData.filter(movie => {
    const matchSearch = movie.titulo.toLowerCase().includes(query) || 
                        movie.director.toLowerCase().includes(query);
    
    const matchCiclo = selectedCiclo === '' || movie.ciclos.includes(selectedCiclo);
    const matchCorriente = selectedCorriente === '' || movie.corrientes.includes(selectedCorriente);
    const matchDuracion = movie.duracion <= maxDur || movie.duracion === 0;

    return matchSearch && matchCiclo && matchCorriente && matchDuracion;
  });

  renderTable(filtered);
}

function setupEventListeners() {
  searchInput.addEventListener('input', applyFilters);
  filterCiclo.addEventListener('change', applyFilters);
  filterCorriente.addEventListener('change', applyFilters);
  
  filterDuracion.addEventListener('input', (e) => {
    duracionVal.textContent = `${e.target.value} min`;
    applyFilters();
  });

  resetBtn.addEventListener('click', () => {
    searchInput.value = '';
    filterCiclo.value = '';
    filterCorriente.value = '';
    filterDuracion.value = filterDuracion.max;
    duracionVal.textContent = `${filterDuracion.max} min`;
    applyFilters();
  });

  closeModal.addEventListener('click', () => modal.style.display = 'none');
  window.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });
}

// 5. Modal con detalle ampliado e información de la Corriente Cinematográfica
function openModal(movie) {
  document.getElementById('modal-title').textContent = movie.titulo;
  document.getElementById('modal-director').textContent = movie.director;
  document.getElementById('modal-year').textContent = movie.anio;
  document.getElementById('modal-duration').textContent = movie.duracion || 'N/A';
  document.getElementById('modal-poster').src = movie.poster || 'https://via.placeholder.com/160x240?text=Sin+Poster';

  document.getElementById('modal-ciclos').innerHTML = movie.ciclos.map(c => `<span class="tag">${c}</span>`).join(' ') || 'Ninguno';

  // Generar fichas detalladas para cada corriente de la película
  const corrientesContainer = document.getElementById('modal-corrientes-container');
  corrientesContainer.innerHTML = '';

  if (movie.corrientes.length > 0) {
    movie.corrientes.forEach(corrienteNombre => {
      const info = corrientesMap[corrienteNombre];
      const card = document.createElement('div');
      card.className = 'corriente-card';

      if (info) {
        card.innerHTML = `
          <div class="corriente-card-header">
            <span class="corriente-card-title">${corrienteNombre}</span>
            ${info.anios ? `<span class="corriente-card-years">${info.anios}</span>` : ''}
          </div>
          ${info.descripcion ? `<p class="corriente-card-desc">${info.descripcion}</p>` : ''}
        `;
      } else {
        card.innerHTML = `
          <div class="corriente-card-header">
            <span class="corriente-card-title">${corrienteNombre}</span>
          </div>
        `;
      }
      corrientesContainer.appendChild(card);
    });
  } else {
    corrientesContainer.innerHTML = '<span class="text-muted" style="font-size:0.85rem; color:#888;">Sin corriente asignada.</span>';
  }

  modal.style.display = 'flex';
}