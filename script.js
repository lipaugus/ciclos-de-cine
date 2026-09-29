let moviesData = [];
let corrientesMap = {};
const tmdbCache = new Map(); // Cache local en memoria para no repetir peticiones
let googleSheetsRequestQueue = Promise.resolve();

// DOM
const tbody = document.getElementById('movies-tbody');
const searchInput = document.getElementById('search-input');
const filterCiclo = document.getElementById('filter-ciclo');
const filterCorriente = document.getElementById('filter-corriente');
const filterDuracion = document.getElementById('filter-duracion');
const duracionVal = document.getElementById('duracion-val');
const resetBtn = document.getElementById('reset-filters');
const resultsCount = document.getElementById('results-count');

// Modal
const modal = document.getElementById('movie-modal');
const closeModal = document.querySelector('.close-modal');

document.addEventListener('DOMContentLoaded', () => {
  loadAllData();
  setupEventListeners();
});

function fetchCSV(sheet) {
  const request = googleSheetsRequestQueue.then(() => fetchGoogleSheet(sheet));
  googleSheetsRequestQueue = request.catch(() => {});
  return request;
}

function fetchGoogleSheet(sheet) {
  const spreadsheetId = '1QXjX7o41PRM4mGq0IqWW0J2evxDioc7x8i9Us-kDZ0M';
  const url = new URL(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq`);
  url.searchParams.set('tqx', 'out:json');
  url.searchParams.set('sheet', sheet);

  return new Promise((resolve, reject) => {
    const googleNamespace = window.google || (window.google = {});
    const visualization = googleNamespace.visualization || (googleNamespace.visualization = {});
    const query = visualization.Query || (visualization.Query = {});
    const previousHandler = query.setResponse;
    const script = document.createElement('script');
    let timeout;

    const cleanup = () => {
      clearTimeout(timeout);
      script.remove();
      if (query.setResponse === handleResponse) {
        if (previousHandler) {
          query.setResponse = previousHandler;
        } else {
          delete query.setResponse;
        }
      }
    };

    const handleResponse = (response) => {
      cleanup();

      if (response.status !== 'ok') {
        const message = response.errors?.[0]?.message || `Google Sheets no pudo cargar la hoja "${sheet}".`;
        reject(new Error(message));
        return;
      }

      try {
        resolve(parseGoogleSheet(response.table));
      } catch (error) {
        reject(error);
      }
    };

    query.setResponse = handleResponse;
    script.onerror = () => {
      cleanup();
      reject(new Error(`No se pudo conectar con Google Sheets para cargar "${sheet}".`));
    };
    timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Google Sheets tardó demasiado en responder para la hoja "${sheet}".`));
    }, 15000);
    script.src = url.toString();
    document.head.appendChild(script);
  });
}

function parseGoogleSheet(table) {
  const columns = table.cols.map(column => column.label.trim());
  let rows = table.rows;

  if (!columns.some(Boolean)) {
    const headerRow = rows.shift();
    if (!headerRow) {
      throw new Error('La hoja de Google Sheets está vacía.');
    }
    headerRow.c.forEach((cell, index) => {
      columns[index] = cell?.v == null ? '' : String(cell.v).trim();
    });
  }

  if (!columns.some(Boolean)) {
    throw new Error('No se encontraron encabezados válidos en Google Sheets.');
  }

  return rows.map(row => Object.fromEntries(
    columns
      .map((column, index) => [column, row.c[index]?.v == null ? '' : String(row.c[index].v)])
      .filter(([column]) => column)
  ));
}

// Obtener datos de TMDB mediante nuestra API serverless de Vercel
async function fetchTMDBData(tmdbID) {
  if (!tmdbID) return null;
  if (tmdbCache.has(tmdbID)) return tmdbCache.get(tmdbID);

  try {
    const res = await fetch(`/api/tmdb?id=${encodeURIComponent(tmdbID)}`);
    if (!res.ok) return null;
    const data = await res.json();
    tmdbCache.set(tmdbID, data);
    return data;
  } catch (e) {
    console.error(`Error al traer datos de TMDB para ID ${tmdbID}:`, e);
    return null;
  }
}

