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
const corrienteTooltip = document.getElementById('corriente-tooltip');
const tooltipTitle = document.getElementById('corriente-tooltip-title');
const tooltipYears = document.getElementById('corriente-tooltip-years');
const tooltipDescription = document.getElementById('corriente-tooltip-description');

// Modal
const modal = document.getElementById('movie-modal');
const closeModal = document.querySelector('.close-modal');
let activeCorrienteTrigger = null;
let corrienteTooltipPinned = false;
let corrienteTooltipTimer;

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
      const nombreCorriente = (row['corrientes'] || row['corriente'] || '').trim();
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
    const corrientesCell = document.createElement('td');
    corrientesCell.append(...movie.corrientes.map(createCorrienteTrigger));

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
    `;
    if (movie.corrientes.length > 0) {
      tr.appendChild(corrientesCell);
    } else {
      tr.insertAdjacentHTML('beforeend', '<td>-</td>');
    }

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

function createCorrienteTrigger(nombre) {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'tag tag-corriente corriente-trigger';
  trigger.textContent = nombre;
  trigger.setAttribute('aria-describedby', 'corriente-tooltip');
  trigger.setAttribute('aria-expanded', 'false');

  trigger.addEventListener('pointerenter', event => {
    if (event.pointerType !== 'touch') {
      showCorrienteTooltip(trigger, nombre);
    }
  });
  trigger.addEventListener('pointerleave', scheduleCorrienteTooltipClose);
  trigger.addEventListener('focus', () => showCorrienteTooltip(trigger, nombre));
  trigger.addEventListener('blur', scheduleCorrienteTooltipClose);
  trigger.addEventListener('click', event => {
    event.stopPropagation();
    clearTimeout(corrienteTooltipTimer);

    if (activeCorrienteTrigger === trigger && !corrienteTooltipPinned) {
      corrienteTooltipPinned = true;
      return;
    }
    if (activeCorrienteTrigger === trigger && corrienteTooltipPinned) {
      hideCorrienteTooltip();
      return;
    }
    showCorrienteTooltip(trigger, nombre, true);
  });

  return trigger;
}

function showCorrienteTooltip(trigger, nombre, pinned = false) {
  clearTimeout(corrienteTooltipTimer);

  if (activeCorrienteTrigger && activeCorrienteTrigger !== trigger) {
    activeCorrienteTrigger.setAttribute('aria-expanded', 'false');
  }

  const info = corrientesMap[nombre];
  tooltipTitle.textContent = nombre;
  tooltipYears.textContent = info?.anios || '';
  tooltipYears.hidden = !info?.anios;
  tooltipDescription.textContent = info?.descripcion || 'No hay información adicional disponible.';
  activeCorrienteTrigger = trigger;
  corrienteTooltipPinned = pinned;
  trigger.setAttribute('aria-expanded', 'true');
  corrienteTooltip.setAttribute('aria-hidden', 'false');
  corrienteTooltip.classList.add('is-visible');
  positionCorrienteTooltip(trigger);
}

function positionCorrienteTooltip(trigger) {
  const triggerRect = trigger.getBoundingClientRect();
  const tooltipRect = corrienteTooltip.getBoundingClientRect();
  const margin = 12;
  const left = Math.min(
    Math.max(margin, triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2),
    window.innerWidth - tooltipRect.width - margin
  );
  const top = triggerRect.top >= tooltipRect.height + margin
    ? triggerRect.top - tooltipRect.height - margin
    : Math.min(triggerRect.bottom + margin, window.innerHeight - tooltipRect.height - margin);

  corrienteTooltip.style.left = `${left}px`;
  corrienteTooltip.style.top = `${Math.max(margin, top)}px`;
}

function scheduleCorrienteTooltipClose() {
  clearTimeout(corrienteTooltipTimer);
  corrienteTooltipTimer = setTimeout(() => {
    if (!corrienteTooltipPinned) {
      hideCorrienteTooltip();
    }
  }, 150);
}

function hideCorrienteTooltip() {
  clearTimeout(corrienteTooltipTimer);
  if (activeCorrienteTrigger) {
    activeCorrienteTrigger.setAttribute('aria-expanded', 'false');
  }
  activeCorrienteTrigger = null;
  corrienteTooltipPinned = false;
  corrienteTooltip.classList.remove('is-visible');
  corrienteTooltip.setAttribute('aria-hidden', 'true');
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
  corrienteTooltip.addEventListener('pointerenter', () => clearTimeout(corrienteTooltipTimer));
  corrienteTooltip.addEventListener('pointerleave', scheduleCorrienteTooltipClose);
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && activeCorrienteTrigger) {
      hideCorrienteTooltip();
    }
  });
  window.addEventListener('resize', () => {
    if (activeCorrienteTrigger) {
      positionCorrienteTooltip(activeCorrienteTrigger);
    }
  });
  window.addEventListener('scroll', () => {
    if (activeCorrienteTrigger) {
      if (corrienteTooltipPinned) {
        positionCorrienteTooltip(activeCorrienteTrigger);
      } else {
        hideCorrienteTooltip();
      }
    }
  }, true);
  window.addEventListener('click', (e) => {
    if (activeCorrienteTrigger && !corrienteTooltip.contains(e.target) && !activeCorrienteTrigger.contains(e.target)) {
      hideCorrienteTooltip();
    }
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

      const cardHeader = document.createElement('div');
      cardHeader.className = 'corriente-card-header';
      const title = document.createElement('span');
      title.className = 'corriente-card-title';
      title.textContent = corrienteNombre;
      cardHeader.appendChild(title);

      if (info?.anios) {
        const years = document.createElement('span');
        years.className = 'corriente-card-years';
        years.textContent = info.anios;
        cardHeader.appendChild(years);
      }
      card.appendChild(cardHeader);

      if (info?.descripcion) {
        const description = document.createElement('p');
        description.className = 'corriente-card-desc';
        description.textContent = info.descripcion;
        card.appendChild(description);
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