async function loadAllData() {
  try {
    const [tablaRows, corrientesRows] = await Promise.all([
      fetchCSV('tabla'),
      fetchCSV('corrientes')
    ]);

    corrientesRows.forEach(row => {
      const nombreCorriente = row['corriente'] ? row['corriente'].trim() : '';
      if (nombreCorriente) {
        corrientesMap[nombreCorriente] = {
          anios: row['años'] || row['anios'] || '',
          descripcion: row['descripcion'] || ''
        };
      }
    });

    moviesData = tablaRows.map(row => ({
      ciclos: parseList(row['ciclos']),
      corrientes: parseList(row['corrientes']),
      titulo: row['titulo'] || 'Sin título',
      director: row['director'] || 'Desconocido',
      anio: parseInt(row['año']) || '-',
      duracion: parseInt(row['duracion']) || 0,
      tmdbID: row['tmdbID'] ? row['tmdbID'].trim() : ''
    }));

    populateFilterSelects();
    renderTable(moviesData);
  } catch (err) {
    console.error("Error al cargar datos desde Google Sheets:", err);
    resultsCount.textContent = `Error al cargar la base de datos: ${err.message}`;
  }
}

function parseList(field) {
  if (!field) return [];
  return field.split(';').map(item => item.trim()).filter(Boolean);
}

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

    const imgId = `poster-${movie.tmdbID || Math.random().toString(36).substr(2, 9)}`;

    tr.innerHTML = `
      <td>
        <div id="${imgId}" class="poster-thumb" style="display:flex;align-items:center;justify-content:center;font-size:0.6rem;color:#666;">...</div>
      </td>
      <td class="movie-title-cell">${movie.titulo}</td>
      <td>${movie.director}</td>
      <td>${movie.anio}</td>
      <td>${movie.duracion ? movie.duracion + ' min' : '-'}</td>
      <td>${ciclosTags || '-'}</td>
      <td>${corrientesTags || '-'}</td>
    `;

    // Cargar póster de TMDB para la miniatura
    if (movie.tmdbID) {
      fetchTMDBData(movie.tmdbID).then(tmdb => {
        const container = document.getElementById(imgId);
        if (container && tmdb && tmdb.poster_path) {
          container.outerHTML = `<img src="https://image.tmdb.org/t/p/w200${tmdb.poster_path}" alt="${movie.titulo}" class="poster-thumb" loading="lazy" />`;
        } else if (container) {
          container.textContent = 'Sin foto';
        }
      });
    }

    tr.addEventListener('click', () => openModal(movie));
    tbody.appendChild(tr);
  });
}

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

// Abre el modal y consulta la sinopsis + información ampliada de TMDB
async function openModal(movie) {
  document.getElementById('modal-title').textContent = movie.titulo;
  document.getElementById('modal-director').textContent = movie.director;
  document.getElementById('modal-year').textContent = movie.anio;
  document.getElementById('modal-duration').textContent = movie.duracion || 'N/A';
  
  const overviewEl = document.getElementById('modal-overview');
  const posterEl = document.getElementById('modal-poster');

  overviewEl.textContent = 'Cargando sinopsis desde TMDB...';
  posterEl.src = 'https://via.placeholder.com/170x250?text=Cargando...';

  document.getElementById('modal-ciclos').innerHTML = movie.ciclos.map(c => `<span class="tag">${c}</span>`).join(' ') || 'Ninguno';

  // Mostrar información de corrientes
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
    corrientesContainer.innerHTML = '<span style="font-size:0.85rem; color:#888;">Sin corriente asignada.</span>';
  }

  modal.style.display = 'flex';

  // Obtener datos de TMDB (Sinopsis y Póster HD)
  if (movie.tmdbID) {
    const tmdb = await fetchTMDBData(movie.tmdbID);
    if (tmdb) {
      overviewEl.textContent = tmdb.overview || 'Sinopsis no disponible en TMDB.';
      if (tmdb.poster_path) {
        posterEl.src = `https://image.tmdb.org/t/p/w500${tmdb.poster_path}`;
      }
    } else {
      overviewEl.textContent = 'No se pudo cargar la información desde TMDB.';
    }
  } else {
    overviewEl.textContent = 'Película sin ID de TMDB configurado.';
    posterEl.src = 'https://via.placeholder.com/170x250?text=Sin+TMDB+ID';
  }
}